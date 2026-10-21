import {describe,it,expect} from 'vitest';
import {AIMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {createAdSession, importAdBundle} from '../src/ad-session.js';
import {adProductionPlanSchema,storedProductionPlanSchema} from '../src/production-plan.js';
import {z} from 'zod';
import {createSkillRegistry} from '../src/skills.js';
const source=(round:number)=>`export default function Ad(){return <div>Round ${round}</div>}`;
const plan={concept:'A clear ad',scenes:[{id:null,componentId:null,start:0,end:8,copy:'Hi',visual:'Blue',motion:'Title entrance',assetKeys:[]}],assets:[],nextChanges:['Improve layout']};
function model(needsProductionPlan=false) {
 let designs=0,reviews=0,plans=0;const evidence:unknown[]=[];
 return {stats:()=>({designs,reviews,plans,evidence}), model:{
  withStructuredOutput:(_schema:unknown,{name}:{name:string})=>({invoke:async(messages:unknown)=>{if(name==='edit_plan')return {changes:['Change the title color only'],preserve:['Scenes and imagery'],needsProductionPlan};if(name==='production_plan'){plans++;return plan;}reviews++;evidence.push(messages);return {score:reviews===1?5:9,issues:reviews===1?[{severity:'major',problem:'Crowded',fix:'Increase space'}]:[],feedback:'Review '+reviews};}}),
  bindTools:()=>{let call=0;designs++;return {invoke:async()=>new AIMessage({content:'',tool_calls:[call++===0?{id:'write',name:'write_ad',args:{source:source(designs)}}:{id:'finish',name:'finish_design',args:{}}]})};},
 } as unknown as BaseChatModel};
}
describe('embeddable ad session',()=>{
 it('exposes raw-import context on demand and preserves it in a portable session',async()=>{
  const fake=model();let sawContext=false;
  const underlying=fake.model.bindTools!.bind(fake.model);
  fake.model.bindTools=((tools:any[])=>{
   const designer=underlying(tools);
   return {invoke:async(messages:any[])=>{
    if(!sawContext){
     sawContext=true;expect(JSON.stringify(messages)).toContain('/context/product/Booking.tsx');
     expect(JSON.stringify(messages)).not.toContain('private source body marker');
     expect(JSON.parse(await tools.find(t=>t.name==='list_context_files').invoke({offset:0})).files[0].path).toBe('/context/product/Booking.tsx');
     expect(JSON.parse(await tools.find(t=>t.name==='search_context_files').invoke({query:'marker'}))).toHaveLength(1);
     expect(await tools.find(t=>t.name==='read_file').invoke({path:'/context/product/Booking.tsx'})).toContain('private source body marker');
    }
    return designer.invoke(messages);
   }};
  }) as any;
  const options={initialMode:'source' as const,projectId:'raw-context',context:{files:{'Booking.tsx':'// private source body marker'}},adapters:{model:fake.model,storage:new MemoryFileSystem(),render:async()=>({frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]})}};
  const session=await createAdSession(options);
  await expect(session.workspace.write('/context/product/Booking.tsx','overwrite')).rejects.toThrow('read-only');
  await expect(session.store.filesystem.remove('/context',{recursive:true})).rejects.toThrow('read-only');
  await session.send('Make a booking ad',{review:false});expect(sawContext).toBe(true);
  const restored=await importAdBundle(await session.downloadBundle(),{...options,context:undefined,projectId:'raw-restored',adapters:{...options.adapters,storage:new MemoryFileSystem()}});
  expect(await restored.workspace.read('/context/product/Booking.tsx')).toBe('// private source body marker');
 });

 it('requires every nested provider field while allowing null scene identities and asset IDs',()=>{
  const schema=z.toJSONSchema(adProductionPlanSchema) as any;
  const visit=(node:any)=>{if(!node||typeof node!=='object')return;if(node.properties){expect(node.required).toEqual(Object.keys(node.properties));expect(node.additionalProperties).toBe(false);}for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else visit(value);};
  visit(schema);
  expect(schema.properties.scenes.items.required).toContain('id');
  expect(schema.properties.scenes.items.required).toContain('componentId');
  expect(schema.properties.assets.items.required).toContain('assetId');
  expect(()=>adProductionPlanSchema.parse({...plan,assets:[{key:'scene',description:'Blue backdrop',action:'generate',assetId:null}]})).not.toThrow();
 });

 it('normalizes old saved plans without weakening provider output validation',()=>{
  const {id,componentId,...legacyScene}=plan.scenes[0];
  const legacy={...plan,scenes:[legacyScene]};
  expect(adProductionPlanSchema.safeParse(legacy).success).toBe(false);
  expect(storedProductionPlanSchema.parse(legacy).scenes[0]).toMatchObject({id:null,componentId:null});
 });

 it('forces planning and frame review, persists versions, and supports undo/redo without agent approval bypass',async()=>{
  const fake=model();let renders=0;
  const session=await createAdSession({initialMode:'source' as const,projectId:'test',adapters:{model:fake.model,storage:new MemoryFileSystem(),render:async()=>{renders++;return {frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]};}},review:{maxRounds:3}});
  const original=new TextDecoder().decode(await session.workspace.readFile('/Ad.tsx'));
  const events:string[]=[];session.subscribe(e=>events.push(e.type));
  const result=await session.send('Make a clear ad');
  expect(result.approved).toBe(true);expect(JSON.parse(await session.workspace.read('plan.json')).concept).toBe('A clear ad');expect(renders).toBe(2);expect(fake.stats().plans).toBe(1);expect(fake.stats().reviews).toBe(2);
  expect(JSON.stringify(fake.stats().evidence)).toContain('data:image/png;base64,cGl4ZWxz');
  expect(events).toContain('review');expect((await session.listRuns())[0].status).toBe('complete');
  expect(new TextDecoder().decode(await session.workspace.readFile('/Ad.tsx'))).toBe(source(2));
  await session.undo();expect(new TextDecoder().decode(await session.workspace.readFile('/Ad.tsx'))).toBe(original);
  await session.redo();expect(new TextDecoder().decode(await session.workspace.readFile('/Ad.tsx'))).toBe(source(2));
  const bundle=JSON.parse(await (await session.downloadBundle()).text());expect(bundle.files.some((f:{path:string})=>f.path.endsWith('/SKILL.md'))).toBe(true);
 });
 it('reviews the first prompt, uses targeted follow-ups without reviewer, and honors explicit review on',async()=>{
  const fake=model();const storage=new MemoryFileSystem();let renders=0;
  const options={initialMode:'source' as const,projectId:'followup',adapters:{model:fake.model,storage,render:async()=>{renders++;return {frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]};}}};
  let session=await createAdSession(options);
  await session.send('Create the ad');
  expect(fake.stats().reviews).toBe(2);
  session=await createAdSession(options);
  const result=await session.send('Make DEMAIS red after a second');
  expect(result.review).toBeUndefined();expect(result.approved).toBe(false);
  expect(fake.stats().reviews).toBe(2);expect(fake.stats().plans).toBe(1);expect(renders).toBe(3);
  expect((await session.workspace.list('/runs',{recursive:true})).some(file=>file.path.endsWith('/edit-plan.json'))).toBe(true);
  await session.send('Review the edit',{review:true});
  expect(fake.stats().reviews).toBe(3);
 });
 it('escalates structural follow-ups to a full production plan',async()=>{
  const fake=model(true);
  const session=await createAdSession({initialMode:'source' as const,projectId:'redesign',adapters:{model:fake.model,storage:new MemoryFileSystem(),render:async()=>({frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]})}});
  await session.send('Create',{review:false});
  await session.send('Completely redesign all scenes',{review:false});
  expect(fake.stats().plans).toBe(2);expect(fake.stats().reviews).toBe(0);
 });
 it('allows review off on the first prompt but still preserves source on failed render checks',async()=>{
  const fake=model();let fail=false;
  const session=await createAdSession({initialMode:'source' as const,projectId:'unchecked',adapters:{model:fake.model,storage:new MemoryFileSystem(),render:async()=>{if(fail)throw new Error('Broken render');return {frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]};}},review:{maxRounds:2}});
  await session.send('Create',{review:false});expect(fake.stats().reviews).toBe(0);
  const before=await session.workspace.read('Ad.tsx');fail=true;
  await expect(session.send('Edit',{review:false})).rejects.toThrow('No successfully rendered');
  expect(await session.workspace.read('Ad.tsx')).toBe(before);
 });
 it('commits a voiceover-only request without rewriting source or generating speech',async()=>{
  const fake=model();let turn=0;
  fake.model.bindTools=(()=>({invoke:async()=>new AIMessage({content:'',tool_calls:[turn++===0?{id:'voice',name:'request_voiceover',args:{title:'Narration',script:'More orders, less stress.',language:'en',startSeconds:0,durationSeconds:8}}:{id:'done',name:'finish_design',args:{}}]})})) as never;
  const session=await createAdSession({initialMode:'source' as const,projectId:'voice-only',adapters:{model:fake.model,storage:new MemoryFileSystem(),render:async()=>({frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]})}});
  const before=await session.workspace.read('Ad.tsx');
  const result=await session.send('Write a voiceover for the ad',{review:false});
  expect(await session.workspace.read('Ad.tsx')).toBe(before);
  const project=await session.store.load();
  const clips=project.tracks.flatMap(track=>track.clips).filter(clip=>clip.kind==='voiceover');
  expect(clips).toHaveLength(1);expect(clips[0]).toMatchObject({script:'More orders, less stress.',startSeconds:0,durationSeconds:8});
  expect(project.assets.filter(asset=>asset.kind==='audio')).toHaveLength(0);
  expect(result.message).toContain('Click its ! clip');
 });
 it('preserves working source when all renders fail and records failed proposals',async()=>{
  const fake=model();const session=await createAdSession({initialMode:'source' as const,projectId:'bad',adapters:{model:fake.model,storage:new MemoryFileSystem(),render:async()=>{throw new Error('Syntax error');}},review:{maxRounds:2}});
  const before=await session.workspace.readFile('/Ad.tsx');await expect(session.send('Change it')).rejects.toThrow('No successfully rendered');
  expect(await session.workspace.readFile('/Ad.tsx')).toEqual(before);expect(session.busy).toBe(false);
  expect((await session.workspace.list('/runs',{recursive:true})).filter(f=>f.path.endsWith('/Ad.tsx'))).toHaveLength(2);
 });
 it('pins skill contents per run and requires a new version for changed instructions',async()=>{
  const fs=new MemoryFileSystem();const registry=await createSkillRegistry(fs,[{id:'brand',version:'1',roles:['designer'],instructions:'Use green'}]);
  await expect(registry.replace('brand',{id:'brand',version:'1',roles:['designer'],instructions:'Use red'})).rejects.toThrow('new skill version');
  const pinned=registry.list();await registry.replace('brand',{id:'brand',version:'2',roles:['designer'],instructions:'Use red'});
  expect(pinned[0].instructions).toBe('Use green');expect(registry.list()[0].version).toBe('2');
 });
 it('round-trips portable projects into a fresh conversation and rejects overwrites',async()=>{
  const fake=model();const storage=new MemoryFileSystem();
  const session=await createAdSession({initialMode:'source' as const,projectId:'original',adapters:{model:fake.model,storage}});
  await session.workspace.write('Ad.tsx',source(7));
  const bundle=await session.downloadBundle();
  const imported=await importAdBundle(bundle,{initialMode:'source' as const,projectId:'copy',adapters:{model:fake.model,storage}});
  expect(await imported.workspace.read('Ad.tsx')).toBe(source(7));
  expect(imported.skills.list()).toEqual(session.skills.list());
  await expect(importAdBundle(bundle,{initialMode:'source' as const,projectId:'copy',adapters:{model:fake.model,storage}})).rejects.toThrow();
 });
 it('does not overwrite an older skill version when supporting files change',async()=>{
  const skill={id:'test',version:'1',roles:['designer'] as const,instructions:'Example',files:{'example.tsx':'one'}};
  const registry=await createSkillRegistry(new MemoryFileSystem(),[{...skill,roles:['designer']}]);
  await registry.replace('test',{...skill,roles:['designer'],version:'2'});
  await expect(registry.replace('test',{...skill,roles:['designer'],files:{'example.tsx':'two'}})).rejects.toThrow('new skill version');
 });

});
