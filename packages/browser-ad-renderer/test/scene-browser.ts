import {mountAd, renderAd} from '../src/index';
import type {AdRenderInput} from '../src/index';
const input: AdRenderInput={source:'',modules:{
 '/scene.tsx':`import React from 'react'; import {useCurrentFrame,useVideoConfig,AbsoluteFill} from 'remotion'; import {good} from './helper'; export default function Scene({expectedFrame}){const frame=useCurrentFrame(); const {durationInFrames}=useVideoConfig(); return <AbsoluteFill style={{background:frame===expectedFrame && durationInFrames===120?good:'#ff0000'}}/>}`,
 '/helper.ts':`export const good='#00ff00';`
},composition:{version:1,components:[{id:'test',entry:'/scene.tsx',authoredDurationInFrames:120,inputs:{expectedFrame:{type:'number'}}}],scenes:[{id:'first',componentId:'test',startFrame:3,durationInFrames:2,sourceStartFrame:20,layer:0,props:{expectedFrame:20}}]},assets:{},format:{id:'test',width:64,height:64},durationSeconds:1,fps:30};
async function pixel(input:AdRenderInput,frame:number) {
 const mounted=await mountAd(document.body,input,{mode:'export',wasmURL:'/esbuild.wasm'});
 try {await mounted.result;const url=await mounted.captureFrame(frame); const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return [...ctx.getImageData(32,32,1,1).data];} finally {mounted.dispose();}
}
(window as any).runScenes=async()=>{
 const mutable=structuredClone(input);const pending=pixel(mutable,3);mutable.composition!.scenes[0].startFrame=12;mutable.modules!['/helper.ts']=`export const good='#ff0000';`;const snapshot=await pending;
 const trim=await pixel(input,3);
 const moved=structuredClone(input);moved.composition!.scenes[0].startFrame=10;
 const move=await pixel(moved,10);
 moved.modules!['/helper.ts']=`export const good='#0000ff';`;
 const dependency=await pixel(moved,10);
 const second=structuredClone(input); second.composition!.scenes[0].props.expectedFrame=21;
 const localSeek=await pixel(second,4);
 const nestedInput=structuredClone(input);
 nestedInput.modules!['/scene.tsx']=`import React from 'react';import {Sequence,AbsoluteFill,useCurrentFrame,useVideoConfig} from 'remotion';function Nested(){return <AbsoluteFill style={{background:useCurrentFrame()===1&&useVideoConfig().durationInFrames===5?'#00ff00':'#ff0000'}}/>}export default function Scene(){return <Sequence from={19} durationInFrames={5}><Nested/></Sequence>}`;
 const nested=await pixel(nestedInput,3);
 const aliasInput=structuredClone(input);aliasInput.assets.actual='data:image/png;base64,';aliasInput.composition!.components[0].assetBindings={logo:'actual'};
 aliasInput.modules!['/scene.tsx']=`import React from 'react';import {AbsoluteFill} from 'remotion';export default function Scene({assets}){return <AbsoluteFill style={{background:assets.logo===assets.actual?'#00ff00':'#ff0000'}}/>}`;
 const alias=await pixel(aliasInput,3);
 const legacyInput=structuredClone(input);
 legacyInput.composition!.scenes[0].startFrame=0;legacyInput.composition!.scenes[0].sourceStartFrame=0;legacyInput.composition!.scenes[0].durationInFrames=30;legacyInput.composition!.components[0].authoredDurationInFrames=30;
 legacyInput.modules!['/scene.tsx']=`export default function Ad(){return <AbsoluteFill style={{background:useCurrentFrame()===3 && useVideoConfig().durationInFrames===30?'#00ff00':'#ff0000'}}/>}`;
 const legacyGlobals=await pixel(legacyInput,3);
 const memoInput=structuredClone(input);
 memoInput.modules!['/scene.tsx']=`import React from 'react';import {AbsoluteFill} from 'remotion';export default React.memo(React.forwardRef(function Scene(props,ref){return <AbsoluteFill style={{background:'#00ff00'}}/>}));`;
 const memo=await pixel(memoInput,3);
 const review=await renderAd(input,{mode:'review',wasmURL:'/esbuild.wasm'});
 const exported=await renderAd(input,{mode:'export',container:'webm',wasmURL:'/esbuild.wasm'});
 return {snapshot,trim,move,dependency,localSeek,nested,alias,legacyGlobals,memo,reviewTimes:review.frames?.map(f=>f.timeSeconds),bytes:exported.blob?.size};
};
