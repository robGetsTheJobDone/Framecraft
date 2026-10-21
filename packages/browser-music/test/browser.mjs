import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:`import {synthesizeMusic,instruments,exportMidi,listMusicPresets} from './packages/browser-music/src/index.ts'; window.music={synthesizeMusic,instruments,exportMidi,listMusicPresets};`,resolveDir:root},bundle:true,platform:'browser',format:'iife',write:false});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(async()=>{
  const {synthesizeMusic,instruments,exportMidi,listMusicPresets}=window.music;
  const tracks=Object.keys(instruments).map((instrument,index)=>({name:instrument,instrument,gain:.3,pan:0,patch:null,notes:[{pitch:60+index,beat:index*.25,durationBeats:.2,velocity:.8}]}));
  const score={title:'All eight synths',bpm:120,durationSeconds:2,tracks};
  const rendered=await synthesizeMusic(score);const context=new OfflineAudioContext(2,96000,48000);const decoded=await context.decodeAudioData(await rendered.blob.arrayBuffer());
  return {duration:decoded.duration,channels:decoded.numberOfChannels,peak:rendered.peak,audible:Array.from({length:8},(_,i)=>decoded.getChannelData(0).slice(Math.floor(i*.125*48000),Math.floor((i*.125+.1)*48000)).some(v=>Math.abs(v)>.001)),midiSize:exportMidi(score).size};
 });
 assert.equal(result.duration,2);assert.equal(result.channels,2);assert.ok(result.peak>.01);assert.ok(result.audible.every(Boolean));assert.ok(result.midiSize>100);
 const tone=await page.evaluate(async()=>{
  const {synthesizeMusic,listMusicPresets}=window.music;
  const make=(instrument,sound=null)=>({renderer:'tone-v1',title:'Preset check',bpm:120,durationSeconds:1,tracks:[{name:instrument,instrument,gain:.7,pan:0,patch:null,sound,notes:[{pitch:60,beat:.2,durationBeats:.6,velocity:.8}]}]});
  const results=[];
  for(const preset of listMusicPresets()){
   const r=await synthesizeMusic(make(preset.id),{sampleRate:24000});
   const plane=r.pcm.getChannelData(0);
   results.push({id:preset.id,peak:r.peak,outputPeak:Math.max(...plane.map(Math.abs)),length:plane.length,finite:plane.every(Number.isFinite),silentStart:plane.slice(0,2000).every(v=>Math.abs(v)<.00001)});
  }
  const controls={warmth:1,brightness:0,space:0,movement:0,delay:0,attack:.1,release:.05};
  const [a,b]=await Promise.all([synthesizeMusic(make('warm-electric-piano'),{sampleRate:24000}),synthesizeMusic(make('warm-electric-piano',controls),{sampleRate:24000})]);
  const abort=new AbortController();abort.abort();let cancelled=false;
  try{await synthesizeMusic(make('dream-pad'),{signal:abort.signal});}catch{cancelled=true;}
  return {results,cancelled,different:a.pcm.getChannelData(0).some((v,i)=>Math.abs(v-b.pcm.getChannelData(0)[i])>.001)};
 });
 assert.equal(tone.results.length,24);
 for(const preset of tone.results){assert.ok(preset.peak>.0001,JSON.stringify(preset));assert.ok(preset.outputPeak>.1 && preset.outputPeak<=.851,JSON.stringify(preset));assert.equal(preset.length,24000);assert.ok(preset.finite);assert.ok(preset.silentStart,JSON.stringify(preset));}
 assert.ok(tone.different);assert.ok(tone.cancelled);
 console.log('Tone passed: 24 audible presets, bounded controls change audio, isolated concurrent rendering, exact duration/timing, cancellation.');
 console.log('Browser music passed: eight procedural instruments → stereo PCM/WAV → real browser decode, MIDI export.');
}finally{await browser.close();}
