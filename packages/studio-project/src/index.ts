import {validateComposition, type SceneComposition} from './scenes.js';
export * from './scenes.js';
import { FsError, normalizePath, type BrowserFileSystem, type FileStat } from '@deepbench/browser-filesystem';

export interface StudioAsset { id: string; kind: 'audio' | 'video' | 'image'; path: string; mimeType: string; name?: string; durationSeconds?: number; width?: number; height?: number }
interface TimedClip { id: string; startSeconds: number; durationSeconds: number }
interface MediaClip extends TimedClip { assetId: string; sourceStartSeconds: number; gain?: number; fadeInSeconds?: number; fadeOutSeconds?: number; /** Mutes audio only; video remains visible. */ muted?: boolean }
export interface AudioClip extends MediaClip { kind: 'audio' }
export interface VideoClip extends MediaClip { kind: 'video' }
export interface TextClip extends TimedClip { kind: 'text'; text: string }
export interface ImageClip extends TimedClip { kind: 'image'; assetId: string; objectFit?: 'cover' | 'contain' }
export interface VoiceoverRequestClip extends TimedClip { kind: 'voiceover'; script: string; language: string; title: string }
export type StudioClip = AudioClip | VideoClip | TextClip | ImageClip | VoiceoverRequestClip;
export interface StudioTrack { id: string; kind: 'audio' | 'video' | 'text' | 'image' | 'voiceover'; name: string; /** Audio mute only. */ muted?: boolean; gain?: number; clips: StudioClip[] }
export interface DubbingSegment { id: string; text: string; startSeconds: number; durationSeconds: number; audioAssetId?: string }
export interface DubbingScript { id: string; title: string; language: string; segments: DubbingSegment[] }
export interface StudioProject { composition?: SceneComposition; schemaVersion: 1 | 2; id: string; title: string; width: number; height: number; fps: number; durationSeconds: number; assets: StudioAsset[]; tracks: StudioTrack[]; dubbingScripts: DubbingScript[] }
export interface ValidationIssue { path: string; message: string }
const record = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min;
const idValid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v);
export function validateProject(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (path: string, message: string) => issues.push({ path, message });
  if (!record(value)) return [{ path: '', message: 'Expected project object' }];
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) fail('schemaVersion', 'Unsupported schema version');
  if (value.schemaVersion === 1 && value.composition !== undefined) fail('composition', 'Structured compositions require schemaVersion 2');
  if (value.schemaVersion === 2 && value.composition === undefined) fail('composition', 'Schema version 2 requires a scene composition');
  if (!idValid(value.id)) fail('id', 'Expected nonempty safe identifier');
  if (typeof value.title !== 'string') fail('title', 'Expected string');
  for (const key of ['width', 'height']) if (!Number.isInteger(value[key]) || value[key] <= 0) fail(key, 'Expected positive integer');
  for (const key of ['fps', 'durationSeconds']) if (!finite(value[key]) || value[key] <= 0) fail(key, 'Expected positive finite number');
  const arrays = ['assets', 'tracks', 'dubbingScripts'];
  for (const key of arrays) if (!Array.isArray(value[key])) fail(key, 'Expected array');
  const assets = new Map<string, Record<string, any>>();
  const unique = (entries: unknown[], path: string) => {
    const ids = new Set<string>();
    entries.forEach((entry, i) => { if (!record(entry) || !idValid(entry.id)) fail(`${path}.${i}.id`, 'Expected safe identifier'); else if (ids.has(entry.id)) fail(`${path}.${i}.id`, 'Duplicate identifier'); else ids.add(entry.id); });
  };
  for (const key of arrays) if (Array.isArray(value[key])) unique(value[key], key);
  (Array.isArray(value.assets) ? value.assets : []).forEach((a: unknown, i: number) => {
    const p = `assets.${i}`; if (!record(a)) return;
    if (!['audio','video','image'].includes(a.kind)) fail(`${p}.kind`, 'Invalid asset kind');
    if (typeof a.path !== 'string' || !/^assets\/[A-Za-z0-9_./-]+$/.test(a.path) || a.path.split('/').some((s: string) => !s || s === '.' || s === '..')) fail(`${p}.path`, 'Expected safe relative assets path');
    if (typeof a.mimeType !== 'string' || !a.mimeType) fail(`${p}.mimeType`, 'Expected MIME type');
    if (a.name !== undefined && typeof a.name !== 'string') fail(`${p}.name`, 'Expected string');
    for (const key of ['durationSeconds','width','height']) if (a[key] !== undefined && (!finite(a[key]) || a[key] <= 0)) fail(`${p}.${key}`, 'Expected positive finite number');
    assets.set(a.id, a);
  });
  const timed = (c: Record<string, any>, p: string) => {
    if (!finite(c.startSeconds)) fail(`${p}.startSeconds`, 'Expected nonnegative finite seconds');
    if (!finite(c.durationSeconds) || c.durationSeconds <= 0) fail(`${p}.durationSeconds`, 'Expected positive finite seconds');
    if (c.startSeconds + c.durationSeconds > value.durationSeconds + 1e-8) fail(p, 'Extends beyond project duration');
  };
  const audio = (c: Record<string, any>, p: string) => {
    if (c.gain !== undefined && !finite(c.gain)) fail(`${p}.gain`, 'Expected nonnegative finite gain');
    if (c.muted !== undefined && typeof c.muted !== 'boolean') fail(`${p}.muted`, 'Expected boolean');
  };
  const clipIds = new Set<string>();
  (Array.isArray(value.tracks) ? value.tracks : []).forEach((t: unknown, i: number) => {
    if (!record(t)) return; const p = `tracks.${i}`;
    if (!['audio','video','text','image','voiceover'].includes(t.kind)) fail(`${p}.kind`, 'Invalid track kind');
    if (typeof t.name !== 'string') fail(`${p}.name`, 'Expected string'); audio(t,p);
    if (!Array.isArray(t.clips)) { fail(`${p}.clips`, 'Expected array'); return; }
    unique(t.clips, `${p}.clips`);
    t.clips.forEach((c: unknown, j: number) => {
      if (!record(c)) return; const cp = `${p}.clips.${j}`; timed(c,cp);
      if (clipIds.has(c.id)) fail(`${cp}.id`, 'Clip identifiers must be unique across tracks'); clipIds.add(c.id);
      if (c.kind !== t.kind) fail(`${cp}.kind`, 'Clip must match track kind');
      if (c.kind === 'text') { if (typeof c.text !== 'string') fail(`${cp}.text`, 'Expected string'); return; }
      if (c.kind === 'voiceover') {
        for (const key of ['script', 'language', 'title']) if (typeof c[key] !== 'string' || !c[key].trim()) fail(`${cp}.${key}`, 'Expected nonempty string');
        if (typeof c.script === 'string' && c.script.length > 4096) fail(`${cp}.script`, 'Script exceeds 4096 characters');
        return;
      }
      if (c.kind === 'image') {
        if (assets.get(c.assetId)?.kind !== 'image') fail(`${cp}.assetId`, 'Missing or mismatched image asset');
        if (c.objectFit !== undefined && !['cover', 'contain'].includes(c.objectFit)) fail(`${cp}.objectFit`, 'Invalid image fit');
        return;
      }
      if (!['audio','video'].includes(c.kind)) { fail(`${cp}.kind`, 'Invalid clip kind'); return; }
      audio(c,cp); if (!finite(c.sourceStartSeconds)) fail(`${cp}.sourceStartSeconds`, 'Expected nonnegative finite seconds');
      for (const key of ['fadeInSeconds','fadeOutSeconds']) if (c[key] !== undefined && (!finite(c[key]) || c[key] > c.durationSeconds)) fail(`${cp}.${key}`, 'Fade must be within clip duration');
      if ((c.fadeInSeconds ?? 0) + (c.fadeOutSeconds ?? 0) > c.durationSeconds) fail(cp, 'Audio fades must not overlap');
      const asset = assets.get(c.assetId);
      if (!asset || asset.kind !== c.kind) fail(`${cp}.assetId`, 'Missing or mismatched media asset');
      if (asset?.durationSeconds !== undefined && c.sourceStartSeconds + c.durationSeconds > asset.durationSeconds + 1e-8) fail(cp, 'Extends beyond source duration');
    });
  });
  (Array.isArray(value.dubbingScripts) ? value.dubbingScripts : []).forEach((s: unknown, i: number) => {
    if (!record(s)) return; const p = `dubbingScripts.${i}`;
    for (const key of ['title','language']) if (typeof s[key] !== 'string') fail(`${p}.${key}`, 'Expected string');
    if (!Array.isArray(s.segments)) { fail(`${p}.segments`, 'Expected array'); return; }
    unique(s.segments, `${p}.segments`);
    s.segments.forEach((seg: unknown, j: number) => { if (!record(seg)) return; const sp = `${p}.segments.${j}`; timed(seg,sp); if (typeof seg.text !== 'string') fail(`${sp}.text`, 'Expected string'); if (seg.audioAssetId !== undefined && assets.get(seg.audioAssetId)?.kind !== 'audio') fail(`${sp}.audioAssetId`, 'Missing audio asset'); });
  });
  if (value.composition !== undefined) for (const issue of validateComposition(value.composition, {durationInFrames: Math.round(value.durationSeconds * value.fps), assetIds: new Set(assets.keys())})) fail(`composition${issue.path ? '.' + issue.path : ''}`, issue.message);
  return issues;
}
export function assertValidProject(value: unknown): asserts value is StudioProject {
  const issues = validateProject(value); if (issues.length) throw new Error(`Invalid studio project: ${issues.map(i => `${i.path}: ${i.message}`).join('; ')}`);
}
export interface SeedOptions { title?: string; durationSeconds?: number; width?: number; height?: number; fps?: number }
export function createStudioProject(options: SeedOptions = {}): StudioProject {
  const project: StudioProject = { schemaVersion: 1, id: 'project', title: options.title ?? 'Untitled video', width: options.width ?? 1920, height: options.height ?? 1080, fps: options.fps ?? 30, durationSeconds: options.durationSeconds ?? 30, assets: [], tracks: [{id:'video',kind:'video',name:'Video',clips:[]},{id:'voiceover',kind:'audio',name:'Voiceover',clips:[]},{id:'music',kind:'audio',name:'Music',clips:[]},{id:'titles',kind:'text',name:'Titles',clips:[]}], dubbingScripts: [] };
  assertValidProject(project); return project;
}

/** UTF-8 hex is injective and cannot introduce path separators. */
export function conversationWorkspacePath(conversationId: string): string {
  if (!conversationId || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(conversationId)) throw new Error('Expected a nonempty valid Unicode conversation ID');
  return `/conversations/${Array.from(new TextEncoder().encode(conversationId), b => b.toString(16).padStart(2,'0')).join('')}`;
}
/** An isolation adapter: the agent sees /, never the shared filesystem root. */
export function createConversationFileSystem(fs: BrowserFileSystem, conversationId: string): BrowserFileSystem {
  const root = conversationWorkspacePath(conversationId);
  const absolute = (path: string) => root + (normalizePath(path) === '/' ? '' : normalizePath(path));
  const local = (stat: FileStat): FileStat => ({...stat,path:stat.path.slice(root.length) || '/'});
  return {
    readFile: async path => fs.readFile(absolute(path)),
    writeFile: async (path,data,options) => fs.writeFile(absolute(path),data,options),
    stat: async path => local(await fs.stat(absolute(path))),
    list: async (path,options) => (await fs.list(absolute(path),options)).map(local),
    mkdir: async (path,options) => fs.mkdir(absolute(path),options),
    remove: async (path,options) => { if (normalizePath(path) === '/') throw new FsError('EINVAL',path); return fs.remove(absolute(path),options); },
  };
}
export interface Revision { id: string; createdAt: number; title: string }
export interface ProjectStore {
  readonly rootPath: string;
  readonly filesystem: BrowserFileSystem;
  seed(options?: SeedOptions): Promise<StudioProject>;
  load(): Promise<StudioProject>;
  save(project: StudioProject, options?: { expectedProjectJson?: string }): Promise<Revision>;
  update(mutator: (project: StudioProject) => StudioProject | void | Promise<StudioProject | void>): Promise<StudioProject>;
  listRevisions(): Promise<Revision[]>;
  restoreRevision(id: string): Promise<StudioProject>;
  writeAsset(asset: Omit<StudioAsset,'path'>, data: Blob | Uint8Array): Promise<StudioAsset>;
  /** Shared-filesystem absolute path. For scoped filesystem use '/' + asset.path. */
  resolveAssetPath(asset: StudioAsset): string;
}
const decodeJson = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));
const isFsCode = (error: unknown, code: string) => error instanceof Error && 'code' in error && error.code === code;
/** Saves are serialized per store instance. There is no cross-tab compare-and-swap.
 * A revision is written before the current project: failure may leave an orphan revision,
 * but never publishes half a JSON document. Assets are immutable and written exclusively.
 */
export function createProjectStore(fs: BrowserFileSystem, conversationId: string): ProjectStore {
  const rootPath = conversationWorkspacePath(conversationId);
  const filesystem = createConversationFileSystem(fs,conversationId);
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const load = async () => { const project = decodeJson(await filesystem.readFile('/project.json')); assertValidProject(project); return project; };
  const persist = async (snapshot: string): Promise<Revision> => {
    const project = JSON.parse(snapshot) as StudioProject;
    const revision = {id:crypto.randomUUID(),createdAt:Date.now(),title:project.title};
    await filesystem.writeFile(`/revisions/${revision.id}.json`,JSON.stringify({...revision,project}),{createParents:true,exclusive:true});
    await filesystem.writeFile('/project.json',snapshot,{createParents:true});
    return revision;
  };
  const save = (project: StudioProject, options: { expectedProjectJson?: string } = {}): Promise<Revision> => {
    assertValidProject(project);
    // Capture now so caller mutation cannot change data while waiting in the queue.
    const snapshot = JSON.stringify(project);
    const expected = options.expectedProjectJson;
    return serialized(async () => {
      if (expected !== undefined && JSON.stringify(await load()) !== expected) throw new Error('Project changed since it was read; reload before saving');
      return persist(snapshot);
    });
  };
  const update: ProjectStore['update'] = mutator => serialized(async () => {
    const current = await load();
    const result = await mutator(current);
    const project = result === undefined ? current : result;
    assertValidProject(project);
    const snapshot = JSON.stringify(project);
    await persist(snapshot);
    return JSON.parse(snapshot) as StudioProject;
  });
  const store: ProjectStore = {
    rootPath,filesystem,load,save,update,
    async seed(options = {}) {
      await filesystem.mkdir('/',{recursive:true});
      // Existing/corrupt projects are never silently replaced.
      let current: StudioProject | undefined;
      try { current = await load(); } catch (error) { if (!isFsCode(error,'ENOENT')) throw error; }
      if (!current) {
        const candidate = createStudioProject(options);
        try { await filesystem.writeFile('/project.json',JSON.stringify(candidate),{exclusive:true}); current = candidate; }
        catch (error) { if (!isFsCode(error,'EEXIST')) throw error; current = await load(); }
      }
      for (const path of ['/assets','/exports','/revisions']) await filesystem.mkdir(path,{recursive:true});
      for (const [path,content] of [
        ['/brief.md','# Video brief\n\nDescribe the audience, goal, tone, and desired duration.\n'],
        ['/AGENTS.md','# Studio editing rules\n\nEdit /project.json using schemaVersion 1 for legacy projects or schemaVersion 2 for structured scene projects. Structured scenes use integer frames; legacy media and audio times are seconds. Preserve existing assets. Audio/video sourceStartSeconds defines trim. Mute affects audio only. Validate before preview/export. Provider credentials belong to the application, never project files.\n'],
      ]) { try { await filesystem.writeFile(path,content,{exclusive:true}); } catch (error) { if (!isFsCode(error,'EEXIST')) throw error; } }
      return current;
    },
    async listRevisions() {
      let files: FileStat[]; try { files = await filesystem.list('/revisions'); } catch(error) { if (isFsCode(error,'ENOENT')) return []; throw error; }
      const revisions = await Promise.all(files.filter(f => f.type === 'file' && f.path.endsWith('.json')).map(async f => {
        const raw = decodeJson(await filesystem.readFile(f.path));
        if (!record(raw) || !idValid(raw.id) || !finite(raw.createdAt) || typeof raw.title !== 'string') throw new Error(`Invalid revision: ${f.path}`);
        assertValidProject(raw.project);
        return {id:raw.id,createdAt:raw.createdAt,title:raw.title} as Revision;
      }));
      return revisions.sort((a,b) => a.createdAt-b.createdAt || a.id.localeCompare(b.id));
    },
    async restoreRevision(id) {
      if (!idValid(id)) throw new Error('Invalid revision identifier');
      const raw = decodeJson(await filesystem.readFile(`/revisions/${id}.json`));
      if (!record(raw) || raw.id !== id) throw new Error('Invalid revision');
      assertValidProject(raw.project); await save(raw.project); return raw.project;
    },
    async writeAsset(asset,data) {
      const result: StudioAsset = {...asset,path:`assets/${asset.id}`};
      const candidate = createStudioProject(); candidate.assets.push(result); assertValidProject(candidate);
      await filesystem.writeFile(`/${result.path}`,data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer()),{createParents:true,exclusive:true});
      return result;
    },
    resolveAssetPath(asset) {
      const candidate = createStudioProject(); candidate.assets.push(asset); assertValidProject(candidate);
      return `${rootPath}/${asset.path}`;
    },
  };
  return store;
}
