import {describe,it,expect} from 'vitest';
import {AIMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {createAdSession,importAdZip,type AdSessionOptions} from '../src/ad-session.js';
import type {StudioSession} from '../src/index.js';

const vector=(round:number)=>`import React from 'react'; export default function Cartoon(){return <svg><text>Vector cartoon ${round}</text></svg>}`;
const planned={concept:'A cartoon drawn with code',scenes:[{id:'cartoon',componentId:'cartoon',start:0,end:8,copy:'Cartoon',visual:'Vector illustration',motion:'Continuous animation',assetKeys:['cartoon-art']}],assets:[{key:'cartoon-art',description:'Planned artwork',action:'generate' as const,assetId:null}],nextChanges:['Draw the cartoon']};
const invalid={...planned,assets:[{key:'cartoon-art',description:'Cartoon already drawn',action:'reuse' as const,assetId:'invented-cartoon-image'}]};
function fixture(config:{corruptReviewPlan?:boolean;reviewFailure?:boolean;invalidFirst?:boolean;brokenRender?:boolean}={}){
 let plannerCalls=0,designerCalls=0,reviewerCalls=0,renderCalls=0;let candidate:StudioSession;
 const reviewerContexts:any[]=[];const plannerContexts:any[]=[];
 const model={
  withStructuredOutput:(_schema:unknown,{name}:{name:string})=>({invoke:async(messages:any[])=>{
   if(name==='production_plan'){plannerCalls++;plannerContexts.push(JSON.parse(messages[1].content));if(config.invalidFirst&&plannerCalls===1)return invalid;return plannerCalls===1||config.invalidFirst?planned:invalid;}
   if(name==='edit_plan')return{changes:['Fix cartoon'],preserve:['Artwork'],needsProductionPlan:false};
   reviewerCalls++;const context=JSON.parse(messages[1].content.find((block:any)=>block.type==='text').text);reviewerContexts.push(context);
   if(config.reviewFailure)throw new Error('Reviewer unavailable');
   if(config.corruptReviewPlan&&reviewerCalls===1)await candidate.filesystem.writeFile('/plan.json',JSON.stringify(invalid));
   return{score:reviewerCalls===1?6.8:9,issues:reviewerCalls===1?[{severity:'major',problem:'Headline too small',fix:'Enlarge the headline'}]:[],feedback:'Review actual vector artwork'};
  }}),
  bindTools:(tools:any[])=>{const round=++designerCalls;return{invoke:async()=>{
   const state=JSON.parse(await tools.find(t=>t.name==='inspect_project').invoke({}));
   const operations=state.project.composition.components.length?[{type:'writeModule',path:'/scenes/Cartoon.tsx',source:vector(round)}]:[
    {type:'addComponent',component:{id:'cartoon',entry:'/scenes/Cartoon.tsx',authoredDurationInFrames:240},source:vector(round)},
    {type:'addScene',scene:{id:'cartoon',name:'Continuous cartoon',componentId:'cartoon',startFrame:0,durationInFrames:240,sourceStartFrame:0,layer:0,props:{}}},
   ];
   return new AIMessage({content:'',tool_calls:[{id:'edit',name:'edit_scenes',args:{baseRevision:state.revision,operations}},...(round===1?[{id:'music',name:'attach_test_music',args:{}}]:[]),{id:'finish',name:'finish_design',args:{}}]});
  }};},
 } as unknown as BaseChatModel;
 const options:AdSessionOptions={projectId:'cartoon-review',adapters:{model,storage:new MemoryFileSystem(),renderSupportsScenes:true,render:async()=>{renderCalls++;if(config.brokenRender)throw new Error('Compilation failed');return{frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]};}},review:{maxRounds:config.reviewFailure||config.brokenRender?1:2},tools:({session})=>{
  candidate=session;return[tool(async()=>{await session.importAsset({id:'soundtrack',kind:'audio',name:'Cartoon music',mimeType:'audio/wav'},new Uint8Array([87,65,86]));await session.store.update(project=>{project.tracks.push({id:'cartoon-music',name:'Cartoon soundtrack',kind:'audio',clips:[{id:'soundtrack',kind:'audio',assetId:'soundtrack',startSeconds:0,durationSeconds:8,sourceStartSeconds:0,muted:true}]});});return 'Attached soundtrack';},{name:'attach_test_music',description:'Attach the deterministic test soundtrack',schema:z.object({})})];
 }};
 return{options,reviewerContexts,plannerContexts,counts:()=>({plannerCalls,designerCalls,reviewerCalls,renderCalls})};
}

describe('review refinement and saved draft recovery',()=>{
 it('reviews actual scene modules and reuses the plan for vector corrections instead of inventing reused images',async()=>{
  const f=fixture();const session=await createAdSession(f.options);const result=await session.send('Make a continuous cartoon');
  expect(result.approved).toBe(true);expect(f.counts()).toMatchObject({plannerCalls:1,designerCalls:2,reviewerCalls:2});
  expect(f.plannerContexts[0]).toMatchObject({renderMode:'scenes',composition:{scenes:[]},modules:{},assets:[],imageAssetIds:[]});
  for(const context of f.reviewerContexts){expect(context.source).toBeUndefined();expect(context.modules['/scenes/Cartoon.tsx']).toContain('Vector cartoon');expect(context.composition.scenes[0].id).toBe('cartoon');expect(context.assets).toContainEqual(expect.objectContaining({id:'soundtrack',kind:'audio',name:'Cartoon music'}));}
  expect((await session.store.load()).assets.some(asset=>asset.kind==='image')).toBe(false);
 });
 it('bounds invalid plan repair, retains the 6.8 draft, and restores its ZIP-imported modules/music without any model calls',async()=>{
  const f=fixture({corruptReviewPlan:true});const session=await createAdSession(f.options);const result=await session.send('Make a cartoon');
  expect(result.approved).toBe(false);expect(result.review?.score).toBe(6.8);expect(result.message).toContain('Planning stopped after two attempts');expect(f.counts()).toMatchObject({plannerCalls:2,designerCalls:1,reviewerCalls:1});
  expect((await session.listRuns())[0].status).toBe('needs_review');expect((await session.sceneState()).modules['/scenes/Cartoon.tsx']).toBe(vector(1));
  // Reproduce an interrupted browser run whose validated candidate is in its checkpoint, not yet applied.
  await session.undo();const record=(await session.listRuns())[0];await session.filesystem.writeFile(`/runs/${record.runId}/run.json`,JSON.stringify({...record,status:'error'}));
  const imported=await importAdZip(await session.downloadZip(),{...f.options,projectId:'imported-cartoon',adapters:{...f.options.adapters,storage:new MemoryFileSystem()}});
  const counts=f.counts();const restored=await imported.restoreRunDraft(record.runId);
  expect(restored).toMatchObject({approved:false,restored:true,review:{score:6.8}});expect(f.counts()).toMatchObject({plannerCalls:counts.plannerCalls,designerCalls:counts.designerCalls,reviewerCalls:counts.reviewerCalls});
  expect((await imported.sceneState()).modules['/scenes/Cartoon.tsx']).toBe(vector(1));expect(await imported.workspace.readFile('/assets/soundtrack')).toEqual(new Uint8Array([87,65,86]));expect((await imported.store.load()).tracks.some(track=>track.id==='cartoon-music')).toBe(true);
  expect((await imported.listRuns())[0].status).toBe('restored');await expect(imported.resume(record.runId)).rejects.toThrow('already complete');
  await imported.undo();expect((await imported.sceneState()).composition?.scenes).toEqual([]);await imported.redo();expect((await imported.sceneState()).modules['/scenes/Cartoon.tsx']).toBe(vector(1));
 });
 it('repairs an invalid initial reuse plan using explicit asset metadata and validation feedback',async()=>{
  const f=fixture({invalidFirst:true});const session=await createAdSession(f.options);await session.send('Draw a cartoon',{review:false});
  expect(f.counts().plannerCalls).toBe(2);expect(f.plannerContexts[1].planValidationError).toContain('code-drawn visuals are not image assets');expect(f.plannerContexts[1].imageAssetIds).toEqual([]);
 });
 it('preserves a render-valid draft after reviewer failure and refuses to overwrite newer project edits',async()=>{
  const f=fixture({reviewFailure:true});const session=await createAdSession(f.options);await expect(session.send('Draw a cartoon')).rejects.toThrow('No successfully rendered and reviewed');
  const [run]=await session.listRuns();const before=await session.sceneState();expect(before.composition?.scenes).toEqual([]);
  const project=await session.store.load();project.title='Newer manual title';await session.editProject({baseRevision:before.revision,project});
  await expect(session.restoreRunDraft(run.runId)).rejects.toThrow('overwrite newer edits');expect((await session.store.load()).title).toBe('Newer manual title');
  await session.undo();const counts=f.counts();const restored=await session.restoreRunDraft(run.runId);expect(restored.approved).toBe(false);expect(restored.review).toBeUndefined();expect(restored.message).toContain('Review was not completed');expect(f.counts()).toMatchObject({plannerCalls:counts.plannerCalls,designerCalls:counts.designerCalls,reviewerCalls:counts.reviewerCalls});
 });
 it('does not invent a restorable draft for a run that never rendered',async()=>{
  const f=fixture({brokenRender:true});const session=await createAdSession(f.options);await expect(session.send('Draw a cartoon',{review:false})).rejects.toThrow('No successfully rendered');const [run]=await session.listRuns();await expect(session.restoreRunDraft(run.runId)).rejects.toThrow('no successfully rendered draft');
 });
});
