import React from 'react';
(window as any).hostReactVersion = React.version;
import {createRoot} from 'react-dom/client';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {AdStudio,createAdSession} from '@deepbench/studio';
import '@deepbench/studio/styles.css';
import {renderAd} from '@deepbench/studio';
import {encodeWav} from '@deepbench/studio-audio';
import {AIMessage, AIMessageChunk} from '@langchain/core/messages';
const source=`export default function Ad({width,height}) { const frame=useCurrentFrame(); return <div className="bg-blue-500" style={{width,height,position:'relative',color:'white',fontFamily:'Arial',overflow:'hidden'}}><h1 style={{fontSize:30,transform:'translateX('+frame+'px)'}}>Browser source</h1></div>; }`;
const plan={concept:'Browser test',scenes:[{start:0,end:3,copy:'Browser source',visual:'Blue',motion:'Moving text',assetKeys:[]}],assets:[],nextChanges:['Write the source']};
const calls: Array<{name:string; input:any}> = [];
(window as any).modelCalls = calls;
let designRuns = 0;
const model:any={withStructuredOutput:(_schema:any,{name}:any)=>({invoke:async(messages:any[])=>{
  calls.push({name,input:messages.map(message=>message.content)});
  if(name==='music_score'){
    const context=JSON.parse(messages[1].content);
    return {title:context.existing?'Revised browser music':'Browser music',bpm:120,durationSeconds:context.durationSeconds,tracks:[{name:'Melody',instrument:'bell',gain:.7,pan:0,patch:context.existing?{attack:.01,release:.15,cutoff:2500,detune:0,brightness:.2}:null,notes:[{pitch:69,beat:0,durationBeats:1,velocity:.8},{pitch:72,beat:2,durationBeats:1,velocity:.8}]}]};
  }
  if(name==='production_plan')return plan;
  if(name==='edit_plan')return {changes:['Change only the title color'],preserve:['Existing scenes, timing, assets, and copy'],needsProductionPlan:false};
  return {score:9,issues:[],feedback:'Ready'};
}}),bindTools:()=>{let step=0;const designRun=designRuns++;return {
  stream:async function*(){
    if(step++===0){
      if((window as any).musicAction){
        const action=(window as any).musicAction;
        yield new AIMessageChunk({content:'',tool_call_chunks:[{id:'music',name:action.id?'revise_music':'compose_music',args:JSON.stringify(action.id?{id:action.id,instructions:'Soften the bell tone'}:{brief:'A short bell melody'}),index:0,type:'tool_call_chunk'}]});
        return;
      }
      yield new AIMessageChunk({content:[{type:'reasoning',text:'PRIVATE_TEST_MARKER'},{type:'text',text:'Composing the blue title…'}]});
      if(designRun===0)await new Promise<void>(resolve=>{(window as any).continueDesign=resolve;});
      yield new AIMessageChunk({content:'',tool_call_chunks:[{id:'write',name:'write_ad',args:JSON.stringify({source:designRun===0?source:source.replace("color:'white'",designRun===1?"color:'red'":"color:'green'")}),index:0,type:'tool_call_chunk'}]});
    }else yield new AIMessageChunk({content:'',tool_call_chunks:[{id:'finish',name:'finish_design',args:'{}',index:0,type:'tool_call_chunk'}]});
  }
}}};
const session=await createAdSession({projectId:'embedded-test',adapters:{model,storage:new MemoryFileSystem()},formats:[{id:'story',width:320,height:180}],durationSeconds:3,fps:10,review:{maxRounds:2}});
if(new URLSearchParams(location.search).has('teleprompter'))await session.requestVoiceover({title:'Read these lines',script:'Hello there.\nWelcome to our studio.',language:'en',startSeconds:0,durationSeconds:3});
function FixtureStudio(){const [current,setCurrent]=React.useState(session);return <AdStudio key={current.projectId} session={current} onImportZip={async file=>{const restored=await current.importZip(file);(window as any).testSession=restored;setCurrent(restored);}}/>;}
createRoot(document.getElementById('root')!).render(<FixtureStudio/>);
(window as any).rendererCheck=async()=>{
 const input={source,assets:{},format:{id:'story',width:320,height:180},durationSeconds:1,fps:10};
 const review=await renderAd(input,{mode:'review'});
 const samples=Float32Array.from({length:48000},(_,i)=>Math.sin(i*440*2*Math.PI/48000)*.2);
 const wav=encodeWav({numberOfChannels:1,length:samples.length,sampleRate:48000,getChannelData:()=>samples});
 const audioMix=await new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(wav);});
 const video=await renderAd({...input,audioMix},{mode:'export',container:'mp4'});
 const context=new AudioContext();const audio=await context.decodeAudioData(await video.blob!.arrayBuffer());await context.close();
 const audible=audio.getChannelData(0).some(value=>Math.abs(value)>.05);

 return {audible,frames:review.frames?.length,different:review.frames?.[0].dataUrl!==review.frames?.[3].dataUrl,bytes:video.blob?.size,type:video.blob?.type};
};
(window as any).testSession=session;
