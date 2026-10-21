import {it,expect} from 'vitest';
import {AIMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {createAdSession,importAdZip} from '../src/ad-session.js';
import {feedbackLimits,validateFeedback,type FeedbackAttachment} from '../src/feedback.js';

const image={name:'annotated.png',mimeType:'image/png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='};
const attachments:FeedbackAttachment[]=[image,{name:'notes.md',mimeType:'text/plain',data:'Make the headline larger and preserve the music.'}];
it('delivers actual feedback image and text to planner, designer and reviewer and preserves them in ZIP recovery',async()=>{
 const seen:Record<string,any[]>={};let turn=0;let plannerUnavailable=true;
 const model={withStructuredOutput:(_schema:unknown,{name}:{name:string})=>({invoke:async(messages:any[])=>{seen[name]=messages;if(name==='production_plan'&&plannerUnavailable)throw new Error('Planner unavailable');return name==='production_plan'?{concept:'Apply feedback',scenes:[{id:null,componentId:null,start:0,end:8,copy:'Headline',visual:'Large text',motion:'None',assetKeys:[]}],assets:[],nextChanges:['Apply human feedback']}:{score:9,issues:[],feedback:'Matches attached feedback'};}}),bindTools:()=>({invoke:async(messages:any[])=>{seen.designer=messages;return new AIMessage({content:'',tool_calls:[turn++===0?{id:'write',name:'write_ad',args:{source:'export default function Ad(){return <h1>Larger headline</h1>}'}}:{id:'finish',name:'finish_design',args:{}}]});}})} as unknown as BaseChatModel;
 const options={initialMode:'source' as const,projectId:'feedback',adapters:{model,storage:new MemoryFileSystem(),render:async()=>({frames:[{format:'story',timeSeconds:1,dataUrl:image.data}]})}};
 const session=await createAdSession(options);await expect(session.send('Use my feedback',{attachments,review:true})).rejects.toThrow('Production planning failed');
 plannerUnavailable=false;const interrupted=(await session.listRuns())[0];const result=await session.resume(interrupted.runId);
 for(const role of ['production_plan','designer','visual_review']){
  const blocks=seen[role][1].content;
  expect(blocks).toContainEqual({type:'image_url',image_url:{url:image.data}});
  expect(blocks.some((block:any)=>block.type==='text'&&block.text.includes(attachments[1].data))).toBe(true);
 }
 expect((await session.store.load()).assets).toHaveLength(0);
 const imported=await importAdZip(await session.downloadZip(),{...options,projectId:'feedback-import',adapters:{...options.adapters,storage:new MemoryFileSystem()}});
 const record=JSON.parse(await imported.workspace.read(`/runs/${result.runId}/run.json`));
 expect(JSON.parse(await imported.workspace.read(record.checkpoint)).attachments).toEqual(attachments);
});
it('rejects unsupported, oversized and malformed feedback before starting a run',()=>{
 expect(()=>validateFeedback(attachments)).not.toThrow();
 for(const files of [[{...image,mimeType:'application/pdf'}],[{...image,data:'data:image/png;base64,not base64!'}],Array(7).fill(image),[{name:'large.txt',mimeType:'text/plain',data:'a'.repeat(feedbackLimits.textBytes+1)}]])expect(()=>validateFeedback(files)).toThrow();
});
