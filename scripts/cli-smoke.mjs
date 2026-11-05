import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, writeFile, readFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createServer} from 'node:http';

const exec = promisify(execFile);
const cli = resolve(process.env.FRAMECRAFT_TEST_CLI ?? 'packages/studio/portable/cli/main.mjs');
const dir = await mkdtemp(join(tmpdir(), 'framecraft-cli-'));
const env = {...process.env, OPENAI_API_KEY: '', OPENAI_BASE_URL: ''};
const run = async (args, extra = {}) => {
  const result = await exec(process.execPath, [cli, ...args, '--json'], {env: {...env, ...extra}, maxBuffer: 16 * 1024 * 1024, timeout: 120_000});
  return {result: JSON.parse(result.stdout), stderr: result.stderr};
};
let modelServer;
try {
  const project = join(dir, 'project');
  const context = join(dir, 'context');
  await (await import('node:fs/promises')).mkdir(context);
  await writeFile(join(context, 'brand.md'), 'Our brand is Framecraft.');
  await writeFile(join(context, '.env'), 'PRIVATE=never-include');
  const created = (await run(['create', project, '--format', 'test:160x120', '--duration', '1', '--fps', '10', '--context', context])).result;
  assert.equal(created.project.durationSeconds, 1);
  assert.ok(created.files.some(f => f.path === '/context/product/brand.md'));
  assert.ok(!created.files.some(f => f.path.endsWith('.env')));
  await assert.rejects(run(['create', project]), /already exists/);
  const editFile = join(dir, 'edit.json');
  const source = `import {useCurrentFrame} from 'remotion'; export default function Card(){const frame=useCurrentFrame();return <div style={{width:'100%',height:'100%',background:'#18243f',color:'white',fontSize:24,display:'flex',alignItems:'center',justifyContent:'center'}}>CLI {frame}</div>}`;
  const edit = {baseRevision: created.revision, operations: [
    {type: 'addComponent', component: {id: 'card', entry: '/components/Card.tsx', authoredDurationInFrames: 10}, source},
    {type: 'addScene', scene: {id: 'intro', componentId: 'card', startFrame: 0, durationInFrames: 10, sourceStartFrame: 0, layer: 0, props: {}}},
  ]};
  await writeFile(editFile, JSON.stringify(edit));
  const edited = (await run(['apply', project, editFile])).result;
  assert.equal(edited.composition.scenes.length, 1);
  await assert.rejects(run(['apply', project, editFile]), /revision changed/);
  const stable = (await run(['inspect', project])).result;
  assert.equal(stable.revision, edited.revision);
  assert.equal((await run(['read', project, '/components/Card.tsx'])).result.content, source);
  const broken = join(dir, 'broken.tsx'); await writeFile(broken, 'export default function nope( {');
  await assert.rejects(run(['write', project, '/components/Card.tsx', broken, '--revision', stable.revision]));
  assert.equal((await run(['inspect', project])).result.revision, stable.revision, 'failed compilation leaves project intact');
  assert.equal((await run(['undo', project])).result.composition.scenes.length, 0);
  assert.equal((await run(['redo', project])).result.composition.scenes.length, 1);
  for (const type of ['mp4', 'webm']) {
    const out = join(dir, 'video.' + type);
    const rendered = await run(['export', project, '--out', out, '--format', 'test']);
    assert.ok(rendered.result.bytes > 500);
    const bytes = await readFile(out);
    if (type === 'mp4') assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
    else assert.equal(bytes.subarray(0, 4).toString('hex'), '1a45dfa3');
    for (const line of rendered.stderr.trim().split('\n').filter(Boolean)) assert.ok(JSON.parse(line).type);
  }
  const archive = join(dir, 'project.zip');
  await run(['pack', project, '--out', archive]);
  await assert.rejects(run(['pack', project, '--out', archive]), /EEXIST/);
  const imported = (await run(['import', archive, join(dir, 'imported')])).result;
  assert.deepEqual(imported.composition, stable.composition);
  assert.deepEqual(imported.modules, stable.modules);
  assert.deepEqual(imported.formats, stable.formats);
  await run(['export', join(dir, 'imported'), '--out', join(dir, 'imported.webm')]);
  await assert.rejects(run(['edit', project, 'Make it blue']), /OPENAI_API_KEY/);
  console.log('CLI: create, context filtering, scenes, stale edits, failed compilation rollback, undo/redo, MP4/WebM, ZIP roundtrip passed.');

  // A local provider exercises the actual ChatOpenAI HTTP and streaming protocol,
  // without spending tokens or depending on nondeterministic model output.
  let failAfterWrite = true, hang = false, calls = 0;
  let requestArrived;
  modelServer = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts)); calls++;
    assert.equal(req.headers.authorization, 'Bearer test-key');
    for (const cap of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) assert.equal(body[cap], undefined);
    if (hang) {requestArrived?.(); return;}
    const responses = req.url === '/v1/responses';
    const format = body.response_format?.json_schema?.name ?? body.text?.format?.name ?? body.tool_choice?.function?.name ?? body.tool_choice?.name;
    const plan = {durationSeconds: null, concept: 'CLI test', scenes: [{id: null, componentId: null, start: 0, end: 1, copy: 'Hello', visual: 'Blue', motion: 'Still', assetKeys: []}], assets: [], nextChanges: ['Set headline']};
    let content = null, tool_calls;
    if (format) {
      const structured = format === 'edit_plan' ? {changes: ['Set headline'], preserve: ['Layout'], needsProductionPlan: false} : plan;
      if (body.response_format || body.text?.format) content = JSON.stringify(structured);
      else tool_calls = [{id: 'plan', type: 'function', function: {name: format, arguments: JSON.stringify(structured)}}];
    } else {
      const written = responses ? body.input.some(item => item.type === 'function_call_output' && item.call_id === 'write')
        : body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'write');
      if (written && failAfterWrite) {res.writeHead(503); res.end(JSON.stringify({error: {message: 'Deliberate provider interruption'}})); return;}
      tool_calls = [{id: written ? 'finish' : 'write', type: 'function', function: written
        ? {name: 'finish_design', arguments: '{}'}
        : {name: 'write_ad', arguments: JSON.stringify({source: 'export default function Ad(){return <div style={{width:160,height:120,background:"blue",color:"white"}}>CLI AI</div>}'})}}];
    }
    if (responses) {
      const output = tool_calls?.map(call => ({type: 'function_call', id: 'fc_' + call.id, call_id: call.id, name: call.function.name, arguments: call.function.arguments, status: 'completed'}))
        ?? [{type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{type: 'output_text', text: content, annotations: []}]}];
      const response = {id: 'resp_test', object: 'response', status: 'completed', model: 'test-model', output, text: body.text,
        usage: {input_tokens: 10, output_tokens: 10, total_tokens: 20, input_tokens_details: {cached_tokens: 0}, output_tokens_details: {reasoning_tokens: 0}}};
      if (body.stream) {
        res.writeHead(200, {'content-type': 'text/event-stream'});
        let sequence_number = 0;
        const event = data => res.write(`event: ${data.type}\ndata: ${JSON.stringify({...data, sequence_number: sequence_number++})}\n\n`);
        event({type: 'response.created', response: {...response, status: 'in_progress', output: []}});
        for (const [index, item] of output.entries()) {
          event({type: 'response.output_item.added', output_index: index, item: {...item, arguments: '', status: 'in_progress'}});
          if (item.type === 'function_call') event({type: 'response.function_call_arguments.delta', output_index: index, item_id: item.id, delta: item.arguments});
          else event({type: 'response.output_text.delta', output_index: index, item_id: item.id, content_index: 0, delta: content});
          event({type: 'response.output_item.done', output_index: index, item});
        }
        event({type: 'response.completed', response}); res.end();
      } else {res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(response));}
      return;
    }
    const finish_reason = tool_calls ? 'tool_calls' : 'stop';
    if (body.stream) {
      res.writeHead(200, {'content-type': 'text/event-stream'});
      res.write(`data: ${JSON.stringify({id: 'chat-test', object: 'chat.completion.chunk', model: 'test-model', choices: [{index: 0, delta: {role: 'assistant', content, tool_calls: tool_calls?.map((call, index) => ({index, ...call}))}, finish_reason: null}]})}\n\n`);
      res.end(`data: ${JSON.stringify({id: 'chat-test', object: 'chat.completion.chunk', model: 'test-model', choices: [{index: 0, delta: {}, finish_reason}]})}\n\ndata: [DONE]\n\n`);
    } else {
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({id: 'chat-test', object: 'chat.completion', model: 'test-model', choices: [{index: 0, message: {role: 'assistant', content, tool_calls}, finish_reason}]}));
    }
  });
  await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
  const modelEnv = {OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: `http://127.0.0.1:${modelServer.address().port}/v1`, OPENAI_MODEL: 'test-model'};
  const aiProject = join(dir, 'ai');
  await assert.rejects(run(['create', aiProject, '--mode', 'source', '--format', 'test:160x120', '--duration', '1', '--fps', '10', '--brief', 'Make a blue title', '--no-review', '--chat-completions'], modelEnv), /Deliberate provider interruption/);
  const failed = (await run(['inspect', aiProject])).result;
  assert.equal(failed.runs[0].status, 'error');
  failAfterWrite = false;
  await run(['resume', aiProject, '--chat-completions'], modelEnv);
  assert.equal((await run(['inspect', aiProject])).result.runs[0].status, 'complete');
  assert.match((await run(['read', aiProject, '/Ad.tsx'])).result.content, /CLI AI/);
  assert.ok(!(await readFile(join(aiProject, '.framecraft/state.json'), 'utf8')).includes('test-key'));
  assert.ok(calls >= 4);
  const responsesProject = join(dir, 'responses');
  await run(['create', responsesProject, '--mode', 'source', '--format', 'test:160x120', '--duration', '1', '--fps', '10', '--brief', 'Make a blue title', '--no-review'], modelEnv);
  assert.match((await run(['read', responsesProject, '/Ad.tsx'])).result.content, /CLI AI/);
  hang = true;
  const arrived = new Promise(resolve => {requestArrived = resolve;});
  const child = spawn(process.execPath, [cli, 'edit', aiProject, 'Cancel this edit', '--chat-completions', '--json'], {env: {...env, ...modelEnv}, stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = ''; child.stderr.on('data', chunk => {stderr += chunk;}); child.stdout.resume();
  const exited = new Promise(resolve => child.once('exit', resolve));
  await Promise.race([arrived, new Promise((_, reject) => {const timer = setTimeout(() => reject(new Error('Provider request never arrived')), 30_000); timer.unref();})]);
  child.kill('SIGINT');
  assert.equal(await exited, 130, stderr);
  await assert.rejects(access(join(aiProject, '.framecraft/lock')));
  const cancelled = (await run(['inspect', aiProject])).result;
  assert.ok(cancelled.runs.some(run => run.status === 'cancelled'));
  console.log('CLI: Responses/Chat Completions streaming, uncapped requests, durable error recovery/resume, secret isolation, and SIGINT cancellation passed.');
} finally {
  if (modelServer) {modelServer.closeAllConnections(); await new Promise(resolve => modelServer.close(resolve));}
  if (process.env.FRAMECRAFT_KEEP_TEST_OUTPUT) console.log(`CLI test artifacts: ${dir}`);
  else await rm(dir, {recursive: true, force: true});
}
