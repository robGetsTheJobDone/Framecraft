import {createAdSession, restoreAdSession, importAdZip, type AdSession, type AdSessionOptions} from '@deepbench/browser-studio';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {ChatOpenAI} from '@langchain/openai';
import {sceneOperationsSchema, isProjectModule} from '../../browser-studio/src/scene-session.js';

declare global {
  interface Window {
    hostRead(): Promise<{version: string; snapshot: unknown} | null>;
    hostSave(snapshot: string, expectedVersion: string | null): Promise<{version: string}>;
    hostEvent(event: unknown): Promise<void>;
    framecraft: {open(config: Config): Promise<void>; execute(command: Command): Promise<unknown>; cancel(): void};
  }
}
interface Config {
  projectId: string; token: string; model: string; create: boolean; chatCompletions: boolean;
  options: Pick<AdSessionOptions, 'formats' | 'durationSeconds' | 'fps' | 'initialMode' | 'initialBrief' | 'context'>;
  archive?: string;
}
interface Command {
  name: string; prompt?: string; review?: boolean; runId?: string; edit?: unknown;
  path?: string; content?: string; revision?: string; format?: string; type?: 'mp4' | 'webm';
  data?: string; filename?: string; mimeType?: string;
}
const decode = (data: string) => Uint8Array.from(atob(data), c => c.charCodeAt(0));
async function encode(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let raw = '';
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
}
let session: AdSession;
let abort: AbortController;
async function inspect() {
  return {projectId: session.projectId, project: await session.store.load(), ...await session.sceneState(), formats: session.formats,
    runs: (await session.listRuns()).map(({runId, status, error}) => ({runId, status, error})),
    files: (await session.workspace.list('/', {recursive: true})).filter(f => f.type === 'file').map(f => ({path: f.path, size: f.size}))};
}
window.framecraft = {
  async open(config) {
    abort = new AbortController();
    const options: AdSessionOptions = {
      ...config.options, projectId: config.projectId, wasmURL: '/esbuild.wasm',
      adapters: {
        storage: new MemoryFileSystem(),
        model: new ChatOpenAI({model: config.model, apiKey: config.token, useResponsesApi: !config.chatCompletions, maxRetries: 0,
          configuration: {baseURL: `${location.origin}/v1`, dangerouslyAllowBrowser: true}}),
        checkpoints: {
          async read() {const state = await window.hostRead(); return state ? {version: state.version, snapshot: new Blob([JSON.stringify(state.snapshot)])} : null;},
          async save(_id, snapshot, {expectedVersion}) {return window.hostSave(await snapshot.text(), expectedVersion);},
        },
      },
    };
    session = config.archive ? await importAdZip(new Blob([decode(config.archive)]), options)
      : config.create ? await createAdSession(options) : await restoreAdSession(options);
    session.subscribe(event => {void window.hostEvent(event).catch(() => {});});
    if (config.create) await session.save();
  },
  cancel() {abort?.abort(); session?.cancel();},
  async execute(command) {
    switch (command.name) {
      case 'create': case 'inspect': case 'import': return inspect();
      case 'edit': return session.send(command.prompt!, {review: command.review, signal: abort.signal});
      case 'resume': return session.resume(command.runId, {signal: abort.signal});
      case 'apply': {
        const edit = command.edit as {baseRevision: string; operations: unknown};
        if (!edit || typeof edit.baseRevision !== 'string') throw new Error('Edit JSON needs baseRevision from inspect and an operations array.');
        await session.editScenes({baseRevision: edit.baseRevision, operations: sceneOperationsSchema.parse(edit.operations)});
        break;
      }
      case 'read': return {path: command.path, content: await session.workspace.read(command.path!)};
      case 'write': {
        const path = command.path!;
        if (path !== '/Ad.tsx' && path !== '/project.json' && !isProjectModule(path)) throw new Error('Write supports /Ad.tsx, /project.json, and project JS/TS modules. Use asset to add media.');
        if ((await session.sceneState()).revision !== command.revision) throw new Error('Project revision changed; inspect before writing.');
        if (path === '/project.json') await session.editProject({baseRevision: command.revision!, project: JSON.parse(command.content!)});
        else if (path === '/Ad.tsx') await session.workspace.write(path, command.content!, await session.workspace.read(path));
        else await session.editScenes({baseRevision: command.revision!, operations: [{type: 'writeModule', path, source: command.content!}]});
        break;
      }
      case 'undo': await session.undo(); break;
      case 'redo': await session.redo(); break;
      case 'asset': {
        const blob = new Blob([decode(command.data!)], {type: command.mimeType});
        const id = crypto.randomUUID();
        if (!blob.type.startsWith('image/')) throw new Error('This CLI currently imports image assets; audio/video can be imported in a project ZIP.');
        const bitmap = await createImageBitmap(blob);
        const metadata = {id, kind: 'image' as const, name: command.filename, mimeType: blob.type, width: bitmap.width, height: bitmap.height};
        bitmap.close(); await session.addAssets([{metadata, data: blob}]); await session.save();
        return {asset: (await session.store.load()).assets.find(asset => asset.id === id)};
      }
      case 'export': return {data: await encode(await session.export({format: command.format, type: command.type, signal: abort.signal}))};
      case 'pack': return {data: await encode(await session.downloadZip())};
      default: throw new Error(`Unknown command: ${command.name}`);
    }
    await session.save();
    return inspect();
  },
};
