import {createAdSession,importAdZip,mountAd,renderAd,zipToSnapshot} from '../packages/studio/portable/index.js';
const status=document.querySelector('#status')!;
const log=(message:string)=>{status.textContent+='\n'+message;};
const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
async function pixel(input:any,frame:number){
 const mounted=await mountAd(document.querySelector('#preview')!,input,{mode:'export',wasmURL:'/esbuild.wasm'});
 try {await mounted.result;const url=await mounted.captureFrame(frame);const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return [...ctx.getImageData(32,32,1,1).data].join(',');}finally{mounted.dispose();}
}
async function run(){
 const options={projectId:crypto.randomUUID(),durationSeconds:1,fps:30,formats:[{id:'square',width:64,height:64}],wasmURL:'/esbuild.wasm',adapters:{model:{} as any}};
 const session=await createAdSession(options);
 await session.packages.install('d3-interpolate','3.0.1');log('PASS real CDN install and pinned transitive dependency');
 const state=await session.sceneState();
 await session.editScenes({baseRevision:state.revision,operations:[
  {type:'addComponent',component:{id:'demo',entry:'/Demo.tsx',authoredDurationInFrames:30},source:`import React from 'react';import {useCurrentFrame} from 'remotion';import {interpolateRgb} from 'd3-interpolate';export default function Demo(){const color=React.useMemo(()=>interpolateRgb('#00ff00','#0000ff'),[]);return <div style={{width:64,height:64,background:color(useCurrentFrame()/29)}}/>}`},
  {type:'addScene',scene:{id:'demo',componentId:'demo',startFrame:0,durationInFrames:30,sourceStartFrame:0,layer:0,props:{}}},
 ]});
 const input=(await session.renderInputs())[0];assert(await pixel(input,0)==='0,255,0,255','Initial frame mismatch');assert(await pixel(input,29)==='0,0,255,255','Final frame mismatch');log('PASS frame-driven package rendering and shared React hooks');
 const zip=await session.downloadZip();const snapshot=(await zipToSnapshot(zip)).snapshot;assert((await snapshot.text()).includes("packages.lock.json"),"Missing ZIP package lock");
 const restored=await importAdZip(zip,{...options,projectId:crypto.randomUUID(),packages:{fetch:async()=>{throw new Error('Unexpected CDN access after restore');}}});
 const restoredInput=(await restored.renderInputs())[0];assert(await pixel(restoredInput,29)==='0,0,255,255','Offline restore mismatch');log('PASS ZIP restore with package transport disabled');
 const exported=await renderAd(restoredInput,{mode:'export',container:'webm',wasmURL:'/esbuild.wasm'});assert(exported.blob!.size>100,'Empty export');log('PASS offline WebM export');
 // Verify a package using the automatic JSX runtime shares the renderer React instance.
 const url='https://esm.sh/hooks-demo@1.0.0?target=es2022&external=react,react/jsx-runtime,react/jsx-dev-runtime,remotion';
 const hookSession=await createAdSession({...options,projectId:crypto.randomUUID(),packages:{fetch:async(request:any)=>new Response(String(request).startsWith('https://registry.npmjs.org/')?JSON.stringify({name:'hooks-demo',version:'1.0.0'}):String(request)===url?`import {useState} from 'react';import {jsx} from 'react/jsx-runtime';export function Green(){const [color]=useState('#00ff00');return jsx('div',{style:{width:64,height:64,background:color}})}`:'',{status:200})}});
 await hookSession.packages.install('hooks-demo','1.0.0');
 const hookInput={...(await hookSession.renderInputs())[0],composition:undefined,modules:undefined,source:`import {Green} from 'hooks-demo';export default Green;`};
 assert(await pixel(hookInput,0)==='0,255,0,255','Duplicate React / JSX runtime failure');log('PASS package JSX runtime and hooks in legacy source mode');
 const mounted=await mountAd(document.querySelector('#preview')!,input,{wasmURL:'/esbuild.wasm'});await mounted.result;
 log('ALL PACKAGE CHECKS PASSED');
}
run().catch(error=>{log('FAIL '+(error.stack??error));});
