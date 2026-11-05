import {createAdSession,importAdZip,mountAd,renderAd,zipToSnapshot} from '../packages/studio/portable/index.js';
const status=document.querySelector('#status')!;
const log=(message:string)=>{status.textContent+='\n'+message;};
const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
async function pixel(input:any,frame:number){
 const mounted=await mountAd(document.querySelector('#preview')!,input,{mode:'export',wasmURL:'/esbuild.wasm'});
 try {await mounted.result;const url=await mounted.captureFrame(frame);const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return [...ctx.getImageData(32,32,1,1).data].join(',');}finally{mounted.dispose();}
}
async function checkThree(options:any,version='0.180.0',discover=false){
 const session=await createAdSession({...options,projectId:crypto.randomUUID()});
 let selection:any;
 if(discover){
  const metadata=await session.packages.inspect('three',version);
  selection=metadata.candidates.find((candidate:any)=>candidate.source==='jsdelivr'&&candidate.entryPath===metadata.entryPoints.module);
  assert(selection,'No published module candidate discovered');
  const probe=await session.packages.probe('three',version,selection);
  assert(probe.ok,'Discovered entry failed sandbox probe: '+JSON.stringify(probe));
  assert((await session.packages.list()).installed.length===0,'Probe changed the project');
  log('PASS metadata discovery and non-mutating sandbox probe for Three.js '+version);
 }
 await session.packages.install('three',version,undefined,selection);
 assert((await session.packages.list()).installed[0].version===version,'Three.js installation missing');
 log('PASS real Three.js '+version+' install and sandbox import');
 const source=`import React from 'react';import {useCurrentFrame} from 'remotion';import * as THREE from 'three';
 export default function Cross({width,height,color='#e8a060',tilt=0.25,speed=1.8}){
  const canvas=React.useRef(null),world=React.useRef(null);const frame=useCurrentFrame();
  React.useLayoutEffect(()=>{
   const renderer=new THREE.WebGLRenderer({canvas:canvas.current,antialias:true,preserveDrawingBuffer:true});renderer.setSize(width,height);renderer.setClearColor('#101820');
   const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,width/height,0.1,100);camera.position.z=7;
   const group=new THREE.Group();scene.add(group);
   const material=new THREE.MeshStandardMaterial({color,roughness:0.35});
   const vertical=new THREE.BoxGeometry(0.6,3,0.6),horizontal=new THREE.BoxGeometry(2,0.6,0.6);
   group.add(new THREE.Mesh(vertical,material));const arm=new THREE.Mesh(horizontal,material);arm.position.y=0.5;group.add(arm);
   scene.add(new THREE.AmbientLight(0xffffff,1.5));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,4,5);scene.add(light);
   world.current={renderer,scene,camera,group};
   return()=>{world.current=null;vertical.dispose();horizontal.dispose();material.dispose();renderer.dispose();};
  },[width,height,color]);
  React.useLayoutEffect(()=>{const w=world.current;if(w){w.group.rotation.set(tilt,frame/30*speed,0);w.renderer.render(w.scene,w.camera);}},[frame,width,height,color,tilt,speed]);
  return <canvas ref={canvas} width={width} height={height}/>;
 }`;
 await session.editScenes({baseRevision:(await session.sceneState()).revision,operations:[
  {type:'addComponent',component:{id:'cross',entry:'/Cross.tsx',authoredDurationInFrames:30,inputs:{color:{type:'color'},tilt:{type:'number'},speed:{type:'number'}},defaults:{color:'#e8a060',tilt:0.25,speed:1.8}},source},
  {type:'addScene',scene:{id:'cross',componentId:'cross',startFrame:0,durationInFrames:30,sourceStartFrame:0,layer:0,props:{}}},
 ]});
 const input=(await session.renderInputs())[0];
 const captures:string[]=[];
 const mounted=await mountAd(document.querySelector('#preview')!,input,{mode:'export',wasmURL:'/esbuild.wasm'});
 try {
  await mounted.result;
  for(const frame of [0,15,29,0]){
   const dataUrl=await mounted.captureFrame(frame);captures.push(dataUrl);
   const image=new Image();image.src=dataUrl;await image.decode();const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
   const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,64,64).data;let bright=0;
   for(let i=0;i<pixels.length;i+=4)if(pixels[i]>80&&pixels[i+1]>50)bright++;
   assert(bright>100,'Three.js frame '+frame+' is blank or black');
  }
 }finally{mounted.dispose();}
 assert(captures[0]!==captures[1]&&captures[1]!==captures[2],'Cross is not rotating');
 assert(captures[0]===captures[3],'Frame capture is not deterministic');
 log('PASS visible rotating Three.js cross and deterministic frame capture');
 const restored=await importAdZip(await session.downloadZip(),{...options,projectId:crypto.randomUUID(),packages:{fetch:async()=>{throw new Error('Unexpected CDN access');}}});
 assert(await pixel((await restored.renderInputs())[0],15)===await pixel(input,15),'Offline Three.js restore mismatch');
 const exported=await renderAd((await restored.renderInputs())[0],{mode:'export',container:'webm',wasmURL:'/esbuild.wasm'});
 assert(exported.blob!.size>100,'Empty Three.js export');
 log('PASS offline Three.js ZIP restore and WebM export');
 const blocked={...input,composition:undefined,modules:undefined,source:`import React from 'react';import {FileLoader} from 'three';export default function Probe(){const [color,setColor]=React.useState('red');React.useEffect(()=>{new FileLoader().load('https://example.invalid/blocked-three-asset',()=>setColor('red'),undefined,()=>setColor('#00ff00'));},[]);return <div style={{width:64,height:64,background:color}}/>;}`};
 assert(await pixel(blocked,0)==='0,255,0,255','Three.js network loader escaped the sandbox');
 log('PASS optional Three.js network loader remains blocked by sandbox');
}
async function checkNodeCompatibility(options:any){
 const packageSource=`import fs from '/node/fs.mjs';import {readFile} from 'node:fs/promises';import {Buffer as B} from 'node:buffer';import EventEmitter from 'events';import path from 'node:path';import util from 'util';import assert from 'node:assert/strict';import processShim from '/node/process.mjs';
 const filename=path.resolve('data','color.json');
 const original=JSON.parse(fs.readFileSync(filename,'utf8')).color;
 assert.equal(B,Buffer);assert.equal(processShim,process);assert.deepEqual(Object.keys(process.env),['NODE_ENV']);assert.equal(process.cwd(),'/');
 assert.equal(path.posix.join('/data','..','data','color.json'),filename);assert.equal(fs.statSync(filename).isFile(),true);
 assert.equal(fs.readdirSync('/data',{withFileTypes:true})[0].isFile(),true);
 assert.throws(()=>fs.writeFileSync(filename,'bad'),{code:'EROFS'});assert.throws(()=>fs.readFileSync('../../outside'),{code:'EACCES'});assert.throws(()=>fs.readFileSync('/etc/passwd'),{code:'ENOENT'});
 const events=new EventEmitter();let color='red';events.once('color',value=>color=util.format('%s',B.from(value).toString()));events.emit('color',original);
 export {color};
 export async function readColor(){
  const text=await readFile(filename,'utf8');
  assert.equal(await util.promisify(fs.readFile)(filename,'utf8'),text);
  await new Promise(resolve=>process.nextTick(resolve));
  return JSON.parse(text).color;
 }`;
 const requests:string[]=[];
 const session=await createAdSession({...options,projectId:crypto.randomUUID(),packages:{fetch:async(request:any)=>{
  requests.push(String(request));return new Response(String(request).startsWith('https://registry.npmjs.org/')?JSON.stringify({name:'node-demo',version:'1.0.0'}):packageSource);
 }}});
 await session.filesystem.writeFile('/data/color.json',JSON.stringify({color:'#00ff00'}),{createParents:true});
 await session.packages.install('node-demo','1.0.0');
 assert(requests.length===2,'Node builtin imports unexpectedly downloaded polyfills');
 log('PASS installed package uses local Node shims and reads project files during import validation');
 const source=`import React from 'react';import {color,readColor} from 'node-demo';import fs from 'node:fs';export default function Demo(){const [value,setValue]=React.useState('red');React.useEffect(()=>{readColor().then(setValue);},[]);return <div style={{width:64,height:64,background:value===color&&fs.existsSync('/data/color.json')?value:'red'}}/>;}`;
 await session.editScenes({baseRevision:(await session.sceneState()).revision,operations:[
  {type:'addComponent',component:{id:'node',entry:'/Node.tsx',authoredDurationInFrames:30},source},
  {type:'addScene',scene:{id:'node',componentId:'node',startFrame:0,durationInFrames:30,sourceStartFrame:0,layer:0,props:{}}},
 ]});
 const input=(await session.renderInputs())[0];assert(await pixel(input,0)==='0,255,0,255','Node shim render failed');
 log('PASS Buffer, events, path, util/promisify, assert, process/nextTick and fs sync/callback/promise APIs');
 const zip=await session.downloadZip();
 await session.filesystem.writeFile('/data/color.json',JSON.stringify({color:'#0000ff'}));
 assert(await pixel(input,15)==='0,255,0,255','A render snapshot changed after a project edit');
 assert(await pixel((await session.renderInputs())[0],15)==='0,0,255,255','New project data did not reach the next render');
 const restored=await importAdZip(zip,{...options,projectId:crypto.randomUUID(),packages:{fetch:async()=>{throw new Error('Unexpected network access');}}});
 const restoredInput=(await restored.renderInputs())[0];assert(await pixel(restoredInput,0)==='0,255,0,255','Restored fs data differs');
 const exported=await renderAd(restoredInput,{mode:'export',container:'webm',wasmURL:'/esbuild.wasm'});assert(exported.blob!.size>100,'Node shim offline export failed');
 log('PASS immutable fs snapshots, refreshed project data, offline ZIP restore and export');
 const legacy={...restoredInput,composition:undefined,modules:undefined,packages:undefined,source:`import fs from 'fs';import assert from 'assert/strict';assert.equal(process.cwd(),'/');const color=JSON.parse(Buffer.from(fs.readFileSync('/data/color.json')).toString()).color;export default ()=> <div style={{width:64,height:64,background:color}}/>;`};
 assert(await pixel(legacy,0)==='0,255,0,255','Legacy source Node compatibility failed');
 log('PASS Node builtins and globals in legacy source mode without installed packages');
}
async function run(){
 const options={projectId:crypto.randomUUID(),durationSeconds:1,fps:30,formats:[{id:'square',width:64,height:64}],wasmURL:'/esbuild.wasm',adapters:{model:{} as any}};
 await checkNodeCompatibility(options);
 await checkThree(options);
 await checkThree(options,'0.187.0',true);
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
 const hookSession=await createAdSession({...options,projectId:crypto.randomUUID(),packages:{fetch:async(request:any)=>new Response(String(request).startsWith('https://registry.npmjs.org/')?JSON.stringify({name:'hooks-demo',version:'1.0.0',peerDependencies:{react:'*'}}):String(request)===url?`import {useState} from 'react';import {jsx} from 'react/jsx-runtime';export function Green(){const [color]=useState('#00ff00');return jsx('div',{style:{width:64,height:64,background:color}})}`:'',{status:200})}});
 await hookSession.packages.install('hooks-demo','1.0.0');
 const hookInput={...(await hookSession.renderInputs())[0],composition:undefined,modules:undefined,source:`import {Green} from 'hooks-demo';export default Green;`};
 assert(await pixel(hookInput,0)==='0,255,0,255','Duplicate React / JSX runtime failure');log('PASS package JSX runtime and hooks in legacy source mode');
 const mounted=await mountAd(document.querySelector('#preview')!,input,{wasmURL:'/esbuild.wasm'});await mounted.result;
 log('ALL PACKAGE CHECKS PASSED');
}
run().catch(error=>{log('FAIL '+(error.stack??error));});
