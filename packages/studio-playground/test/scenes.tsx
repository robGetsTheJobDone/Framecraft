import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {AdStudio,createAdSession,createMemoryComponentLibrary,mountAd,importAdZip} from '@deepbench/studio';
import '@deepbench/studio/styles.css';
const componentLibrary=createMemoryComponentLibrary({workspaceId:'test-brand'});
const session=await createAdSession({projectId:'scene-browser',adapters:{model:{withStructuredOutput:()=>({invoke:async()=>({segments:[]})})} as any,storage:new MemoryFileSystem(),componentLibrary},libraryWorkspaceId:'test-brand',formats:[{id:'test',width:120,height:90}],durationSeconds:8,fps:10});
const common=`import React from 'react'; import {AbsoluteFill,useCurrentFrame,useVideoConfig} from 'remotion'; export default function Card({color}) { const frame=useCurrentFrame(); const {durationInFrames}=useVideoConfig(); return <AbsoluteFill style={{background:color}}><div style={{position:'absolute',left:frame*2,top:0,width:2,height:10,background:'#00ffff'}}/><div style={{position:'absolute',left:0,top:durationInFrames,width:10,height:2,background:'#ffffff'}}/></AbsoluteFill>; }`;
const source=`import React from 'react'; import Card from '../components/Card'; export default function Scene(props){return <Card {...props}/>;}`;
await session.addAssets([{metadata:{id:'hero',kind:'image',mimeType:'image/png'},data:Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0))}]);
const state=await session.sceneState();
await session.editScenes({baseRevision:state.revision,operations:[
 {type:'writeModule',path:'/components/Card.tsx',source:common},
 {type:'addComponent',component:{id:'card',entry:'/scenes/Example.tsx',authoredDurationInFrames:30,inputs:{color:{type:'color',required:true},hero:{type:'asset',required:true}},defaults:{color:'#ff0000',hero:'hero'}},source},
 {type:'addScene',scene:{id:'first',name:'First scene',componentId:'card',startFrame:20,durationInFrames:20,sourceStartFrame:5,layer:0,props:{color:'#ff0000'}}},
 {type:'addScene',scene:{id:'second',name:'Second scene',componentId:'card',startFrame:50,durationInFrames:20,sourceStartFrame:0,layer:0,props:{color:'#0000ff'}}},
]});
async function capture(frame:number){
 const input=(await session.renderInputs())[0];const container=document.createElement('div');document.body.append(container);
 const mounted=await mountAd(container,input,{mode:'export'});
 try{await mounted.result;const data=await mounted.captureFrame(frame);const img=new Image();img.src=data;await img.decode();const canvas=document.createElement('canvas');canvas.width=120;canvas.height=90;const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);const pixel=(x:number,y:number)=>Array.from(ctx.getImageData(x,y,1,1).data);return {background:pixel(60,60),localClock:pixel(10,5),authoredDuration:pixel(5,30)};}finally{mounted.dispose();container.remove();}
}
(window as any).sceneTest={session,capture,componentLibrary,importAdZip,MemoryFileSystem};
createRoot(document.getElementById('root')!).render(<AdStudio session={session}/>);
