import {describe,it,expect} from 'vitest';
import {composerScoreSchema,validateScore,synthesizeMusic,exportMidi,createMusicComposer,listMusicPresets,type MusicScore} from '../src/index.js';
const score:MusicScore={title:'Test',bpm:120,durationSeconds:1,tracks:[{name:'Bell',instrument:'bell',gain:.6,pan:0,patch:null,notes:[{pitch:69,beat:0,durationBeats:.5,velocity:.8}]}]};
describe('procedural music',()=>{
 it('exposes 24 presets and rejects out-of-range sound controls',()=>{
  const presets=listMusicPresets();expect(presets).toHaveLength(24);expect(new Set(presets.map(p=>p.id)).size).toBe(24);
  const changed=structuredClone(score);changed.tracks[0].sound={warmth:2,brightness:null,space:null,movement:null,delay:null,attack:null,release:null};
  expect(()=>validateScore(changed)).toThrow();
 });

 it('synthesizes deterministic audible PCM, stereo WAV and MIDI',async()=>{
  const a=await synthesizeMusic(score,{sampleRate:8000}),b=await synthesizeMusic(score,{sampleRate:8000});
  expect(a.pcm.length).toBe(8000);expect(a.peak).toBeGreaterThan(.01);expect(a.peak).toBeLessThan(1);
  expect(a.pcm.getChannelData(0)).toEqual(b.pcm.getChannelData(0));
  expect(a.pcm.getChannelData(0)[7999]).toBe(0);
  const wav=new Uint8Array(await a.blob.arrayBuffer());expect(new TextDecoder().decode(wav.slice(0,4))).toBe('RIFF');
  const midi=new Uint8Array(await exportMidi(score).arrayBuffer());expect(new TextDecoder().decode(midi.slice(0,4))).toBe('MThd');expect(midi[11]).toBe(2);
 });
 it('patches change sound and panning moves it between channels',async()=>{
  const changed=structuredClone(score);changed.tracks[0].pan=-1;changed.tracks[0].patch={attack:.2,release:null,cutoff:200,detune:null,brightness:0};
  const a=await synthesizeMusic(score,{sampleRate:8000}),b=await synthesizeMusic(changed,{sampleRate:8000});
  expect(b.pcm.getChannelData(1).every(x=>x===0)).toBe(true);expect(b.pcm.getChannelData(0)).not.toEqual(a.pcm.getChannelData(0));
 });
 it('rejects invalid timing and aborts',async()=>{
  const bad=structuredClone(score);bad.tracks[0].notes[0].beat=3;expect(()=>validateScore(bad)).toThrow('fit');
  const abort=new AbortController();abort.abort();await expect(synthesizeMusic(score,{signal:abort.signal})).rejects.toThrow();
 });
 it('composer repairs invalid timing once and uses requested duration',async()=>{
  let calls=0;const bad=structuredClone(score);bad.durationSeconds=2;
  const model={withStructuredOutput:()=>({invoke:async()=>++calls===1?bad:score})};
  const composed=await createMusicComposer({model:model as never}).compose('A gentle sting',{durationSeconds:1});expect(calls).toBe(2);expect(composed).toEqual({...score,renderer:"tone-v1"});
 });
 it('repairs attack and cutoff errors thrown inside structured output parsing',async()=>{
  const valid={...structuredClone(score),renderer:'tone-v1',tracks:score.tracks.map(track=>({...track,sound:null}))};
  const bad={...valid,tracks:valid.tracks.map(track=>({...track,sound:{warmth:null,brightness:null,space:null,movement:null,delay:null,attack:0,release:null},patch:{attack:0,release:null,cutoff:.5,detune:null,brightness:null}}))};
  let calls=0;let correction='';
  const model={withStructuredOutput:()=>({invoke:async(messages:any[])=>{
   calls++;correction=JSON.parse(messages[1].content).correction;
   return composerScoreSchema.parse(calls===1?bad:valid);
  }})};
  const composed=await createMusicComposer({model:model as never}).compose('A gentle sting',{durationSeconds:1});
  expect(calls).toBe(2);expect(correction).toContain('attack');expect(correction).toContain('cutoff');expect(composed).toEqual(valid);
 });
 it('bounds structured output retries and preserves the final failure',async()=>{
  let calls=0;const failure=new Error('Invalid music score');
  const model={withStructuredOutput:()=>({invoke:async()=>{calls++;throw failure;}})};
  await expect(createMusicComposer({model:model as never}).compose('A sting',{durationSeconds:1})).rejects.toBe(failure);
  expect(calls).toBe(2);
 });
 it('does not retry structured output after cancellation',async()=>{
  const abort=new AbortController();let calls=0;const reason=new Error('Cancelled');
  const model={withStructuredOutput:()=>({invoke:async()=>{calls++;abort.abort(reason);throw new Error('Invalid music score');}})};
  await expect(createMusicComposer({model:model as never}).compose('A sting',{durationSeconds:1,signal:abort.signal})).rejects.toBe(reason);
  expect(calls).toBe(1);
 });
});
