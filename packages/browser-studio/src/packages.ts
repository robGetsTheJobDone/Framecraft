import {parse} from '@babel/parser';
import {packageBuiltins, packageLimits, validatePackageGraph, verifyPackageIntegrity, type PackageLock} from '@deepbench/browser-ad-renderer';
import type {BrowserFileSystem} from '@deepbench/browser-filesystem';
export const packageLockPath='/packages.lock.json';
export interface PackagePolicy {
  /** Disable installation/inspection in hosts that cannot fetch third-party code. */
  enabled?:boolean;
  /** Optional allowlist, applied to every downloaded package including transitive dependencies. */
  allowedPackages?:string[];
  /** Injectable transport for hosts/tests. Responses remain subject to URL and size checks. */
  fetch?:typeof globalThis.fetch;
}
const namePattern=/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const versionPattern=/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
export const emptyPackageLock=():PackageLock=>({version:1,packages:[],modules:{}});
export async function packageHash(source:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function readPackageLock(fs:BrowserFileSystem):Promise<PackageLock> {
  let value:PackageLock;
  try {value=JSON.parse(new TextDecoder().decode(await fs.readFile(packageLockPath)));}catch(error){if(error instanceof Error&&'code'in error&&error.code==='ENOENT')return emptyPackageLock();throw error;}
  await verifyPackageLock(value);return value;
}
export const verifyPackageLock=verifyPackageIntegrity;
/** Static compatibility checks are not a malware scanner. Sandbox restrictions remain mandatory. */
export function packageImports(source:string):string[] {
  const ast=parse(source,{sourceType:'module'});const imports=new Set<string>();
  const visit=(node:any)=>{
    if(!node||typeof node!=='object')return;
    if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source)imports.add(node.source.value);
    if(node.type==='ImportExpression'||node.type==='Import'||node.type==='MetaProperty')throw new Error('Package requires dynamic imports or import.meta; unsupported in offline rendering');
    if(node.type==='CallExpression'&&node.callee?.type==='Identifier'&&['require','eval','Function','importScripts','fetch'].includes(node.callee.name))throw new Error(`Unsupported package API: ${node.callee.name}`);
    if(node.type==='NewExpression'&&node.callee?.type==='Identifier'&&['Function','Worker','SharedWorker','WebSocket','XMLHttpRequest','EventSource'].includes(node.callee.name))throw new Error(`Unsupported package API: ${node.callee.name}`);
    if(node.type==='Identifier'&&['process','Buffer','Deno','Bun'].includes(node.name))throw new Error(`Package requires unsupported runtime: ${node.name}`);
    for(const [key,value]of Object.entries(node))if(!['loc','start','end','comments','tokens'].includes(key)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}
  };
  visit(ast);return [...imports];
}
function permit(name:string,policy:PackagePolicy){
  if(policy.enabled===false)throw new Error('Package installation is disabled by this host');
  if(!namePattern.test(name)||packageBuiltins.includes(name as any)||['react-dom','react-native'].includes(name))throw new Error('Provide a package name; built-in runtimes cannot be replaced');
  if(policy.allowedPackages&&!policy.allowedPackages.includes(name))throw new Error(`Package is not allowed by host policy: ${name}`);
}
function cdnURL(input:string,policy:PackagePolicy):string {
  const url=new URL(input);
  if(url.origin!=='https://esm.sh'||url.username||url.password||url.hash||/%|\\/.test(url.pathname))throw new Error('Unsupported package URL');
  const match=url.pathname.match(/^\/((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)(?:\/|$)/);
  if(!match)throw new Error(`Dependency is not an exact browser package: ${url.pathname}`);
  permit(match[1],policy);
  if(/\.(css|wasm|json)$/.test(url.pathname))throw new Error('Non-JavaScript package assets are unsupported');
  return url.href;
}
async function downloadResponse(url:string,policy:PackagePolicy,signal?:AbortSignal){
  const timeout=AbortSignal.timeout(15000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  const response=await (policy.fetch??globalThis.fetch)(url,{signal:combined,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error(`Package download failed (${response.status})`);
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty package response');
  const chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>packageLimits.moduleBytes)throw new Error('Package response exceeds size limit');chunks.push(value);}}
  catch(error){await reader.cancel();throw error;}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes), resolvedPath:response.headers.get('X-ESM-Path')};
}
async function download(url:string,policy:PackagePolicy,signal?:AbortSignal){return (await downloadResponse(url,policy,signal)).text;}
export async function inspectPackage(name:string,version:string|undefined,policy:PackagePolicy={},signal?:AbortSignal){
  permit(name,policy);if(version&&!versionPattern.test(version))throw new Error('Use an exact version, not a tag or range');
  const meta=JSON.parse(await download(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version??'latest'}`,policy,signal));
  if(meta.name!==name||!versionPattern.test(meta.version)||(version&&meta.version!==version))throw new Error('Registry metadata does not match the requested package');
  return {name,version:meta.version as string,license:typeof meta.license==='string'?meta.license.slice(0,100):null,dependencies:Object.keys(meta.dependencies??{}).slice(0,128),peerDependencies:Object.fromEntries(Object.entries(meta.peerDependencies??{}).slice(0,128).filter(([key,value])=>namePattern.test(key)&&typeof value==='string').map(([key,value])=>[key,String(value).slice(0,100)])),supportedImports:[name],status:'not-tested' as const,message:'Metadata only; install tests the exact dependency graph. No safety certification. Root entry imports only.'};
}
export async function preparePackageInstall(current:PackageLock,name:string,version:string,policy:PackagePolicy={},signal?:AbortSignal):Promise<PackageLock>{
  const transport=policy.fetch??globalThis.fetch;let requests=0;
  policy={...policy,fetch:async(...args)=>{if(++requests>packageLimits.modules*2+2)throw new Error('Package request budget exceeded');return transport(...args);}};
  const deadline=AbortSignal.timeout(60000);signal=signal?AbortSignal.any([signal,deadline]):deadline;
  permit(name,policy);if(!versionPattern.test(version))throw new Error('Installation requires an exact version; inspect_package first');
  validatePackageGraph(current);
  const installed=current.packages.find(pkg=>pkg.name===name);
  if(installed){if(installed.version===version)return structuredClone(current);throw new Error('A different version is already installed; implicit upgrades are disabled');}
  await inspectPackage(name,version,policy,signal);
  const next=structuredClone(current);
  const entry=cdnURL(`https://esm.sh/${name}@${version}?target=es2022&external=react,react/jsx-runtime,react/jsx-dev-runtime,remotion`,policy);
  let total=Object.values(next.modules).reduce((n,file)=>n+new TextEncoder().encode(file.source).length,0);
  const loading=new Set<string>();
  const resolutions=new Map<string,string>();
  const dependency=async(specifier:string,importer:string)=>{
    const request=new URL(specifier,importer);
    if(request.origin!=='https://esm.sh'||request.username||request.password||request.hash||request.pathname.includes('\\'))throw new Error('Unsupported package URL');
    const match=request.pathname.match(/^\/((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@([^/]+)(?:\/|$)/);
    if(!match)throw new Error('Dependency is not an exact browser package');
    permit(match[1],policy);
    if(versionPattern.test(match[2]))return cdnURL(request.href,policy);
    if(resolutions.has(request.href))return resolutions.get(request.href)!;
    // CDN wrappers expose the exact compiled path. Never execute or persist a floating URL.
    const {resolvedPath}=await downloadResponse(request.href,policy,signal);
    if(!resolvedPath)throw new Error('CDN did not pin a transitive dependency');
    const resolved=cdnURL(new URL(resolvedPath,'https://esm.sh').href,policy);
    if(!new URL(resolved).pathname.startsWith('/'+match[1]+'@'))throw new Error('Resolved package identity mismatch');
    resolutions.set(request.href,resolved);return resolved;
  };
  const load=async(url:string):Promise<void>=>{
    signal?.throwIfAborted();url=cdnURL(url,policy);
    if(Object.hasOwn(next.modules,url)||loading.has(url))return;
    if(Object.keys(next.modules).length+loading.size>=packageLimits.modules)throw new Error('Too many package modules');
    loading.add(url);
    const source=await download(url,policy,signal);total+=new TextEncoder().encode(source).length;
    if(total>packageLimits.totalBytes)throw new Error('Package graph exceeds size limit');
    const imports:Record<string,string>=Object.create(null);
    for(const specifier of packageImports(source)){
      if(packageBuiltins.includes(specifier as any)){imports[specifier]=specifier;continue;}
      if(!specifier.startsWith('/')&&!specifier.startsWith('./')&&!specifier.startsWith('../')&&!specifier.startsWith('https://'))throw new Error(`Unresolved package dependency: ${specifier}`);
      const target=await dependency(specifier,url);imports[specifier]=target;await load(target);
    }
    next.modules[url]={source,sha256:await packageHash(source),imports};loading.delete(url);
  };
  await load(entry);next.packages.push({name,version,entry,imports:[name]});validatePackageGraph(next);return next;
}
export async function stagePackageInstall(fs:BrowserFileSystem,name:string,version:string,validate:(lock:PackageLock)=>Promise<void>,policy:PackagePolicy={},signal?:AbortSignal){
  const next=await preparePackageInstall(await readPackageLock(fs),name,version,policy,signal);
  await validate(next);signal?.throwIfAborted();
  await fs.writeFile(packageLockPath,JSON.stringify(next),{createParents:true});
  return next.packages.find(pkg=>pkg.name===name)!;
}
