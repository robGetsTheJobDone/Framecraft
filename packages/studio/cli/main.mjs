#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile, readdir, stat} from 'node:fs/promises';
import {resolve, dirname, extname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {openProject, writeOutput} from './storage.mjs';
import {startServer} from './server.mjs';

const help = `Framecraft — create, edit, and render video projects from your terminal

  framecraft setup                         Install the matching Chromium browser
  framecraft create DIR [--brief TEXT]      Create a project; a brief starts AI editing
  framecraft edit DIR "INSTRUCTIONS"        Edit using the model
  framecraft resume DIR [RUN_ID]            Continue an interrupted model run
  framecraft inspect DIR                   Print project, revision, modules, and runs
  framecraft apply DIR EDIT.json            Apply {baseRevision, operations} atomically
  framecraft read DIR /path.tsx             Read a virtual project file
  framecraft write DIR /path.tsx FILE --revision HASH
  framecraft asset DIR IMAGE                Import an image into the project
  framecraft undo DIR | redo DIR            Navigate edit history
  framecraft export DIR --out video.mp4     Render MP4 or WebM
  framecraft pack DIR --out project.zip     Save a portable editor project
  framecraft import project.zip DIR         Import into a new project

Create options: --mode scenes|source (default scenes), --duration 8, --fps 30,
  --format story:1080x1920 (repeat for multiple formats), --context DIRECTORY
Model options: --model NAME, --chat-completions, --no-review
Export options: --format FORMAT_ID, --force (replace existing output)
Common options: --json (JSON results and JSONL progress), --timeout SECONDS,
  --browser PATH (Chromium executable), --help, --version

OPENAI_API_KEY is required only for create --brief, edit, and resume.
OPENAI_MODEL selects the model (default gpt-6-astra).
OPENAI_BASE_URL selects an OpenAI-compatible API (default https://api.openai.com/v1).
No output token cap is imposed. Results go to stdout; progress/errors to stderr.
Projects and recoverable checkpoints are saved in DIR/.framecraft/state.json.
`;
const options = {
  help: {type: 'boolean', short: 'h'}, version: {type: 'boolean'}, json: {type: 'boolean'},
  brief: {type: 'string'}, mode: {type: 'string'}, duration: {type: 'string'}, fps: {type: 'string'},
  format: {type: 'string', multiple: true}, model: {type: 'string'}, context: {type: 'string'},
  'chat-completions': {type: 'boolean'}, 'no-review': {type: 'boolean'},
  out: {type: 'string'}, force: {type: 'boolean'}, revision: {type: 'string'},
  timeout: {type: 'string'}, browser: {type: 'string'},
};
const commands = {create: [1, 1], edit: [2, 2], resume: [1, 2], inspect: [1, 1], apply: [2, 2],
  read: [2, 2], write: [3, 3], asset: [2, 2], undo: [1, 1], redo: [1, 1], export: [1, 1], pack: [1, 1], import: [2, 2], setup: [0, 0]};
function positive(value, fallback, label, integer = false) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number <= 0 || (integer && !Number.isInteger(number))) throw new Error(`${label} must be a positive ${integer ? 'integer' : 'number'}.`);
  return number;
}
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function main() {
  const {values, positionals} = parseArgs({options, allowPositionals: true, strict: true});
  if (values.help || !positionals.length && !values.version) {process.stdout.write(help); return;}
  if (values.version) {process.stdout.write(JSON.parse(await readFile(resolve(here, '../package.json'), 'utf8')).version + '\n'); return;}
  const [name, ...args] = positionals;
  const arity = commands[name];
  if (!arity || args.length < arity[0] || args.length > arity[1]) throw new Error(`Invalid command or arguments. Run framecraft --help.`);
  const allowed = {
    create: ['brief', 'mode', 'duration', 'fps', 'format', 'context', 'model', 'chat-completions', 'no-review'],
    edit: ['model', 'chat-completions', 'no-review'], resume: ['model', 'chat-completions'],
    write: ['revision'], export: ['out', 'format', 'force'], pack: ['out', 'force'],
  };
  for (const key of Object.keys(values)) if (!['json', 'timeout', 'browser'].includes(key) && !(allowed[name] ?? []).includes(key)) throw new Error(`--${key} is not supported by ${name}.`);
  if (name === 'setup') {
    const cli = resolve(dirname(require.resolve('playwright/package.json')), 'cli.js');
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {stdio: ['inherit', 'inherit', 'inherit']});
    const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', code => resolve(code ?? 1));});
    if (code) throw new Error(`Chromium installation exited with status ${code}.`);
    return;
  }
  const ai = name === 'edit' || name === 'resume' || name === 'create' && values.brief !== undefined;
  if (ai && !process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY in your environment to use AI editing.');
  if (ai && name !== 'resume' && !(values.brief ?? args[1]).trim()) throw new Error('Provide nonempty editing instructions.');
  if (name === 'write' && !values.revision) throw new Error('write requires --revision from framecraft inspect.');
  if (['pack', 'export'].includes(name) && !values.out) throw new Error(`${name} requires --out FILE.`);
  if (name === 'export' && !['.mp4', '.webm'].includes(extname(values.out).toLowerCase())) throw new Error('Export output must end in .mp4 or .webm.');
  if (name === 'export' && values.format?.length > 1) throw new Error('Export one format at a time.');
  const timeout = values.timeout === undefined ? 0 : positive(values.timeout, 0, 'timeout') * 1000;
  const sessionOptions = {};
  if (name === 'create') {
    sessionOptions.durationSeconds = positive(values.duration, 8, 'duration');
    sessionOptions.fps = positive(values.fps, 30, 'fps', true);
    sessionOptions.initialMode = values.mode ?? 'scenes';
    if (!['scenes', 'source'].includes(sessionOptions.initialMode)) throw new Error('mode must be scenes or source.');
    sessionOptions.initialBrief = values.brief;
    if (values.format) sessionOptions.formats = values.format.map(format => {
      const match = /^([A-Za-z0-9_-]+):(\d+)x(\d+)$/.exec(format);
      if (!match || +match[2] <= 0 || +match[3] <= 0) throw new Error('Create format must be ID:WIDTHxHEIGHT, e.g. story:1080x1920.');
      return {id: match[1], width: +match[2], height: +match[3]};
    });
    if (values.context) {
      const {loadContextFiles} = await import('../node.js');
      sessionOptions.context = {files: await loadContextFiles({root: resolve(values.context)})};
    }
  }
  // Read user inputs before acquiring the project or starting a browser.
  const command = {name}; let archive;
  if (name === 'apply') command.edit = JSON.parse(await readFile(resolve(args[1]), 'utf8'));
  if (name === 'read' || name === 'write') {
    command.path = args[1].startsWith('/') ? args[1] : '/' + args[1];
    if (name === 'write') {command.content = await readFile(resolve(args[2]), 'utf8'); command.revision = values.revision;}
  }
  if (name === 'asset' || name === 'import') {
    const input = resolve(name === 'import' ? args[0] : args[1]);
    if ((await stat(input)).size > 256 * 1024 * 1024) throw new Error('Input exceeds 256 MB.');
    const data = (await readFile(input)).toString('base64');
    if (name === 'import') archive = data;
    else {
      command.data = data; command.filename = basename(input);
      command.mimeType = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif'}[extname(input).toLowerCase()];
      if (!command.mimeType) throw new Error('asset accepts PNG, JPEG, WebP, GIF, or AVIF images.');
    }
  }
  if (name === 'edit' || name === 'create' && ai) {command.name = 'edit'; command.prompt = values.brief ?? args[1]; command.review = !values['no-review'];}
  if (name === 'resume') command.runId = args[1];
  if (name === 'export') {command.format = values.format?.[0]; command.type = extname(values.out).slice(1).toLowerCase();}
  const project = await openProject(name === 'import' ? args[1] : args[0], {create: name === 'create' || name === 'import'});
  let server, browser, page, deadline, forceClose, interrupted;
  let pendingSave = Promise.resolve();
  const redact = text => String(text).replaceAll(process.env.OPENAI_API_KEY || '\0', '[redacted]');
  const progress = event => {
    if (values.json) process.stderr.write(redact(JSON.stringify(event)) + '\n');
    else if (event.type !== 'message') process.stderr.write(redact(`[${event.type}] ${event.message ?? (event.progress !== undefined ? `${Math.round(event.progress * 100)}%` : '')}`) + '\n');
  };
  const cancel = reason => {
    if (interrupted) return;
    interrupted = reason;
    progress({type: 'cancelled', message: `${reason}; saving the last recoverable checkpoint.`});
    void page?.evaluate(() => window.framecraft?.cancel()).catch(() => {});
    forceClose = setTimeout(() => {void browser?.close().catch(() => {});}, 10_000);
    forceClose.unref();
  };
  const onInterrupt = () => {process.exitCode = 130; cancel('Interrupted');};
  const onTerminate = () => {process.exitCode = 143; cancel('Terminated');};
  process.on('SIGINT', onInterrupt); process.on('SIGTERM', onTerminate);
  try {
    const assets = new Map([['/esbuild.wasm', {path: resolve(here, '../esbuild.wasm'), type: 'application/wasm'}]]);
    for (const file of await readdir(here)) if (file.endsWith('.js')) assets.set('/' + file, {path: resolve(here, file), type: 'text/javascript'});
    server = await startServer({assets, apiKey: ai ? process.env.OPENAI_API_KEY : undefined,
      baseURL: process.env.OPENAI_BASE_URL || undefined, model: values.model ?? (process.env.OPENAI_MODEL || 'gpt-6-astra')});
    const {chromium} = await import('playwright');
    const browserEnv = {...process.env}; delete browserEnv.OPENAI_API_KEY;
    // Playwright's default SIGINT handler calls process.exit(130), bypassing our
    // checkpoint/lock cleanup. The CLI owns process signal handling instead.
    try {browser = await chromium.launch({headless: true, env: browserEnv, handleSIGINT: false, handleSIGTERM: false,
      executablePath: values.browser ?? process.env.FRAMECRAFT_BROWSER});}
    catch (error) {throw new Error(`Could not launch Chromium. Run framecraft setup, or pass --browser PATH. ${error.message}`);}
    page = await browser.newPage();
    for (const [binding, callback] of Object.entries({hostRead: () => project.read(), hostSave: (snapshot, version) => {
      const save = pendingSave.then(() => project.save(snapshot, version));
      pendingSave = save.catch(() => {}); return save;
    }, hostEvent: progress})) {
      await page.exposeBinding(binding, ({frame}, ...args) => {
        if (frame !== page.mainFrame()) throw new Error('Only the CLI runtime may access the host.');
        return callback(...args);
      });
    }
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(server.origin);
    try {await page.waitForFunction(() => !!window.framecraft, undefined, {timeout: 60_000});}
    catch (error) {throw new Error(`CLI runtime failed to load: ${pageErrors.join('; ') || error.message}`);}
    if (interrupted) throw new Error(interrupted);
    await page.evaluate(config => window.framecraft.open(config), {projectId: project.projectId, token: server.token,
      model: values.model ?? (process.env.OPENAI_MODEL || 'gpt-6-astra'), chatCompletions: !!values['chat-completions'],
      create: name === 'create' || name === 'import', options: sessionOptions, archive});
    if (interrupted) throw new Error(interrupted);
    if (timeout) deadline = setTimeout(() => cancel('Command timed out'), timeout);
    let result = await page.evaluate(command => window.framecraft.execute(command), command);
    if (interrupted) throw new Error(interrupted);
    if (name === 'export' || name === 'pack') result = await writeOutput(values.out, Buffer.from(result.data, 'base64'), {force: values.force, projectRoot: project.root});
    if (name === 'read' && !values.json) process.stdout.write(result.content);
    else process.stdout.write(JSON.stringify(result, null, values.json ? undefined : 2) + '\n');
  } catch (error) {throw new Error(interrupted ?? error.message);}
  finally {
    clearTimeout(deadline); clearTimeout(forceClose);
    process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate);
    try {await browser?.close();} finally {try {await server?.close();} finally {await pendingSave; await project.close();}}
  }
}
main().catch(error => {
  const message = String(error.message).replaceAll(process.env.OPENAI_API_KEY || '\0', '[redacted]');
  process.stderr.write(process.argv.includes('--json') ? JSON.stringify({type: 'error', message}) + '\n' : `Error: ${message}\n`);
  process.exitCode ||= 1;
});
