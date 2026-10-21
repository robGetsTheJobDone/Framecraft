import {MemoryFileSystem, normalizePath, type BrowserFileSystem} from '@deepbench/browser-filesystem';
import {validateComposition,validateComponentProps} from '@deepbench/studio-project';

export type LibraryValue = string | number | boolean | null | LibraryValue[] | {[key: string]: LibraryValue};
export interface LibraryInput {type: 'text' | 'number' | 'boolean' | 'color' | 'enum' | 'asset'; label?: string; required?: boolean; options?: string[]; min?: number; max?: number}
export interface LibraryComponent {id: string; entry: string; authoredDurationInFrames: number; inputs?: Record<string, LibraryInput>; defaults?: Record<string, LibraryValue>; assetBindings?: Record<string,string>}
export interface LibraryAsset {mimeType: string; kind: 'image' | 'audio' | 'video'; data: string; hash: string; name?: string}
export interface LibraryPreview {dataUrl: string; props: Record<string, LibraryValue>; width: number; height: number; fps: number; frame: number}
export interface ComponentRelease {
  schemaVersion: 1; componentId: string; version: string; kind: 'component' | 'scene'; name: string; description: string; tags: string[];
  component: LibraryComponent; modules: Record<string, string>; assets: Record<string, LibraryAsset>;
  runtime: {contract: 1; imports: string[]}; preview?: LibraryPreview; hash: string;
}
export interface LibraryPin {componentId: string; version: string; hash: string; localComponentId: string; workspaceId?:string; assetBindings: Record<string, string>; moduleHashes:Record<string,string>; componentHash:string; locallyModified?: boolean}
export interface LibrarySummary {componentId: string; version: string; hash: string; kind: ComponentRelease['kind']; name: string; description: string; tags: string[]; preview?: LibraryPreview}
export interface LibraryQuery {workspaceId: string; query?: string; kind?: ComponentRelease['kind']; offset?: number; limit?: number}
export interface ComponentLibraryAdapter {
  capabilities?: {canPublish: boolean};
  search(query: LibraryQuery, signal?: AbortSignal): Promise<{items: LibrarySummary[]; total: number; nextOffset: number | null}>;
  get(query: {workspaceId: string; componentId: string; version: string}, signal?: AbortSignal): Promise<ComponentRelease | null>;
  publish(request: {workspaceId: string; release: ComponentRelease; idempotencyKey: string; authorized: true}, signal?: AbortSignal): Promise<ComponentRelease>;
}
export const componentLibraryLimits = {modules: 128, moduleBytes: 256 * 1024, sourceBytes: 2 * 1024 * 1024, assetBytes: 16 * 1024 * 1024, packageBytes: 32 * 1024 * 1024, pageSize: 50, previewBytes: 1024 * 1024} as const;
const enc = new TextEncoder();
const clone = <T>(value: T): T => structuredClone(value);
const identifier = (value: string) => typeof value === 'string' && !['__proto__','constructor','prototype'].includes(value) && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value);
const fail = (message: string): never => {throw new Error(message);};
const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
function safePath(path: string) {
  if (typeof path !== 'string' || path.length > 512 || /[\x00-\x1f\\]/.test(path) || normalizePath(path) !== path || !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:tsx?|jsx?)$/.test(path) || /^\/(context|skills|assets)\//.test(path)) fail(`Invalid component module path: ${path}`);
  return path;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value as object).filter(([,v]) => v !== undefined).sort(([a],[b]) => a<b?-1:a>b?1:0).map(([k,v]) => JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
}
async function hashBytes(bytes: Uint8Array) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(b => b.toString(16).padStart(2,'0')).join('');}
export async function componentContentHash(value: unknown) {return hashBytes(enc.encode(canonical(value)));}
function decodeAsset(data: string) {
  if (typeof data !== 'string' || data.length > componentLibraryLimits.assetBytes * 4 / 3 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) fail('Invalid component asset encoding or size');
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  if (bytes.byteLength > componentLibraryLimits.assetBytes) fail('Component asset exceeds size limit');
  return bytes;
}

/** Parse TSX rather than guessing dependencies from strings, comments, JSX or templates. */
async function imports(source: string, path: string, requireDefault=false): Promise<string[]> {
  // esbuild's split browser bundle exposes this CommonJS dependency as default,
  // while Node's loader also supplies named exports. Support both module shapes.
  const parser=await import('@babel/parser') as typeof import('@babel/parser') & {default?:typeof import('@babel/parser')};
  const parse=parser.parse??parser.default?.parse;
  if(typeof parse!=='function')throw new Error('Component parser could not be loaded');
  const ast=parse(source,{sourceType:'module',sourceFilename:path,plugins:['typescript',...(path.endsWith('x')?['jsx' as const]:[])]});
  if(requireDefault&&!ast.program.body.some(node=>node.type==='ExportDefaultDeclaration'||(node.type==='ExportNamedDeclaration'&&node.specifiers.some(specifier=>specifier.exported.type==='Identifier'?specifier.exported.name==='default':specifier.exported.value==='default'))))fail('Library entry must export a default component');
  const found:string[]=[];
  const visit=(node:unknown):void=>{
    if(!record(node))return;
    if(node.type==='ImportExpression'||(node.type==='CallExpression'&&record(node.callee)&&(node.callee.type==='Import'||(node.callee.type==='Identifier'&&node.callee.name==='require')))||(node.type==='MetaProperty'&&record(node.meta)&&node.meta.name==='import'))fail('Dynamic imports, require(), and import.meta are not supported in library modules');
    if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&record(node.source)&&typeof node.source.value==='string')found.push(node.source.value);
    for(const [key,value]of Object.entries(node)){if(['loc','start','end','extra','comments','tokens'].includes(key))continue;if(Array.isArray(value))value.forEach(visit);else if(record(value))visit(value);}
  };
  visit(ast.program);return found;
}
function resolveImport(from: string, specifier: string, modules: Record<string,string>) {
  if (['react','remotion'].includes(specifier)) return null;
  if (!specifier.startsWith('.') || specifier.includes('\\') || specifier.includes('\0')) fail(`Unsupported library import: ${specifier}`);
  const base = normalizePath(from.slice(0,from.lastIndexOf('/')+1)+specifier);
  const candidates = [base, ...['.tsx','.ts','.jsx','.js','/index.tsx','/index.ts','/index.jsx','/index.js'].map(s => base+s)];
  if (/\.js$/.test(base)) candidates.push(base.slice(0,-3)+'.ts',base.slice(0,-3)+'.tsx');
  const target = candidates.find(path => Object.hasOwn(modules,path));
  if (!target) fail(`Missing library import ${specifier} from ${from}`);
  return target!;
}
export async function extractComponentModules(entry: string, modules: Record<string,string>): Promise<Record<string,string>> {
  safePath(entry);
  if (!record(modules)) fail('Expected component modules');
  const result: Record<string,string> = Object.create(null); let total=0;
  const visit = async (path: string):Promise<void> => {
    safePath(path); if (Object.hasOwn(result,path)) return;
    const source = modules[path]; if (typeof source !== 'string') fail(`Missing component module: ${path}`);
    const size = enc.encode(source).byteLength; total += size;
    if (size > componentLibraryLimits.moduleBytes || total > componentLibraryLimits.sourceBytes || Object.keys(result).length >= componentLibraryLimits.modules) fail('Component module resource limit exceeded');
    result[path]=source;
    for (const specifier of await imports(source,path,path===entry)) {const resolved=resolveImport(path,specifier,modules); if(resolved)await visit(resolved);}
  };
  await visit(entry); return result;
}
function validateComponent(component: LibraryComponent) {
  const issues=validateComposition({version:1,components:[component],scenes:[]},{durationInFrames:1});
  if(issues.length)fail(issues.map(issue=>`${issue.path}: ${issue.message}`).join('; '));
  safePath(component.entry);
}
export function validateLibraryProps(component: LibraryComponent, props: Record<string, LibraryValue>, requireInputs = true) {
  if (!record(props)) fail('Expected component props');
  const values={...component.defaults,...props};
  const issues=validateComponentProps(component,values,undefined,requireInputs);
  if(issues.length)fail(issues.map(issue=>`${issue.path}: ${issue.message.toLowerCase()}`).join('; '));
  return values;
}
export type PrepareComponentRelease = Omit<ComponentRelease,'schemaVersion'|'hash'|'runtime'|'modules'|'assets'|'description'|'tags'|'kind'> & {modules: Record<string,string>; assets?: Record<string,Omit<LibraryAsset,'hash'> & {hash?: string}>; description?: string; tags?: string[]; kind?: ComponentRelease['kind']};
export async function prepareComponentRelease(input: PrepareComponentRelease, renderPreview?: (release: ComponentRelease) => Promise<LibraryPreview>): Promise<ComponentRelease> {
  validateComponent(input.component);
  const assets: Record<string,LibraryAsset> = Object.create(null);
  for (const [id,asset] of Object.entries(input.assets ?? {})) assets[id]={...asset,hash:await hashBytes(decodeAsset(asset.data))};
  const release: ComponentRelease = {schemaVersion:1,componentId:input.componentId,version:input.version,kind:input.kind ?? 'component',name:input.name,description:input.description ?? '',tags:input.tags ?? [],component:clone(input.component),modules:await extractComponentModules(input.component.entry,input.modules),assets,runtime:{contract:1,imports:['react','remotion']},...(input.preview ? {preview:clone(input.preview)} : {}),hash:''};
  release.hash=await releaseHash(release); await validateComponentRelease(release);
  if(renderPreview) {release.preview=await renderPreview(clone(release));release.hash=await releaseHash(release);await validateComponentRelease(release);}
  return release;
}
async function releaseHash(release: ComponentRelease) {const {hash,...content}=release;return componentContentHash(content);}
export async function validateComponentRelease(release: ComponentRelease): Promise<void> {
  if (!record(release) || release.schemaVersion !== 1 || !identifier(release.componentId) || !identifier(release.version) || !['component','scene'].includes(release.kind) || typeof release.name !== 'string' || !release.name.trim() || release.name.length > 200 || typeof release.description !== 'string' || release.description.length > 4000 || !Array.isArray(release.tags) || release.tags.length > 32 || release.tags.some(t=>typeof t!=='string'||t.length>100)) fail('Invalid component release metadata');
  if (enc.encode(JSON.stringify(release)).byteLength > componentLibraryLimits.packageBytes) fail('Component package exceeds size limit');
  validateComponent(release.component);
  if (!record(release.runtime) || release.runtime.contract !== 1 || !Array.isArray(release.runtime.imports) || release.runtime.imports.some(id=>!['react','remotion'].includes(id))) fail('Unsupported component runtime');
  const closure=await extractComponentModules(release.component.entry,release.modules);
  if(Object.keys(closure).length!==Object.keys(release.modules).length)fail('Library package contains unrelated modules');
  if(!record(release.assets))fail('Invalid library assets');
  for(const [id,asset] of Object.entries(release.assets)) {
    if(!identifier(id)||!record(asset)||!['image','audio','video'].includes(asset.kind)||typeof asset.mimeType!=='string'||!asset.mimeType.startsWith(asset.kind+'/'))fail(`Invalid library asset: ${id}`);
    if(await hashBytes(decodeAsset(asset.data))!==asset.hash)fail(`Library asset integrity mismatch: ${id}`);
  }
  for(const [key,input] of Object.entries(release.component.inputs??{}))if(input.type==='asset'&&release.component.defaults?.[key]!==undefined&&!Object.hasOwn(release.assets,String(release.component.defaults[key])))fail(`Missing default library asset: ${key}`);
  for(const [alias,id] of Object.entries(release.component.assetBindings??{}))if(!identifier(alias)||typeof id!=='string'||!Object.hasOwn(release.assets,id))fail(`Missing bound library asset: ${alias}`);
  if(release.preview) {
    const p=release.preview;
    if(typeof p.dataUrl!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(p.dataUrl)||p.dataUrl.length>componentLibraryLimits.previewBytes||![p.width,p.height,p.fps].every(n=>Number.isFinite(n)&&n>0)||!Number.isSafeInteger(p.frame)||p.frame<0||p.frame>=release.component.authoredDurationInFrames)fail('Invalid component preview');
    validateLibraryProps(release.component,p.props);
    const assetIssues=validateComponentProps(release.component,{...release.component.defaults,...p.props},new Set(Object.keys(release.assets)));
    if(assetIssues.length)fail(`Invalid preview inputs: ${assetIssues.map(issue=>issue.message).join('; ')}`);
  }
  if(await releaseHash(release)!==release.hash)fail('Component release integrity mismatch');
}

/** Pure materialization: caller commits these files, assets, component and pin as one project revision. */
export async function materializeComponentRelease(release: ComponentRelease, options: {componentId?: string; prefix?: string; workspaceId?:string} = {}) {
  await validateComponentRelease(release);
  const localId=options.componentId??`library-${release.componentId.slice(0,90).replace(/[^A-Za-z0-9_-]/g,'-')}-${release.hash.slice(0,12)}`;
  if(!identifier(localId)||!/^[A-Za-z0-9_-]+$/.test(localId))fail('Invalid local component ID');
  const prefix=options.prefix??`/components/library/${localId}/${release.hash.slice(0,12)}`;
  if(normalizePath(prefix)!==prefix||!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(prefix)||!prefix.startsWith('/components/'))fail('Invalid library module prefix');
  const modules=Object.fromEntries(Object.entries(release.modules).map(([path,source])=>[prefix+path,source]));
  const bindings: Record<string,string>={};
  const assets: Record<string,LibraryAsset>={};
  for(const [id,asset] of Object.entries(release.assets)){const mapped=`lib-${asset.hash}`;bindings[id]=mapped;assets[mapped]=clone(asset);}
  const component=clone(release.component);component.id=localId;component.entry=prefix+component.entry;
  component.assetBindings=Object.fromEntries(Object.entries(release.component.assetBindings??{}).map(([alias,id])=>[alias,bindings[id]]));
  component.defaults=remapLibraryProps(component,component.defaults??{},bindings);
  const pin:LibraryPin={componentId:release.componentId,version:release.version,hash:release.hash,localComponentId:localId,...(options.workspaceId?{workspaceId:options.workspaceId}:{}),assetBindings:bindings,moduleHashes:Object.fromEntries(await Promise.all(Object.entries(modules).map(async([path,source])=>[path,await componentContentHash(source)]))),componentHash:await componentContentHash(component)};
  return {component,modules,assets,pin};
}
export function remapLibraryProps(component: LibraryComponent, props: Record<string,LibraryValue>, bindings: Record<string,string>) {
  const result=clone(props);for(const [key,input]of Object.entries(component.inputs??{}))if(input.type==='asset'&&typeof result[key]==='string'&&Object.hasOwn(bindings,result[key] as string))result[key]=bindings[result[key] as string];return result;
}
export async function upgradeComponentRelease(current: LibraryPin, release: ComponentRelease, instanceProps: Record<string,LibraryValue>[]) {
  if(current.componentId!==release.componentId)fail('Cannot upgrade to a different library component');
  if(current.locallyModified)fail('Forked component requires an explicit merge before upgrade');
  const result=await materializeComponentRelease(release,{componentId:current.localComponentId,workspaceId:current.workspaceId});
  const reverse=Object.fromEntries(Object.entries(current.assetBindings).map(([key,value])=>[value,key]));
  const props=instanceProps.map(value=>{const mapped=clone(value);for(const [key,input]of Object.entries(release.component.inputs??{})){const old=value[key];if(input.type==='asset'&&typeof old==='string'&&Object.hasOwn(reverse,old)){const source=reverse[old];if(Object.hasOwn(result.pin.assetBindings,source))mapped[key]=result.pin.assetBindings[source];}}validateLibraryProps(result.component,mapped);return mapped;});
  return {...result,props};
}
export async function forkLibraryComponent(component: LibraryComponent, modules: Record<string,string>, pin: LibraryPin, newId: string) {
  if(!identifier(newId)||!/^[A-Za-z0-9_-]+$/.test(newId)||newId===component.id)fail('Fork requires a new component ID');
  const closure=await extractComponentModules(component.entry,modules);const prefix=`/components/forks/${newId}`;
  return {component:{...clone(component),id:newId,entry:prefix+component.entry},modules:Object.fromEntries(Object.entries(closure).map(([path,source])=>[prefix+path,source])),pin:{...clone(pin),localComponentId:newId,locallyModified:true}};
}

export interface LocalLibraryOptions {workspaceId: string; canPublish?: boolean}
/** Host-side adapter. Only the configured workspace can be read; publication also checks write capability. */
export function createFileSystemComponentLibrary(filesystem: BrowserFileSystem, options: LocalLibraryOptions): ComponentLibraryAdapter {
  if(!identifier(options.workspaceId))fail('Invalid library workspace');
  const root=`/component-library/${options.workspaceId}`;
  const authorize=(workspaceId:string,signal?:AbortSignal)=>{signal?.throwIfAborted();if(workspaceId!==options.workspaceId)fail('Library workspace access denied');};
  const load=async(path:string)=>JSON.parse(new TextDecoder().decode(await filesystem.readFile(path)));
  const get=async(query:{workspaceId:string;componentId:string;version:string},signal?:AbortSignal)=>{
    authorize(query.workspaceId,signal);if(!identifier(query.componentId)||!identifier(query.version))fail('Invalid component identity');
    try {const release=await load(`${root}/releases/${query.componentId}/${query.version}.json`) as ComponentRelease;await validateComponentRelease(release);if(release.componentId!==query.componentId||release.version!==query.version)fail('Library release identity mismatch');signal?.throwIfAborted();return release;}catch(error){if(missing(error))return null;throw error;}
  };
  let queue:Promise<unknown>=Promise.resolve();
  return {
    capabilities:{canPublish:options.canPublish!==false},
    get,
    async search(query,signal) {
      authorize(query.workspaceId,signal);const offset=query.offset??0,limit=query.limit??20;
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>componentLibraryLimits.pageSize||(query.query?.length??0)>512)fail('Invalid library search bounds');
      let paths;try{paths=await filesystem.list(`${root}/releases`,{recursive:true});}catch(error){if(missing(error))return{items:[],total:0,nextOffset:null};throw error;}
      const matches:LibrarySummary[]=[];const term=(query.query??'').toLowerCase();
      for(const path of paths){if(path.type!=='file'||!path.path.endsWith('.json'))continue;signal?.throwIfAborted();const release=await load(path.path) as ComponentRelease;await validateComponentRelease(release);if(query.kind&&release.kind!==query.kind)continue;if(term&&![release.name,release.description,...release.tags].join(' ').toLowerCase().includes(term))continue;const{componentId,version,hash,kind,name,description,tags,preview}=release;matches.push({componentId,version,hash,kind,name,description,tags,preview});}
      matches.sort((a,b)=>a.componentId.localeCompare(b.componentId)||a.version.localeCompare(b.version));
      return{items:matches.slice(offset,offset+limit),total:matches.length,nextOffset:offset+limit<matches.length?offset+limit:null};
    },
    publish(request,signal) {
      const operation=queue.then(async()=>{
        authorize(request.workspaceId,signal);if(options.canPublish===false)fail('Library publish access denied');if(request.authorized!==true)fail('Saving to the library requires explicit user authorization');if(!identifier(request.idempotencyKey))fail('Invalid library idempotency key');
        await validateComponentRelease(request.release);
        if(!request.release.preview)fail('Publishing requires a validated representative preview');
        const release=clone(request.release);const operationPath=`${root}/operations/${request.idempotencyKey}.json`;
        const operationRecord={componentId:release.componentId,version:release.version,hash:release.hash};
        try {await filesystem.writeFile(operationPath,JSON.stringify(operationRecord),{createParents:true,exclusive:true});}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='EEXIST'))throw error;if(canonical(await load(operationPath))!==canonical(operationRecord))fail('Idempotency key already belongs to another publication');}
        signal?.throwIfAborted();
        const path=`${root}/releases/${release.componentId}/${release.version}.json`;
        try{await filesystem.writeFile(path,JSON.stringify(release),{createParents:true,exclusive:true});}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='EEXIST'))throw error;const existing=await get({workspaceId:request.workspaceId,componentId:release.componentId,version:release.version},signal);if(!existing||existing.hash!==release.hash)throw new Error('Published component versions are immutable');return existing;}
        return release;
      });queue=operation.catch(()=>{});return operation;
    },
  };
}
export function createMemoryComponentLibrary(options: LocalLibraryOptions) {return createFileSystemComponentLibrary(new MemoryFileSystem(),options);}
