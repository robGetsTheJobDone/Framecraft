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
 const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const paint=canvas.getContext('2d')!;paint.fillStyle='#00ff00';paint.fillRect(0,0,64,64);
 const photoInput=structuredClone(legacyInput);photoInput.assets.photo=canvas.toDataURL('image/jpeg');photoInput.composition!.components[0].assetBindings={hero:'photo'};
 photoInput.composition!.components[0].inputs={imageId:{type:'asset'}};photoInput.composition!.scenes[0].props={imageId:'photo'};
 photoInput.modules!['/scene.tsx']=`import {Img} from 'remotion';function Nested({assets,imageId}){return <Img src={assets[imageId]} style={{width:64,height:64}}/>}export default function Scene({assets,imageId}){return <Nested assets={assets} imageId={imageId}/>}`;
 const photo=await pixel(photoInput,3);
 photoInput.modules!['/scene.tsx']=`import {Img} from 'remotion';export default function Scene({assets}){return <Img src={assets.hero} style={{width:64,height:64}}/>}`;
 const photoAlias=await pixel(photoInput,3);
 const references:Record<string,number[]>={};
 for(const [name,source] of Object.entries({
  workspace:`import {Img} from 'remotion';export default function Scene(){return <Img src="assets/photo" style={{width:64,height:64}}/>}`,
  rawId:`export default function Scene(){return <Img src="photo" style={{width:64,height:64}}/>}`,
  native:`export default function Scene(){return <img src="/assets/photo" style={{width:64,height:64}}/>}`,
 })) {photoInput.modules!['/scene.tsx']=source;references[name]=await pixel(photoInput,3);}
 (window as any).openNativeImagePreview=async()=>{const preview=structuredClone(photoInput);preview.modules!['/scene.tsx']=`export default function Scene(){return <img src="assets/photo" style={{width:64,height:64}}/>}`;const mounted=await mountAd(document.body,preview,{mode:'preview',wasmURL:'/esbuild.wasm'});await mounted.result;};
 const imageErrors:Record<string,string>={};
 for(const [name,source] of Object.entries({
  missing:`import {Img} from 'remotion';export default function Scene(){return <Img/>}`,
  workspace:`import {Img} from 'remotion';export default function Scene(){return <Img src="assets/phoot"/>}`,
  rawId:`export default function Scene(){return <Img src="phoot"/>}`,
  native:`export default function Scene(){return <img src="/assets/phoot"/>}`,
  corrupted:`export default function Scene({assets}){return <img src={assets.broken}/>} `,
 })){
  photoInput.modules!['/scene.tsx']=source;photoInput.assets.broken='data:image/jpeg;base64,bm90LWEtanBlZw==';
  try{await renderAd(photoInput,{mode:'review',wasmURL:'/esbuild.wasm'});imageErrors[name]='NO ERROR';}catch(error){imageErrors[name]=String(error);}
 }
 photoInput.modules!['/scene.tsx']=`export default function Scene(){return <img src="assets/phoot"/>}`;
 try{await pixel(photoInput,3);imageErrors.export='NO ERROR';}catch(error){imageErrors.export=String(error);}
 const review=await renderAd(input,{mode:'review',wasmURL:'/esbuild.wasm'});
 const exported=await renderAd(input,{mode:'export',container:'webm',wasmURL:'/esbuild.wasm'});
 return {snapshot,trim,move,dependency,localSeek,nested,alias,legacyGlobals,memo,photo,photoAlias,references,imageErrors,reviewTimes:review.frames?.map(f=>f.timeSeconds),bytes:exported.blob?.size};
};
