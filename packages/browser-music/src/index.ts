import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {SystemMessage,HumanMessage} from '@langchain/core/messages';
import {tool} from '@langchain/core/tools';
import {z} from 'zod';
import {musicSkill,composerScoreSchema,presetGuide,validateScore,type MusicScore} from './score.js';
import {synthesizeMusic} from './synthesis.js';
import {exportMidi} from './midi.js';
export * from './score.js';
export * from './presets.js';
export * from './synthesis.js';
export * from './midi.js';
export interface MusicComposerOptions {model:BaseChatModel;instructions?:string}
/** A separate role/model invocation: the visual designer delegates composition to this agent. */
export function createMusicComposer(options:MusicComposerOptions){
 return {async compose(brief:string,context:{durationSeconds:number;existing?:MusicScore;signal?:AbortSignal}){
  if(!Number.isFinite(context.durationSeconds)||context.durationSeconds<=0||context.durationSeconds>120)throw new Error('Music duration must be between 0 and 120 seconds');
  context.signal?.throwIfAborted();
  const model=options.model.withStructuredOutput(composerScoreSchema,{name:'music_score'});
  let correction='';
  for(let attempt=0;attempt<2;attempt++){
   const output=await model.invoke([new SystemMessage(`${musicSkill.instructions}\nPreset catalog:\n${presetGuide}\n${options.instructions??''}`),new HumanMessage(JSON.stringify({brief,durationSeconds:context.durationSeconds,existing:context.existing??null,correction}))],{signal:context.signal});
   try{const score=validateScore({...output,renderer:'tone-v1'});if(Math.abs(score.durationSeconds-context.durationSeconds)>.001)throw new Error('Use the exact requested durationSeconds.');return score;}
   catch(error){if(attempt===1)throw error;correction=error instanceof Error?error.message:String(error);}
  }
  throw new Error('Music composition failed');
 }};
}
export interface MusicToolOptions extends MusicComposerOptions {
 durationSeconds:number;signal?:AbortSignal;onProgress?:(message:string)=>void;
 saveFile:(path:string,data:Uint8Array|string)=>Promise<unknown>;
 readFile:(path:string)=>Promise<Uint8Array>;
 /** Import the audio; when replacesId exists, replace that previous soundtrack's clip. */
 addMusic:(music:{id:string;title:string;blob:Blob;durationSeconds:number;replacesId?:string})=>Promise<unknown>;
}
export function createMusicTools(options:MusicToolOptions){
 const composer=createMusicComposer(options);
 const generate=async(brief:string,id:string,existing?:MusicScore,replacesId?:string)=>{
  options.signal?.throwIfAborted();options.onProgress?.('Music composer is arranging the soundtrack');
  const score=await composer.compose(brief,{durationSeconds:options.durationSeconds,existing,signal:options.signal});
  options.onProgress?.('Synthesizing instruments in the browser');
  const audio=await synthesizeMusic(score,{signal:options.signal});options.signal?.throwIfAborted();
  await options.saveFile(`/music/${id}.json`,JSON.stringify(score,null,2));
  await options.saveFile(`/music/${id}.mid`,new Uint8Array(await exportMidi(score).arrayBuffer()));
  await options.saveFile(`/music/${id}.wav`,new Uint8Array(await audio.blob.arrayBuffer()));
  options.signal?.throwIfAborted();await options.addMusic({id,title:score.title,blob:audio.blob,durationSeconds:score.durationSeconds,replacesId});
  return JSON.stringify({id,title:score.title,scorePath:`/music/${id}.json`,midiPath:`/music/${id}.mid`,audioPath:`/music/${id}.wav`,durationSeconds:score.durationSeconds,tracks:score.tracks.map(t=>({name:t.name,instrument:t.instrument})),status:'Audio added to music timeline. Editable score and MIDI saved.'});
 };
 const idSchema=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
 return [tool(({brief})=>generate(brief,`music-${crypto.randomUUID()}`),{name:'compose_music',description:'Delegate to the separate music composer agent. Generates original instrumental music using browser synthesized instruments, saves editable score JSON and MIDI, and adds rendered audio to the timeline. Describe style, pacing and scene cues.',schema:z.object({brief:z.string().min(1).max(8000)})}),tool(async({id,instructions})=>{const existing=validateScore(JSON.parse(new TextDecoder().decode(await options.readFile(`/music/${id}.json`))));return generate(instructions,`music-${crypto.randomUUID()}`,existing,id);},{name:'revise_music',description:'Revise an existing generated music score and replace its soundtrack. Can tweak instruments, brightness, envelope, rhythm, notes, tempo and arrangement. Supply the music id returned by compose_music.',schema:z.object({id:idSchema,instructions:z.string().min(1).max(8000)})})];
}
