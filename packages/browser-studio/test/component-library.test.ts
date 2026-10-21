import {describe,it,expect} from 'vitest';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {createStudioProject} from '@deepbench/studio-project';
import {prepareComponentRelease,validateComponentRelease,createMemoryComponentLibrary,createFileSystemComponentLibrary,materializeComponentRelease,upgradeComponentRelease,extractComponentModules,forkLibraryComponent,type ComponentRelease} from '../src/component-library.js';
import {createSessionLibrary,componentLibraryLockPath} from '../src/component-library-session.js';

const fixture=()=>({componentId:'card',version:'1',name:'Product card',component:{id:'card',entry:'/scenes/Card.tsx',authoredDurationInFrames:90,inputs:{title:{type:'text' as const},image:{type:'asset' as const}},defaults:{title:'Hello',image:'logo'},assetBindings:{logo:'logo'}},modules:{'/scenes/Card.tsx':`import {label} from '../shared/label'; export default function Card({title}) {return <div>{label(title)}</div>}`,'/shared/label.ts':'export const label = (text: string) => text;','/unrelated.ts':'export const secret = "not included";'},assets:{logo:{kind:'image' as const,mimeType:'image/png',data:btoa('real image bytes')}},preview:{dataUrl:'data:image/png;base64,AAAA',props:{title:'Hello',image:'logo'},width:100,height:100,fps:30,frame:0}});
const release=async(version='1')=>prepareComponentRelease({...fixture(),version});

describe('component library packages',()=>{
  it('extracts dependency closure and binds content-addressed assets without changing source',async()=>{
    const item=await release();expect(Object.keys(item.modules).sort()).toEqual(['/scenes/Card.tsx','/shared/label.ts']);
    const local=await materializeComponentRelease(item);expect(local.component.entry).toContain('/components/library/');
    const assetId=local.pin.assetBindings.logo;expect(assetId).toMatch(/^lib-[a-f0-9]{64}$/);expect(local.component.defaults?.image).toBe(assetId);expect(local.component.assetBindings?.logo).toBe(assetId);
    expect(local.modules[local.component.entry]).toBe(item.modules[item.component.entry]);
    expect(await extractComponentModules(local.component.entry,local.modules)).toEqual(local.modules);
    const tampered=structuredClone(item);tampered.assets.logo.data=btoa('changed');await expect(validateComponentRelease(tampered)).rejects.toThrow('integrity');
  });
  it('accepts JSX apostrophes, transform templates and rejects nested dynamic imports',async()=>{
    await expect(extractComponentModules('/Card.tsx',{'/Card.tsx':"export default () => <div style={{transform:`translateX(${({x: 1}).x}px)`}}>It's a card</div>"})).resolves.toBeTruthy();
    await expect(extractComponentModules('/Card.tsx',{'/Card.tsx':"export default () => `${({x:1}, import('remote'))}`"})).rejects.toThrow('Dynamic imports');
    await expect(extractComponentModules('/Card.tsx',{'/Card.tsx':"import x from 'https://example.com/x'; export default x"})).rejects.toThrow('Unsupported');
    await expect(extractComponentModules('/Card.tsx',{'/Card.tsx':"import x from './missing'; export default x"})).rejects.toThrow('Missing');
  });
  it('keeps versions and instance overrides independent and rejects incompatible upgrade props',async()=>{
    const v1=await release();const v2=await prepareComponentRelease({...fixture(),version:'2',component:{...fixture().component,defaults:{title:'New',image:'logo'}}});
    const a=await materializeComponentRelease(v1),b=await materializeComponentRelease(v1);
    const upgraded=await upgradeComponentRelease(a.pin,v2,[{title:'My title'}]);expect(upgraded.props[0].title).toBe('My title');expect(upgraded.component.defaults?.title).toBe('New');expect(b.component.defaults?.title).toBe('Hello');expect(b.pin.version).toBe('1');
    const broken=await prepareComponentRelease({...fixture(),version:'3',component:{...fixture().component,inputs:{...fixture().component.inputs,required:{type:'number',required:true}}},preview:undefined});
    await expect(upgradeComponentRelease(a.pin,broken,[{}])).rejects.toThrow('required');
    const fork=await forkLibraryComponent(a.component,a.modules,a.pin,'custom-card');expect(fork.pin.locallyModified).toBe(true);expect(fork.component.id).toBe('custom-card');expect(await extractComponentModules(fork.component.entry,fork.modules)).toEqual(fork.modules);
  });
});

describe('component library providers',()=>{
  it('enforces workspace and write access and requires explicit save authorization',async()=>{
    const library=createMemoryComponentLibrary({workspaceId:'brand'}),item=await release();
    await expect(library.search({workspaceId:'other'})).rejects.toThrow('access denied');
    await expect(library.get({workspaceId:'other',componentId:'card',version:'1'})).rejects.toThrow('access denied');
    await expect(library.publish({workspaceId:'other',release:item,idempotencyKey:'save',authorized:true})).rejects.toThrow('access denied');
    await expect(library.publish({workspaceId:'brand',release:item,idempotencyKey:'save',authorized:false as true})).rejects.toThrow('authorization');
    const readOnly=createMemoryComponentLibrary({workspaceId:'brand',canPublish:false});await expect(readOnly.publish({workspaceId:'brand',release:item,idempotencyKey:'save',authorized:true})).rejects.toThrow('access denied');
    expect((await library.search({workspaceId:'brand'})).items).toEqual([]);
  });
  it('publishes immutable releases and deduplicates concurrent and restarted retries',async()=>{
    const fs=new MemoryFileSystem();const library=createFileSystemComponentLibrary(fs,{workspaceId:'brand'}),item=await release();
    const request={workspaceId:'brand',release:item,idempotencyKey:'save',authorized:true as const};
    const [a,b]=await Promise.all([library.publish(request),library.publish(request)]);expect(a.hash).toBe(b.hash);
    const reopened=createFileSystemComponentLibrary(fs,{workspaceId:'brand'});expect((await reopened.publish(request)).hash).toBe(a.hash);
    const altered=await prepareComponentRelease({...fixture(),name:'Changed'});await expect(library.publish({...request,release:altered})).rejects.toThrow('Idempotency');
    await expect(library.publish({...request,release:altered,idempotencyKey:'different'})).rejects.toThrow('immutable');
    expect((await library.search({workspaceId:'brand'})).total).toBe(1);
    a.modules['/scenes/Card.tsx']='corrupted client copy';expect((await library.get({workspaceId:'brand',componentId:'card',version:'1'}))?.hash).toBe(item.hash);
  });
  it('bounds search, filters metadata and resumes publication after an uncertain outcome',async()=>{
    const fs=new MemoryFileSystem();let failOnce=true;
    const uncertain={...fs,readFile:fs.readFile.bind(fs),stat:fs.stat.bind(fs),list:fs.list.bind(fs),mkdir:fs.mkdir.bind(fs),remove:fs.remove.bind(fs),writeFile:async(...args:Parameters<MemoryFileSystem['writeFile']>)=>{await fs.writeFile(...args);if(args[0].includes('/releases/')&&failOnce){failOnce=false;throw new Error('network result lost');}}};
    const library=createFileSystemComponentLibrary(uncertain,{workspaceId:'brand'});const request={workspaceId:'brand',release:await release(),idempotencyKey:'save',authorized:true as const};await expect(library.publish(request)).rejects.toThrow('lost');await expect(library.publish(request)).resolves.toMatchObject({version:'1'});
    await library.publish({...request,release:await release('2'),idempotencyKey:'save2'});const page=await library.search({workspaceId:'brand',query:'product',limit:1});expect(page.total).toBe(2);expect(page.nextOffset).toBe(1);expect((await library.search({workspaceId:'brand',offset:1,limit:1})).nextOffset).toBeNull();
    await expect(library.search({workspaceId:'brand',limit:51})).rejects.toThrow('bounds');
  });
});

function sessionHarness(adapter:ReturnType<typeof createMemoryComponentLibrary>) {
  let project=createStudioProject({durationSeconds:10});project.schemaVersion=2;project.composition={version:1,components:[],scenes:[]};let modules:Record<string,string>={},revision=0;const fs=new MemoryFileSystem();
  const api=createSessionLibrary({adapter,workspaceId:'brand',readState:async()=>({project:structuredClone(project),modules:structuredClone(modules),revision:String(revision)}),readFile:async path=>new TextDecoder().decode(await fs.readFile(path)),resolveAsset:async asset=>new Blob([await fs.readFile('/'+asset.path)]),renderPreview:async (r,props)=>({...fixture().preview,props:props??r.component.defaults??{}}),commit:async input=>{if(input.baseRevision!==String(revision))throw new Error('conflict');for(const a of input.assets??[])await fs.writeFile('/assets/'+a.metadata.id,a.data instanceof Blob?new Uint8Array(await a.data.arrayBuffer()):a.data,{createParents:true});for(const [path,contents]of Object.entries(input.extraFiles??{}))await fs.writeFile(path,contents,{createParents:true});project=structuredClone(input.project);modules=structuredClone(input.modules);revision++;return revision;}});
  return{api,fs,state:()=>({project,modules}),editModule:(path:string,value:string)=>{modules[path]=value;},addProjectAsset:async(id:string,data:string)=>{project.assets.push({id,kind:'image',mimeType:'image/png',path:`assets/${id}`});await fs.writeFile('/assets/'+id,data,{createParents:true});}};
}
describe('session library integration helpers',()=>{
  it('pins separately in projects, upgrades one, forks one instance, and restores portable lock',async()=>{
    const adapter=createMemoryComponentLibrary({workspaceId:'brand'});await adapter.publish({workspaceId:'brand',release:await release(),idempotencyKey:'save1',authorized:true});
    const a=sessionHarness(adapter),b=sessionHarness(adapter);const inserted=await a.api.insert({componentId:'card',version:'1',props:{title:'A'}});await a.api.insert({componentId:'card',version:'1',props:{title:'B'}});await b.api.insert({componentId:'card',version:'1'});
    await adapter.publish({workspaceId:'brand',release:await release('2'),idempotencyKey:'save2',authorized:true});await a.api.upgrade({localComponentId:inserted.pin.localComponentId,version:'2'});expect((await a.api.readPins())[0].version).toBe('2');expect((await b.api.readPins())[0].version).toBe('1');
    await a.api.fork({sceneId:inserted.sceneId,newComponentId:'only-first'});expect(a.state().project.composition?.scenes[0].componentId).toBe('only-first');expect(a.state().project.composition?.scenes[1].componentId).toBe(inserted.pin.localComponentId);expect(await a.fs.readFile(componentLibraryLockPath)).toBeTruthy();
    expect(Object.keys(b.state().modules).length).toBe(2);expect(b.state().project.assets.length).toBe(1);
  });
  it('does not overwrite locally edited source during upgrade or reinsertion',async()=>{
    const adapter=createMemoryComponentLibrary({workspaceId:'brand'});for(const version of ['1','2'])await adapter.publish({workspaceId:'brand',release:await release(version),idempotencyKey:'save'+version,authorized:true});const session=sessionHarness(adapter);const inserted=await session.api.insert({componentId:'card',version:'1'});const entry=session.state().project.composition!.components[0].entry;session.editModule(entry,'export default () => <div>local</div>');await expect(session.api.upgrade({localComponentId:inserted.pin.localComponentId,version:'2'})).rejects.toThrow('local source edits');await expect(session.api.insert({componentId:'card',version:'1'})).rejects.toThrow('local changes');expect((await session.api.readPins())[0].version).toBe('1');expect(session.state().modules[entry]).toContain('local');expect(session.state().project.composition!.scenes).toHaveLength(1);
  });
  it('saves only an authorized dependency closure with representative instance props and rejects asset collisions',async()=>{
    const adapter=createMemoryComponentLibrary({workspaceId:'brand'});await adapter.publish({workspaceId:'brand',release:await release(),idempotencyKey:'seed',authorized:true});const session=sessionHarness(adapter);const inserted=await session.api.insert({componentId:'card',version:'1',props:{title:'Instance copy'}});
    const request={localComponentId:inserted.pin.localComponentId,componentId:'saved-card',version:'1',name:'Saved card',idempotencyKey:'save-local',authorized:true as const};
    await expect(session.api.save({...request,authorized:false as true})).rejects.toThrow('authorization');expect((await adapter.search({workspaceId:'brand'})).total).toBe(1);
    const saved=await session.api.save(request);expect(saved.preview?.props.title).toBe('Instance copy');expect(saved.component.defaults?.title).toBe('Hello');expect(Object.keys(saved.modules)).toHaveLength(2);expect(Object.keys(saved.assets)).toHaveLength(1);
    const asset=session.state().project.assets[0];await session.fs.writeFile('/'+asset.path,'incorrect bytes');await expect(session.api.insert({componentId:'card',version:'1'})).rejects.toThrow('content collision');expect(session.state().project.composition?.scenes).toHaveLength(1);
  });
  it('preserves explicit project assets when bundled IDs collide, including during upgrade',async()=>{
    const adapter=createMemoryComponentLibrary({workspaceId:'brand'});const first=await release();const second=await prepareComponentRelease({...fixture(),version:'2',assets:{logo:{...fixture().assets.logo,data:btoa('new library image')}}});for(const item of [first,second])await adapter.publish({workspaceId:'brand',release:item,idempotencyKey:'save'+item.version,authorized:true});
    const session=sessionHarness(adapter);await session.addProjectAsset('logo','project image');const imported=await session.api.insert({componentId:'card',version:'1',props:{image:'logo'},projectAssetInputs:['image']});await session.api.insert({componentId:'card',version:'1',props:{image:'logo'}});expect(session.state().project.composition!.scenes[0].props.image).toBe('logo');expect(session.state().project.composition!.scenes[1].props.image).not.toBe('logo');
    await session.api.upgrade({localComponentId:imported.pin.localComponentId,version:'2'});expect(session.state().project.composition!.scenes[0].props.image).toBe('logo');expect(session.state().project.composition!.scenes[1].props.image).not.toBe(imported.pin.assetBindings.logo);expect(new TextDecoder().decode(await session.fs.readFile('/assets/logo'))).toBe('project image');
  });
  it('rejects upgrades from another workspace and a provider returning the wrong version',async()=>{
    const adapter=createMemoryComponentLibrary({workspaceId:'brand'});const first=await release(),second=await release('2');for(const item of [first,second])await adapter.publish({workspaceId:'brand',release:item,idempotencyKey:'save'+item.version,authorized:true});const session=sessionHarness(adapter);const imported=await session.api.insert({componentId:'card',version:'1'});expect(imported.pin.workspaceId).toBe('brand');
    const pins=await session.api.readPins();pins[0].workspaceId='original-brand';await session.fs.writeFile(componentLibraryLockPath,JSON.stringify({schemaVersion:1,pins}));await expect(session.api.upgrade({localComponentId:imported.pin.localComponentId,version:'2'})).rejects.toThrow('another library workspace');
    const incorrect=sessionHarness({...adapter,get:async()=>second});await expect(incorrect.api.inspect({componentId:'card',version:'1'})).rejects.toThrow('different component version');expect(incorrect.state().project.composition!.scenes).toHaveLength(0);
  });
});
