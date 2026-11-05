import {describe,it,expect} from 'vitest';
import {AIMessage,ToolMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {createAdSession,type AdSessionOptions} from '../src/ad-session.js';
import {adProductionPlanSchema,storedProductionPlanSchema,validateProductionPlan} from '../src/production-plan.js';

const source='export default function Dog(){return <div>The same giggling dog</div>}';
const component={id:'dog',entry:'/scenes/Dog.tsx',authoredDurationInFrames:240};
const scene={id:'dog-loop',componentId:'dog',startFrame:0,durationInFrames:240,sourceStartFrame:0,layer:0,props:{}};
const plan={durationSeconds:null,concept:'Giggling dog',scenes:[{id:'dog-loop',componentId:'dog',start:0,end:8,copy:'Giggle',visual:'Same dog',motion:'Giggling',assetKeys:[]}],assets:[],nextChanges:['Animate dog']};
const episode={...plan,durationSeconds:90,scenes:Array.from({length:10},(_,i)=>({...plan.scenes[0],id:i?`shot-${i}`:'dog-loop',start:i*9,end:(i+1)*9}))};
const frames={frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]};
const response=(id:string,name:string,args:Record<string,unknown>)=>new AIMessage({content:'',tool_calls:[{id,name,args}]});
function fixture(){
 let expand=false,broken=false,interrupt=false,plans=0;
 const rendered:number[]=[];
 const model={
  withStructuredOutput:(_schema:unknown,{name}:{name:string})=>({invoke:async()=>{
   if(name==='edit_plan')return {changes:['Expand to 90 seconds'],preserve:['Dog character'],needsProductionPlan:true};
   plans++;return expand?episode:plan;
  }}),
  bindTools:(tools:any[])=>({invoke:async(messages:any[])=>{
   const inspect=async()=>JSON.parse(await tools.find(t=>t.name==='inspect_project').invoke({}));
   const result=(id:string)=>messages.find(m=>m instanceof ToolMessage&&m.tool_call_id===id)?.content;
   if(!expand){
    if(result('seed'))return response('finish','finish_design',{});
    return response('seed','edit_scenes',{baseRevision:(await inspect()).revision,operations:[{type:'addComponent',component,source},{type:'addScene',scene}]});
   }
   if(!result('opening'))return response('opening','request_voiceover',{title:'Opening',script:'Hello!',language:'en',startSeconds:0,durationSeconds:8});
   if(!result('premature'))return response('premature','finish_design',{});
   expect(result('premature')).toContain('planned 90 seconds');
   if(!result('resize'))return response('resize','set_project_duration',{baseRevision:(await inspect()).revision,durationSeconds:90});
   expect(JSON.parse(result('resize'))).toMatchObject({durationSeconds:90,fps:30,durationInFrames:2700});
   if(interrupt)throw new Error('Connection interrupted after resize');
   if(!result('episode'))return response('episode','edit_scenes',{baseRevision:(await inspect()).revision,operations:[
    {type:'updateComponent',id:'dog',patch:{authoredDurationInFrames:270}},
    {type:'updateScene',id:'dog-loop',patch:{durationInFrames:270}},
    ...Array.from({length:9},(_,i)=>({type:'addScene',scene:{...scene,id:`shot-${i+1}`,startFrame:(i+1)*270,durationInFrames:270}})),
   ]});
   if(!result('dialogue'))return response('dialogue','request_voiceover',{title:'Episode',script:'We did it together!',language:'en',startSeconds:8,durationSeconds:82});
   return response('finish','finish_design',{});
  }}),
 } as unknown as BaseChatModel;
 const options:AdSessionOptions={projectId:'duration-test',adapters:{model,storage:new MemoryFileSystem(),renderSupportsScenes:true,render:async input=>{rendered.push(input.durationSeconds);if(broken)throw new Error('Broken episode render');return frames;}},review:{maxRounds:1}};
 return {options,rendered,plans:()=>plans,expand:()=>{expand=true;},breakRender:()=>{broken=true;},interrupt:()=>{interrupt=true;},resume:()=>{interrupt=false;}};
}

describe('agent project duration',()=>{
 it('accepts requested plan timing and normalizes old persisted plans',()=>{
  expect(()=>validateProductionPlan(episode,{},8,{})).not.toThrow();
  expect(()=>validateProductionPlan({...episode,durationSeconds:null},{},8,{})).toThrow('0–8s');
  const {durationSeconds,...legacy}=plan;
  expect(adProductionPlanSchema.safeParse(legacy).success).toBe(false);
  expect(storedProductionPlanSchema.parse(legacy).durationSeconds).toBeNull();
 });
 it('expands an existing eight-second dog into ten shots and dialogue over 90 seconds, with undo/redo',async()=>{
  const f=fixture();const session=await createAdSession(f.options);
  await session.send('Make a giggling dog',{review:false});const before=await session.sceneState();
  f.expand();await session.send('Expand the same dog into a 90-second episode with ten shots',{review:false});
  const project=await session.store.load();
  expect(project.durationSeconds).toBe(90);expect(project.fps).toBe(30);
  expect(project.composition?.scenes).toHaveLength(10);
  expect(project.composition?.scenes.at(-1)).toMatchObject({startFrame:2430,durationInFrames:270,componentId:'dog'});
  expect(project.tracks.flatMap(t=>t.clips)).toContainEqual(expect.objectContaining({kind:'voiceover',startSeconds:8,durationSeconds:82}));
  expect((await session.sceneState()).modules).toEqual(before.modules);
  expect(f.plans()).toBe(2);expect(f.rendered).toEqual([8,90]);
  await session.undo();expect((await session.store.load()).durationSeconds).toBe(8);expect(await session.sceneState()).toEqual(before);
  await session.redo();expect((await session.store.load()).durationSeconds).toBe(90);
 });
 it('keeps the original project when the expanded episode fails rendering',async()=>{
  const f=fixture();const session=await createAdSession(f.options);
  await session.send('Make a dog',{review:false});const before=await session.sceneState();
  f.expand();f.breakRender();await expect(session.send('Make a 90-second episode',{review:false})).rejects.toThrow('No successfully rendered');
  expect((await session.store.load()).durationSeconds).toBe(8);expect(await session.sceneState()).toEqual(before);
 });
 it('resumes a duration change from a checkpoint without losing the requested plan',async()=>{
  const f=fixture();const session=await createAdSession(f.options);
  await session.send('Make a dog',{review:false});f.expand();f.interrupt();
  await expect(session.send('Make a 90-second episode',{review:false})).rejects.toThrow('Connection interrupted');
  expect((await session.store.load()).durationSeconds).toBe(8);
  f.resume();await session.resume();
  expect((await session.store.load()).durationSeconds).toBe(90);expect(f.plans()).toBe(2);
 });
 it('rejects stale revisions and destructive shrinking without changing clips or scenes',async()=>{
  const model={withStructuredOutput:()=>({invoke:async()=>plan}),bindTools:(tools:any[])=>({invoke:async()=>{
   const invoke=(name:string,args:Record<string,unknown>)=>tools.find(t=>t.name===name).invoke(args);
   const before=JSON.parse(await invoke('inspect_project',{}));
   await expect(invoke('set_project_duration',{baseRevision:'stale',durationSeconds:90})).rejects.toThrow('revision changed');
   await expect(invoke('set_project_duration',{baseRevision:before.revision,durationSeconds:4})).rejects.toThrow('Shorten or remove');
   expect(JSON.parse(await invoke('inspect_project',{}))).toEqual(before);
   await invoke('set_project_duration',{baseRevision:before.revision,durationSeconds:16});
   const after=JSON.parse(await invoke('inspect_project',{}));
   expect(after.project).toEqual({...before.project,durationSeconds:16});
   return response('finish','finish_design',{});
  }})} as unknown as BaseChatModel;
  const session=await createAdSession({projectId:'shrink',adapters:{model,storage:new MemoryFileSystem(),renderSupportsScenes:true,render:async()=>frames}});
  const state=await session.sceneState();await session.editScenes({baseRevision:state.revision,operations:[{type:'addComponent',component,source},{type:'addScene',scene}]});
  await session.send('Extend to 16 seconds',{review:false});expect((await session.store.load()).durationSeconds).toBe(16);
 });
});
