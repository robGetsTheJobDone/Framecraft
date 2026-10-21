import {describe,it,expect} from 'vitest';
import {AIMessage, ToolMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {createAdSession, importAdZip, restoreAdSession, type AdSessionOptions} from '../src/ad-session.js';
import {CheckpointConflictError, UncertainToolCallError, type CheckpointAdapter} from '../src/checkpoints.js';
const source='export default function Ad(){return <div>Recovered scene</div>}';
const plan={concept:'Simple',scenes:[{id:null,componentId:null,start:0,end:8,copy:'Hi',visual:'Blue',motion:'Title',assetKeys:[]}],assets:[],nextChanges:['Layout']};
function remoteStore(){
 let current:{snapshot:Blob;version:string}|null=null;let revision=0;
 const adapter:CheckpointAdapter={read:async()=>current,save:async(_id,snapshot,{expectedVersion})=>{if((current?.version??null)!==expectedVersion)throw new CheckpointConflictError();current={snapshot,version:String(++revision)};return {version:current.version};}};
 return {adapter,current:()=>current};
}
function fixture(checkpoints?:CheckpointAdapter){
 let plans=0,deliveries=0,interrupted=true,uncertain=false,designerCalls=0;
 const model={withStructuredOutput:()=>({invoke:async()=>{plans++;return plan;}}),bindTools:()=>({invoke:async(messages:any[])=>{
   designerCalls++;
   const results=messages.filter(message=>message instanceof ToolMessage);
   if(!results.length)return new AIMessage({content:'',tool_calls:[{id:'delivery',name:'deliver',args:{}}]});
   if(interrupted)throw new Error('Connection dropped');
   if(!results.some(message=>message.tool_call_id==='write'))return new AIMessage({content:'',tool_calls:[{id:'write',name:'write_ad',args:{source}}]});
   return new AIMessage({content:'',tool_calls:[{id:'done',name:'finish_design',args:{}}]});
 }})} as unknown as BaseChatModel;
 const options:AdSessionOptions={projectId:'recover',initialMode:'source',adapters:{model,checkpoints,storage:new MemoryFileSystem(),render:async()=>({frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]})},tools:({session})=>[tool(async()=>{deliveries++;if(uncertain)throw new Error('Provider connection lost after accepting request');await session.filesystem.writeFile('/delivery.txt','Paid result',{createParents:true});return 'Paid result';},{name:'deliver',description:'External operation',schema:z.object({})})]};
 return {options,stats:()=>({plans,deliveries,designerCalls}),continue:()=>{interrupted=false;},makeUncertain:()=>{uncertain=true;}};
}
describe('durable run checkpoints',()=>{
 it('resumes an interrupted run imported from ZIP without repeating completed external tools',async()=>{
  const fake=fixture();const first=await createAdSession(fake.options);
  await expect(first.send('Make it',{review:false})).rejects.toThrow('Connection dropped');
  const id=(await first.listRuns())[0].runId;const archive=await first.downloadZip();
  fake.continue();
  const restored=await importAdZip(archive,{...fake.options,projectId:'zip-copy',adapters:{...fake.options.adapters,storage:new MemoryFileSystem()}});
  expect((await restored.resume()).runId).toBe(id);expect(fake.stats().deliveries).toBe(1);
 });

 it('restores full context and continues the same run after a completed external tool without replaying it',async()=>{
  const remote=remoteStore();const fake=fixture(remote.adapter);fake.options.context={files:{'Product.tsx':'export const feature = "Booking";'}};const first=await createAdSession(fake.options);
  await expect(first.send('Make it',{review:false})).rejects.toThrow('Connection dropped');
  const run=(await first.listRuns())[0];expect(run.status).toBe('error');
  const serialized=await remote.current()!.snapshot.text();expect(serialized).not.toContain('apiKey');
  fake.continue();
  const restored=await restoreAdSession({...fake.options,adapters:{...fake.options.adapters,storage:new MemoryFileSystem()}});
  const result=await restored.resume();
  expect(await restored.workspace.read('/context/product/Product.tsx')).toContain('Booking');
  await expect(restored.workspace.write('/context/product/Product.tsx','changed')).rejects.toThrow('read-only');
  expect(result.runId).toBe(run.runId);expect(fake.stats().deliveries).toBe(1);expect(fake.stats().plans).toBe(1);
  expect(await restored.workspace.read('Ad.tsx')).toBe(source);
  const savedRun=(await restored.listRuns())[0];
  const state=JSON.parse(await restored.workspace.read(savedRun.checkpoint));
  expect(state.candidate.some((file:{path:string})=>file.path==='/delivery.txt')).toBe(true);
  expect(state.messages.some((message:any)=>message.type==='tool'&&message.data.content==='Paid result')).toBe(true);
  expect(JSON.parse(await restored.workspace.read('chat.json')).filter((message:any)=>message.role==='user')).toHaveLength(1);
 });
 it('blocks automatic replay of a tool with an uncertain external outcome',async()=>{
  const remote=remoteStore();const fake=fixture(remote.adapter);fake.makeUncertain();
  const first=await createAdSession(fake.options);
  await expect(first.send('Make it',{review:false})).rejects.toThrow('Provider connection lost');
  const restored=await restoreAdSession({...fake.options,adapters:{...fake.options.adapters,storage:new MemoryFileSystem()}});
  await expect(restored.resume()).rejects.toBeInstanceOf(UncertainToolCallError);
  expect(fake.stats().deliveries).toBe(1);
 });
 it('rejects stale saves, supports explicit same-session restore, and preserves remote data',async()=>{
  const remote=remoteStore();const fake=fixture(remote.adapter);
  const a=await createAdSession(fake.options);await a.save();
  const b=await restoreAdSession({...fake.options,adapters:{...fake.options.adapters,storage:new MemoryFileSystem()}});
  await a.workspace.write('note.txt','First tab');await a.save();
  await b.workspace.write('note.txt','Stale tab');await expect(b.save()).rejects.toBeInstanceOf(CheckpointConflictError);
  const refreshed=await b.restore();expect(await refreshed.workspace.read('note.txt')).toBe('First tab');
  await refreshed.save();
 });
 it('does not execute tools when writing their pending checkpoint fails',async()=>{
  const remote=remoteStore();let writes=0;
  const adapter:CheckpointAdapter={read:remote.adapter.read,save:async(...args)=>{writes++;if(writes===4)throw new Error('Storage offline');return remote.adapter.save(...args);}};
  const fake=fixture(adapter);const session=await createAdSession(fake.options);
  await expect(session.send('Make it',{review:false})).rejects.toThrow('Storage offline');
  expect(fake.stats().deliveries).toBe(0);expect(writes).toBe(4);
 });
 it('resumes render validation without rerunning the designer after cancellation',async()=>{
  const fake=fixture();fake.continue();const abort=new AbortController();let renders=0;
  fake.options.adapters.render=async()=>{renders++;if(renders===1){abort.abort();abort.signal.throwIfAborted();}return {frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]};};
  const first=await createAdSession(fake.options);
  await expect(first.send('Make it',{review:false,signal:abort.signal})).rejects.toThrow();
  const before=fake.stats();
  const restored=await createAdSession(fake.options);await restored.resume();
  expect(fake.stats()).toEqual(before);expect(renders).toBe(2);expect(await restored.workspace.read('Ad.tsx')).toBe(source);
 });
 it('continues the remaining calls in a partially completed tool batch',async()=>{
  const remote=remoteStore();const abort=new AbortController();let deliveries=0;
  const adapter:CheckpointAdapter={read:remote.adapter.read,save:async(...args)=>{
    const result=await remote.adapter.save(...args);
    const snapshot=JSON.parse(await args[1].text());
    const file=snapshot.files.find((file:{path:string})=>file.path.includes('/checkpoints/'));
    if(file){const state=JSON.parse(atob(file.data));if(state.toolIndex===1&&!state.pending)abort.abort();}
    return result;
  }};
  const fake=fixture(adapter);fake.continue();
  fake.options.adapters.model.bindTools=(()=>({invoke:async(messages:any[])=>{
    if(!messages.some(message=>message instanceof ToolMessage))return new AIMessage({content:'',tool_calls:[{id:'external',name:'deliver',args:{}},{id:'write',name:'write_ad',args:{source}}]});
    return new AIMessage({content:'',tool_calls:[{id:'done',name:'finish_design',args:{}}]});
  }})) as never;
  fake.options.tools=()=>[tool(async()=>{deliveries++;return 'Persist this result';},{name:'deliver',description:'External operation',schema:z.object({})})];
  const first=await createAdSession(fake.options);
  await expect(first.send('Make it',{review:false,signal:abort.signal})).rejects.toThrow();
  const restored=await createAdSession(fake.options);await restored.resume();
  expect(deliveries).toBe(1);expect(await restored.workspace.read('Ad.tsx')).toBe(source);
 });
 it('replays a pending local voiceover tool from its pre-effect workspace without duplicating clips',async()=>{
  const fake=fixture();const abort=new AbortController();let interrupt=true;
  fake.options.adapters.model.bindTools=(()=>({invoke:async(messages:any[])=>new AIMessage({content:'',tool_calls:messages.some(message=>message instanceof ToolMessage)?[{id:'done',name:'finish_design',args:{}}]:[{id:'voice',name:'request_voiceover',args:{title:'Voice',script:'One line.',language:'en',startSeconds:0,durationSeconds:8}}]})})) as never;
  fake.options.tools=({session})=>{
    const request=session.requestVoiceover;
    session.requestVoiceover=async input=>{const value=await request(input);if(interrupt){interrupt=false;abort.abort();}return value;};
    return [];
  };
  const first=await createAdSession(fake.options);await expect(first.send('Add narration',{review:false,signal:abort.signal})).rejects.toThrow();
  const record=(await first.listRuns())[0];const state=JSON.parse(await first.workspace.read(record.checkpoint));
  const candidateProject=JSON.parse(atob(state.candidate.find((file:{path:string})=>file.path==='/project.json').data));
  expect(candidateProject.tracks.flatMap((track:any)=>track.clips).filter((clip:any)=>clip.kind==='voiceover')).toHaveLength(0);
  const restored=await createAdSession(fake.options);await restored.resume();
  expect((await restored.store.load()).tracks.flatMap(track=>track.clips).filter(clip=>clip.kind==='voiceover')).toHaveLength(1);
 });
 it('rejects malformed restores before changing local files',async()=>{
  const fake=fixture({read:async()=>({version:'1',snapshot:new Blob([JSON.stringify({schemaVersion:1,projectId:'recover',files:[{path:'/../bad',data:''}]})])}),save:async()=>({version:'2'})});
  const session=await createAdSession(fake.options);await session.workspace.write('keep.txt','Still here');
  await expect(session.restore()).rejects.toThrow();expect(await session.workspace.read('keep.txt')).toBe('Still here');
 });
});
