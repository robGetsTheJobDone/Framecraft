import {describe,it,expect} from 'vitest';
import {AIMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {createConversationFileSystem} from '@deepbench/studio-project';
import {createAdSession,importAdZip} from '../src/ad-session.js';
import {createMemoryComponentLibrary} from '../src/component-library.js';
import {revisionFiles,commitSceneRevision,recoverSceneTransaction} from '../src/scene-revisions.js';
const component={id:'card',entry:'/scenes/AnyName.tsx',authoredDurationInFrames:180,inputs:{headline:{type:'text' as const,required:true}},defaults:{headline:'Hello'}};
const scene=(id:string,startFrame=0)=>({id,componentId:'card',startFrame,durationInFrames:60,sourceStartFrame:0,layer:0,props:{headline:id}});
const source='export default function Card({headline}) {return <div>{headline}</div>}';
function options(projectId='scenes',storage=new MemoryFileSystem()) {
  const inputs:any[]=[];
  const model={} as BaseChatModel;
  return {inputs,projectId,adapters:{storage,model,renderSupportsScenes:true as const,render:async(input:any)=>{inputs.push(structuredClone(input));if(Object.values(input.modules??{}).some(v=>String(v).includes('BROKEN')))throw new Error('Invalid component');return {frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]};}}};
}
async function seed(session:Awaited<ReturnType<typeof createAdSession>>) {
 const state=await session.sceneState();
 await session.editScenes({baseRevision:state.revision,operations:[{type:'addComponent',component,source},{type:'addScene',scene:scene('one')},{type:'addScene',scene:scene('two',90)}]});
}
describe('structured scene editing',()=>{
 it('starts fresh projects in scene mode and preserves existing source projects on reopen',async()=>{
   const config=options('fresh');const session=await createAdSession(config);
   expect((await session.store.load()).schemaVersion).toBe(2);expect((await session.sceneState()).composition).toEqual({version:1,components:[],scenes:[]});
   const reopened=await createAdSession({...config,initialMode:'source'});expect((await reopened.store.load()).schemaVersion).toBe(2);
   const legacyConfig=options('legacy');const legacy=await createAdSession({...legacyConfig,initialMode:'source'});await legacy.workspace.write('/Ad.tsx',source);
   const before=await legacy.sceneState();expect((await legacy.store.load()).schemaVersion).toBe(1);
   const legacyReopened=await createAdSession(legacyConfig);expect(await legacyReopened.sceneState()).toEqual(before);expect((await legacyReopened.store.load()).schemaVersion).toBe(1);expect(await legacyReopened.workspace.read('/Ad.tsx')).toBe(source);
 });
 it('moves and edits props without rewriting source; restores full graph through undo and ZIP',async()=>{
   const config=options();const session=await createAdSession(config);await seed(session);
   let state=await session.sceneState();const originalModules=state.modules;
   await session.editScenes({baseRevision:state.revision,operations:[{type:'updateScene',id:'one',patch:{startFrame:150,props:{headline:'Changed'}}}]});
   state=await session.sceneState();expect(state.modules).toEqual(originalModules);expect(state.composition?.scenes[1].props.headline).toBe('two');
   expect(config.inputs.at(-1).composition.scenes[0]).toMatchObject({startFrame:150,sourceStartFrame:0});
   await session.editScenes({baseRevision:state.revision,operations:[{type:'forkScene',id:'one',componentId:'fork',entry:'/scenes/AnotherName.tsx'},{type:'writeModule',path:'/scenes/AnotherName.tsx',source:source.replace('div','section')}]});
   expect((await session.sceneState()).modules['/scenes/AnyName.tsx']).toBe(source);
   await session.undo();expect((await session.sceneState()).modules['/scenes/AnotherName.tsx']).toBeUndefined();expect((await session.sceneState()).composition?.scenes[0].componentId).toBe('card');
   await session.redo();const final=await session.sceneState();
   const restored=await importAdZip(await session.downloadZip(),options('restored'));
   expect(await restored.sceneState()).toEqual(final);expect((await restored.renderInputs())[0].modules).toEqual(final.modules);
 });
 it('requires scene support opt-in from custom legacy render adapters',async()=>{
   const config=options();const {renderSupportsScenes,...adapters}=config.adapters;const session=await createAdSession({...config,adapters});
   await expect(seed(session)).rejects.toThrow('renderSupportsScenes');expect((await session.sceneState()).composition?.scenes).toEqual([]);
 });
 it('rejects stale edits and failed validation without changing the working revision',async()=>{
   const session=await createAdSession(options());await seed(session);const old=await session.sceneState();
   await session.editScenes({baseRevision:old.revision,operations:[{type:'updateScene',id:'one',patch:{startFrame:10}}]});
   await expect(session.editScenes({baseRevision:old.revision,operations:[{type:'removeScene',id:'one'}]})).rejects.toThrow('revision changed');
   const before=await session.sceneState();
   await expect(session.editScenes({baseRevision:before.revision,operations:[{type:'writeModule',path:component.entry,source:'BROKEN'}]})).rejects.toThrow('Invalid component');
   expect(await session.sceneState()).toEqual(before);
   await expect(session.editScenes({baseRevision:before.revision,operations:[{type:'updateScene',id:'one',patch:{props:{unknown:'bad'}}}]})).rejects.toThrow();
   expect(await session.sceneState()).toEqual(before);
 });
 it('converts legacy only explicitly and restores legacy behavior on undo',async()=>{
   const session=await createAdSession({...options(),initialMode:'source'});await session.workspace.write('/Ad.tsx',source);
   expect((await session.sceneState()).composition).toBeNull();await session.convertToScenes();
   const input=(await session.renderInputs())[0];expect(input.composition?.scenes).toHaveLength(1);expect(input.modules?.['/scenes/LegacyComposition.tsx']).toBe(source);
   await session.undo();expect((await session.renderInputs())[0].composition).toBeUndefined();expect(await session.workspace.read('/Ad.tsx')).toBe(source);
 });
 it('forks the transitive dependency graph so helper edits stay local',async()=>{
   const session=await createAdSession(options());await seed(session);let state=await session.sceneState();
   await session.editScenes({baseRevision:state.revision,operations:[{type:'writeModule',path:'/shared/Badge.tsx',source:'export default function Badge(){return <b>Original</b>}'},{type:'writeModule',path:component.entry,source:'import Badge from "../shared/Badge"; export default function Card(){return <Badge/>}'}]});
   state=await session.sceneState();await session.editScenes({baseRevision:state.revision,operations:[{type:'forkScene',id:'one',componentId:'isolated',entry:'/scenes/Fork.tsx'}]});
   state=await session.sceneState();expect(state.modules['/components/forks/isolated/shared/Badge.tsx']).toBe(state.modules['/shared/Badge.tsx']);
   await session.editScenes({baseRevision:state.revision,operations:[{type:'writeModule',path:'/components/forks/isolated/shared/Badge.tsx',source:'export default function Badge(){return <b>Changed</b>}'}]});
   expect((await session.sceneState()).modules['/shared/Badge.tsx']).toContain('Original');
 });
 it('undo preserves assets imported before the first scene edit',async()=>{
   const session=await createAdSession(options());await session.addAssets([{metadata:{id:'uploaded',kind:'image',mimeType:'image/png',name:'Existing'},data:new Uint8Array([1,2,3])}]);
   await seed(session);await session.undo();expect((await session.store.load()).assets.some(asset=>asset.id==='uploaded')).toBe(true);expect((await session.sceneState()).composition?.scenes).toEqual([]);
   expect(await session.workspace.readFile('/assets/uploaded')).toEqual(new Uint8Array([1,2,3]));
 });
 it('manual project edits share history and preserve the module graph',async()=>{
   const session=await createAdSession(options());await seed(session);const before=await session.sceneState();const project=await session.store.load();project.durationSeconds=10;
   await session.editProject({baseRevision:before.revision,project});expect((await session.store.load()).durationSeconds).toBe(10);
   await session.undo();expect((await session.store.load()).durationSeconds).toBe(8);expect((await session.sceneState()).modules).toEqual(before.modules);
 });
 it('agent scoped tools commit created modules and preserve manual scene changes',async()=>{
   const config=options();let turn=0;
   config.adapters.model={withStructuredOutput:(_schema:unknown,{name}:{name:string})=>({invoke:async()=>name==='edit_plan'?{changes:['Change headline'],preserve:['Timing'],needsProductionPlan:false}:{concept:'Cards',scenes:[{id:null,componentId:null,start:0,end:8,copy:'Cards',visual:'Cards',motion:'None',assetKeys:[]}],assets:[],nextChanges:['Change headline']}}),bindTools:(tools:any[])=>({invoke:async(messages:any[])=>{
     expect(JSON.stringify(messages)).toContain('Choose scene boundaries for independent editing');expect(JSON.stringify(messages)).toContain('continuous animation or coordinated transition can stay within one scene component');
     const inspect=JSON.parse(await tools.find(t=>t.name==='inspect_project').invoke({}));
     return new AIMessage({content:'',tool_calls:turn++===0?[{id:'edit',name:'edit_scenes',args:{baseRevision:inspect.revision,operations:[{type:'updateScene',id:'one',patch:{props:{headline:'Agent'}}}]}}]:[{id:'done',name:'finish_design',args:{}}]});
   }})} as unknown as BaseChatModel;
   const session=await createAdSession(config);await seed(session);const state=await session.sceneState();
   await session.editScenes({baseRevision:state.revision,operations:[{type:'updateScene',id:'one',patch:{startFrame:150}}]});
   await session.send('Change the first headline',{review:false});expect((await session.sceneState()).composition?.scenes[0]).toMatchObject({startFrame:150,props:{headline:'Agent'}});
   expect((await session.sceneState()).modules[component.entry]).toBe(source);
 });
});
describe('journaled revisions',()=>{
 it('rolls back a failed multi-file save and recovers an interrupted save',async()=>{
   const storage=new MemoryFileSystem();const session=await createAdSession(options('journal',storage));await seed(session);
   const fs=createConversationFileSystem(storage,'journal');const before=await revisionFiles(fs);const history=new TextDecoder().decode(await fs.readFile('/history.json'));
   const after=before.map(file=>file.path===component.entry?{...file,data:btoa('changed source')}:file);
   let failed=false;const original=fs.writeFile.bind(fs);fs.writeFile=async(path,data,opts)=>{if(path==='/project.json'&&!failed){failed=true;throw new Error('disk failure');}return original(path,data,opts);};
   await expect(commitSceneRevision(fs,before,after,history,history)).rejects.toThrow('disk failure');expect(await revisionFiles(fs)).toEqual(before);
   await fs.writeFile('/.scene-transaction.json',JSON.stringify({version:1,before,history}));await fs.writeFile(component.entry,'partial source');
   await recoverSceneTransaction(fs);expect(await revisionFiles(fs)).toEqual(before);
 });
});

describe('session library authorization and recovery',()=>{
 function publishingModel(onTools:(names:string[])=>void, publish:boolean){let turn=0;return {
   withStructuredOutput:()=>({invoke:async()=>({concept:'Card',scenes:[{id:null,componentId:null,start:0,end:8,copy:'Card',visual:'Card',motion:'None',assetKeys:[]}],assets:[],nextChanges:['Save card']})}),
   bindTools:(tools:any[])=>{onTools(tools.map(t=>t.name));return {invoke:async()=>{
     if(turn++>0)return new AIMessage({content:'',tool_calls:[{id:'done',name:'finish_design',args:{}}]});
     if(publish)return new AIMessage({content:'',tool_calls:[{id:'publish',name:'save_library_component',args:{localComponentId:'card',componentId:'brand-card',version:'1',name:'Brand card'}}]});
     const state=JSON.parse(await tools.find(t=>t.name==='inspect_project').invoke({}));return new AIMessage({content:'',tool_calls:[{id:'edit',name:'edit_scenes',args:{baseRevision:state.revision,operations:[{type:'updateScene',id:'one',patch:{props:{headline:'Safe'}}}]}}]});
   }};},
 } as unknown as BaseChatModel;}
 it('does not expose publication during ordinary agent edits and pins portable direct insertions',async()=>{
   const config=options();const adapter=createMemoryComponentLibrary({workspaceId:'brand'});let tools:string[]=[];
   config.adapters.model=publishingModel(names=>{tools=names;},false);
   const session=await createAdSession({...config,libraryWorkspaceId:'brand',adapters:{...config.adapters,componentLibrary:adapter}});await seed(session);
   await session.send('Change headline',{review:false});expect(tools).not.toContain('save_library_component');expect((await session.library!.search({})).total).toBe(0);
   await session.library!.save({localComponentId:'card',componentId:'brand-card',version:'1',name:'Brand card',authorized:true,idempotencyKey:'save-card'});
   const before=await session.sceneState();await session.library!.insert({componentId:'brand-card',version:'1',sceneId:'saved',durationInFrames:60});
   expect((await session.library!.readPins())[0].version).toBe('1');await session.undo();expect(await session.sceneState()).toEqual(before);expect(await session.library!.readPins()).toEqual([]);
   await session.redo();const restored=await importAdZip(await session.downloadZip(),options('no-library'));
   expect(restored.library).toBeUndefined();expect((await restored.renderInputs())[0].composition?.scenes.some(s=>s.id==='saved')).toBe(true);
 });
 it('replays an uncertain authorized publish with the same idempotency key',async()=>{
   const config=options('publish-recovery');const provider=createMemoryComponentLibrary({workspaceId:'brand'});let failed=false;const keys:string[]=[];
   const adapter={...provider,publish:async(...args:Parameters<typeof provider.publish>)=>{keys.push(args[0].idempotencyKey);const release=await provider.publish(...args);if(!failed){failed=true;throw new Error('Connection lost after publishing');}return release;}};
   config.adapters.model=publishingModel(()=>{},true);
   const session=await createAdSession({...config,libraryWorkspaceId:'brand',adapters:{...config.adapters,componentLibrary:adapter}});await seed(session);
   await expect(session.send('Save this card to the library',{review:false,libraryPublish:true})).rejects.toThrow('Connection lost');
   const [run]=await session.listRuns();
   const restored=await importAdZip(await session.downloadZip(),{...config,projectId:'imported-publish',libraryWorkspaceId:'brand',adapters:{...config.adapters,storage:new MemoryFileSystem(),componentLibrary:adapter}});
   await expect(restored.resume(run.runId)).rejects.toThrow('Reauthorize library publishing');expect(keys).toHaveLength(1);
   await expect(session.resume(run.runId,{libraryPublish:false})).rejects.toThrow('Reauthorize library publishing');
   await expect(session.resume(run.runId)).rejects.toThrow('Reauthorize library publishing');
   await session.resume(run.runId,{libraryPublish:true});
   expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);expect((await session.library!.search({})).total).toBe(1);
 });
});
