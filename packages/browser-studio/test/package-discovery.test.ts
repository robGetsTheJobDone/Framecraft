import {describe,it,expect} from 'vitest';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {AIMessage} from '@langchain/core/messages';
import {createAdSession} from '../src/ad-session.js';
import {emptyPackageLock,inspectPackage,listPackageVersions,listPackageFiles,readPackageFile,searchPackages,probePackage,preparePackageInstall,stagePackageInstall,readPackageLock} from '../src/packages.js';
const raw='https://cdn.jsdelivr.net/npm/demo@1.0.0/dist/browser.js';
const helper='https://cdn.jsdelivr.net/npm/demo@1.0.0/dist/helper.js';
const metadata={name:'demo',version:'1.0.0',module:'./dist/browser.js',main:'./index.cjs',types:'./index.d.ts',dependencies:{helper:'^2'}};
const transport:typeof fetch=async(input,options)=>{
 expect(options?.redirect).toBe('error');expect(options?.credentials).toBe('omit');
 const url=String(input);
 if(url.startsWith('https://esm.sh/'))return new Response('remote storage unavailable',{status:500});
 if(url.startsWith('https://registry.npmjs.org/-/v1/search?'))return Response.json({objects:[{package:{name:'demo',version:'1.0.0',description:'Browser visuals'}}]});
 if(url.startsWith('https://registry.npmjs.org/demo/'))return Response.json(metadata);
 if(url==='https://data.jsdelivr.com/v1/package/npm/demo')return Response.json({tags:{latest:'1.0.0'},versions:['1.0.0','0.9.0']});
 if(url==='https://data.jsdelivr.com/v1/package/npm/demo@1.0.0/flat')return Response.json({files:[{name:'/README.md',size:42},{name:'/dist/browser.js',size:80},{name:'/dist/helper.js',size:30}]});
 if(url===raw)return new Response(`export {color} from './helper.js';`);
 if(url===helper)return new Response(`export const color='green';`);
 if(url==='https://cdn.jsdelivr.net/npm/demo@1.0.0/README.md')return new Response('Use the browser module from dist/browser.js.');
 return new Response('missing',{status:404});
};
describe('package discovery and agent-selected sources',()=>{
 it('discovers metadata, versions, filtered files and bounded documentation',async()=>{
  const policy={fetch:transport};
  expect((await searchPackages('visuals',policy)).results[0].name).toBe('demo');
  const info=await inspectPackage('demo',undefined,policy);
  expect(info.candidates).toContainEqual(expect.objectContaining({source:'jsdelivr',entryPath:'./dist/browser.js'}));
  expect(info.entryPoints.types).toBe('./index.d.ts');
  expect((await listPackageVersions('demo',0,1,policy))).toMatchObject({versions:['1.0.0'],nextOffset:1});
  expect((await listPackageFiles('demo','1.0.0','dist',0,1,policy))).toMatchObject({files:[{path:'/dist/browser.js',size:80}],nextOffset:1});
  expect((await readPackageFile('demo','1.0.0','README.md',0,policy)).content).toContain('browser module');
 });
 it('returns actionable failures, tests another source without writes, then pins the chosen graph',async()=>{
  const policy={fetch:transport};const fs=new MemoryFileSystem();
  const failed=await probePackage(emptyPackageLock(),'demo','1.0.0',{source:'esm.sh'},policy);
  expect(failed).toMatchObject({ok:false,stage:'download',httpStatus:500,projectChanged:false});
  const selection={source:'jsdelivr' as const,entryPath:'dist/browser.js'};
  expect(await probePackage(emptyPackageLock(),'demo','1.0.0',selection,policy,undefined,async()=>{})).toMatchObject({ok:true,entry:raw,validation:'sandbox-import-and-project-render',projectChanged:false});
  expect((await readPackageLock(fs)).packages).toHaveLength(0);
  await stagePackageInstall(fs,'demo','1.0.0',async()=>{},policy,undefined,selection);
  const lock=await readPackageLock(fs);expect(lock.packages[0].entry).toBe(raw);expect(lock.modules[raw].imports['./helper.js']).toBe(helper);
  await expect(preparePackageInstall(lock,'demo','1.0.0',{fetch:async()=>{throw new Error('Offline');}})).resolves.toEqual(lock);
 });
 it('keeps policy, version, URL and compatibility checks on every source',async()=>{
  const policy={fetch:transport};
  await expect(readPackageFile('demo','1.0.0','../../secret',0,policy)).rejects.toThrow('package-relative');
  await expect(readPackageFile('demo','latest','README.md',0,policy)).rejects.toThrow('exact');
  await expect(listPackageVersions('demo',0,20,{...policy,enabled:false})).rejects.toThrow('disabled');
  await expect(inspectPackage('demo',undefined,{...policy,allowedPackages:['other']})).rejects.toThrow('not allowed');
  for(const target of ['https://evil.example/code.js','https://cdn.jsdelivr.net/npm/demo@latest/a.js','https://cdn.jsdelivr.net/npm/react@19.0.0/index.js']){
   const fetch:typeof globalThis.fetch=async(url,options)=>String(url)===raw?new Response(`import '${target}';`):transport(url,options);
   expect(await probePackage(emptyPackageLock(),'demo','1.0.0',{source:'jsdelivr',entryPath:'dist/browser.js'},{fetch})).toMatchObject({ok:false,projectChanged:false});
  }
 });
 it('lets an agent inspect a failed probe, discover another entry, and install its successful choice',async()=>{
  let turn=0;let names:string[]=[];let selection:any;
  const model={withStructuredOutput:()=>({invoke:async()=>({durationSeconds:null,concept:'Package discovery',scenes:[{id:null,componentId:null,start:0,end:8,copy:'',visual:'Package',motion:'None',assetKeys:[]}],assets:[],nextChanges:['Find a working package source']})}),bindTools:(tools:any[])=>{names=tools.map(tool=>tool.name);return {invoke:async(messages:any[])=>{
   const previous=turn?JSON.parse(String(messages.at(-1).content)):undefined;
   if(turn===1)expect(previous).toMatchObject({ok:false,httpStatus:500,projectChanged:false});
   if(turn===2)selection=previous.candidates.find((candidate:any)=>candidate.source==='jsdelivr'&&candidate.entryPath===previous.entryPoints.module);
   if(turn===4){expect(previous.ok).toBe(true);selection=previous.installArguments;}
   const calls=[
    {name:'probe_package',args:{name:'demo',version:'1.0.0',source:'esm.sh',entryPath:null}},
    {name:'inspect_package',args:{name:'demo',version:'1.0.0'}},
    {name:'list_package_files',args:{name:'demo',version:'1.0.0',filter:'dist',offset:null,limit:null}},
    {name:'probe_package',args:{name:'demo',version:'1.0.0',source:selection?.source??'jsdelivr',entryPath:selection?.entryPath??'dist/browser.js'}},
    {name:'install_package',args:selection??{}},
    {name:'finish_design',args:{}},
   ];
   const call=calls[turn];return new AIMessage({content:'',tool_calls:[{id:String(turn++),...call}]});
  }}}} as any;
  const session=await createAdSession({projectId:'discovery',initialMode:'source',packages:{fetch:transport},adapters:{model,storage:new MemoryFileSystem(),renderSupportsPackages:true,render:async()=>({frames:[{format:'story',timeSeconds:0,dataUrl:'data:image/png;base64,cGl4ZWxz'}]})}});
  await session.send('Use demo 1.0.0; find a working source',{review:false});
  expect(names).toEqual(expect.arrayContaining(['search_packages','list_package_versions','list_package_files','read_package_file','probe_package','install_package']));
  expect((await readPackageLock(session.filesystem)).packages[0].entry).toBe(raw);
 });
});
