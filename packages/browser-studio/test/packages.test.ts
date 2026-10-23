import {describe,it,expect,vi} from 'vitest';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {AIMessage} from '@langchain/core/messages';
import {createAdSession,importAdBundle} from '../src/ad-session.js';
import {zipToSnapshot} from '../src/zip.js';
import {emptyPackageLock,preparePackageInstall,packageImports,packageHash,readPackageLock,stagePackageInstall,inspectPackage,packageLockPath} from '../src/packages.js';
const root='https://esm.sh/demo@1.0.0?target=es2022&external=react,react/jsx-runtime,react/jsx-dev-runtime,remotion';
const code='https://esm.sh/demo@1.0.0/es2022/demo.mjs';
const dep='https://esm.sh/helper@2.0.0/es2022/helper.mjs';
function transport(overrides:Record<string,string>={}) {
 const files:Record<string,string>={
  'https://registry.npmjs.org/demo/latest':JSON.stringify({name:'demo',version:'1.0.0',license:'MIT'}),
  'https://registry.npmjs.org/demo/1.0.0':JSON.stringify({name:'demo',version:'1.0.0',license:'MIT'}),
  [root]:`export * from '/demo@1.0.0/es2022/demo.mjs';`,
  [code]:`import {value} from '/helper@2.0.0/es2022/helper.mjs'; export const color=value;`,
  [dep]:`export const value='green';`,...overrides,
 };
 return vi.fn(async(url:any,options:any)=>{expect(options.credentials).toBe('omit');expect(options.redirect).toBe('error');return new Response(files[String(url)]??'missing',{status:String(url)in files?200:404});}) as any;
}
describe('project packages',()=>{
 it('inspects metadata and pins the entire exact graph with source hashes',async()=>{
  const fetch=transport();expect((await inspectPackage('demo',undefined,{fetch})).status).toBe('not-tested');
  const lock=await preparePackageInstall(emptyPackageLock(),'demo','1.0.0',{fetch});
  expect(Object.keys(lock.modules)).toHaveLength(3);expect(lock.packages[0].imports).toEqual(['demo']);
  for(const file of Object.values(lock.modules))expect(file.sha256).toBe(await packageHash(file.source));
  expect(lock.modules[code].imports['/helper@2.0.0/es2022/helper.mjs']).toBe(dep);
  await expect(preparePackageInstall(lock,'demo','2.0.0',{fetch})).rejects.toThrow('implicit upgrades');
  fetch.mockClear();await preparePackageInstall(lock,'demo','1.0.0',{fetch});expect(fetch).not.toHaveBeenCalled();
 });
 it('pins transitive semver wrappers to exact CDN paths and checks resolved identity',async()=>{
  const base=transport({[code]:"import {value} from '/helper@^2.0.0?target=es2022';export const color=value;"});
  const fetch=vi.fn(async(url:any,options:any)=>String(url).includes('helper@^')?new Response('unexecuted wrapper',{headers:{'X-ESM-Path':'/helper@2.0.0/es2022/helper.mjs'}}):base(url,options)) as any;
  const lock=await preparePackageInstall(emptyPackageLock(),'demo','1.0.0',{fetch});
  expect(lock.modules[code].imports['/helper@^2.0.0?target=es2022']).toBe(dep);
  expect(Object.keys(lock.modules).every(url=>!url.includes('^'))).toBe(true);
  const mismatch=(async(url:any,options:any)=>String(url).includes('helper@^')?new Response('',{headers:{'X-ESM-Path':'https://evil.example/module.js'}}):base(url,options)) as any;
  await expect(preparePackageInstall(emptyPackageLock(),'demo','1.0.0',{fetch:mismatch})).rejects.toThrow('URL');
 });
 it('rejects remote domains, unpinned and Node dependencies and applies transitive policy',async()=>{
  for(const target of ['https://evil.example/payload.js','/node/fs.mjs','/helper@latest/index.mjs','node:fs']){
   await expect(preparePackageInstall(emptyPackageLock(),'demo','1.0.0',{fetch:transport({[code]:`import '${target}';`})})).rejects.toThrow();
  }
  await expect(preparePackageInstall(emptyPackageLock(),'demo','1.0.0',{fetch:transport(),allowedPackages:['demo']})).rejects.toThrow('helper');
  for(const name of ['https://esm.sh/demo','../demo','react','react-dom'])await expect(inspectPackage(name,undefined,{fetch:transport()})).rejects.toThrow();
  await expect(inspectPackage('demo',undefined,{enabled:false})).rejects.toThrow('disabled');
  await expect(preparePackageInstall(emptyPackageLock(),'demo','latest',{fetch:transport()})).rejects.toThrow('exact version');
 });
 it('rejects unsupported runtime features and oversize responses without running package code',async()=>{
  for(const source of ["import('x')","require('x')",'process.env.HOME','new Worker("x")','fetch("https://x")','import.meta.url','eval("1")'])expect(()=>packageImports(source)).toThrow();
  await expect(preparePackageInstall(emptyPackageLock(),'demo','1.0.0',{fetch:transport({[code]:' '.repeat(512*1024+1)})})).rejects.toThrow('size limit');
 });
 it('does not write a failed installation and detects snapshot tampering',async()=>{
  const fs=new MemoryFileSystem();const failed=vi.fn(async()=>{throw new Error('Render failed');});
  await expect(stagePackageInstall(fs,'demo','1.0.0',failed,{fetch:transport()})).rejects.toThrow('Render failed');
  expect((await readPackageLock(fs)).packages).toEqual([]);
  await stagePackageInstall(fs,'demo','1.0.0',async()=>{}, {fetch:transport()});
  const lock=await readPackageLock(fs);lock.modules[code].source+=';';
  await fs.writeFile(packageLockPath,JSON.stringify(lock));await expect(readPackageLock(fs)).rejects.toThrow('integrity');
 });
 it('persists through session undo/redo, bundle and ZIP without CDN access',async()=>{
  const fetch=transport();const render=vi.fn(async()=>({frames:[{format:'story',timeSeconds:0,dataUrl:'data:image/png;base64,cGl4ZWxz'}]}));
  const options={projectId:'packages',packages:{fetch},adapters:{model:{} as any,storage:new MemoryFileSystem(),render,renderSupportsScenes:true as const,renderSupportsPackages:true as const}};
  const session=await createAdSession(options);await session.packages.install('demo','1.0.0');
  expect((await session.renderInputs())[0].packages?.packages[0].name).toBe('demo');
  await session.undo();expect((await session.packages.list()).installed).toHaveLength(0);
  await session.redo();expect((await session.packages.list()).installed).toHaveLength(1);
  const archive=await session.downloadZip();const snapshot=(await zipToSnapshot(archive)).snapshot;
  expect((JSON.parse(await snapshot.text())).files.some(file=>file.path===packageLockPath)).toBe(true);
  fetch.mockClear();const restored=await importAdBundle(await session.downloadBundle(),{...options,projectId:'restored-packages',adapters:{...options.adapters,storage:new MemoryFileSystem()}});
  expect((await restored.renderInputs())[0].packages).toEqual((await session.renderInputs())[0].packages);expect(fetch).not.toHaveBeenCalled();
 });
 it('forks scenes using installed package imports without copying or losing their lock',async()=>{
  const session=await createAdSession({projectId:'package-fork',packages:{fetch:transport()},adapters:{model:{} as any,storage:new MemoryFileSystem(),renderSupportsScenes:true,renderSupportsPackages:true,render:async()=>({frames:[{format:'story',timeSeconds:0,dataUrl:'data:image/png;base64,cGl4ZWxz'}]})}});
  await session.packages.install('demo','1.0.0');
  await session.editScenes({baseRevision:(await session.sceneState()).revision,operations:[{type:'addComponent',component:{id:'scene',entry:'/Scene.tsx',authoredDurationInFrames:240},source:"import {color} from 'demo';export default ()=> <div style={{color}}/>"},{type:'addScene',scene:{id:'scene',componentId:'scene',startFrame:0,durationInFrames:240,sourceStartFrame:0,layer:0,props:{}}}]});
  await session.editScenes({baseRevision:(await session.sceneState()).revision,operations:[{type:'forkScene',id:'scene',componentId:'fork',entry:'/Fork.tsx'}]});
  expect((await session.sceneState()).composition!.scenes[0].componentId).toBe('fork');
  expect((await session.packages.list()).installed[0].name).toBe('demo');
 });
 it('exposes all agent tools and lets the agent recover from an installation refusal',async()=>{
  let turn=0;let names:string[]=[];
  const model={withStructuredOutput:()=>({invoke:async()=>({concept:'Packages',scenes:[{id:null,componentId:null,start:0,end:8,copy:'',visual:'A package',motion:'None',assetKeys:[]}],assets:[],nextChanges:['Install demo']})}),bindTools:(tools:any[])=>{names=tools.map(t=>t.name);return {invoke:async(messages:any[])=>{
   const calls=[{id:'list',name:'list_packages',args:{}},{id:'bad',name:'install_package',args:{name:'demo',version:'latest'}},{id:'inspect',name:'inspect_package',args:{name:'demo',version:null}},{id:'install',name:'install_package',args:{name:'demo',version:'1.0.0'}},{id:'finish',name:'finish_design',args:{}}];
   if(turn===2)expect(String(messages.at(-1).content)).toContain('exact version');
   return new AIMessage({content:'',tool_calls:[calls[turn++]]});
  }}}} as any;
  const session=await createAdSession({projectId:'agent-packages',initialMode:'source',packages:{fetch:transport()},adapters:{model,storage:new MemoryFileSystem(),renderSupportsPackages:true,render:async()=>({frames:[{format:'story',timeSeconds:0,dataUrl:'data:image/png;base64,cGl4ZWxz'}]})}});
  await session.send('Install demo',{review:false});
  expect(names).toEqual(expect.arrayContaining(['list_packages','inspect_package','install_package']));
  expect((await session.packages.list()).installed[0].version).toBe('1.0.0');
 });
});
