import * as Tone from 'tone';
import {encodeWav} from '@deepbench/studio-audio';
import {musicPresets} from './presets.js';
import type {MusicScore} from './score.js';

/** Isolated offline graph: never changes the player's/global Tone context. */
export async function renderToneMusic(score:MusicScore, options:{sampleRate?:number;signal?:AbortSignal;onProgress?:(progress:number)=>void}={}) {
 const rate=options.sampleRate??48000;
 if(!Number.isInteger(rate)||rate<8000||rate>96000)throw new Error('sampleRate must be between 8000 and 96000');
 options.signal?.throwIfAborted();
 const length=Math.ceil(score.durationSeconds*rate);
 const context=new Tone.OfflineContext(2,length/rate,rate);
 const nodes:{dispose():unknown}[]=[];
 const keep=<T extends {dispose():unknown}>(node:T):T=>{nodes.push(node);return node;};
 try {
  const master=keep(new Tone.Gain({context,gain:.8})).toDestination();
  // Synthesized impulse response; no recordings, network fetches or sample library.
  const impulse=context.createBuffer(2,Math.ceil(rate*1.4),rate);
  for(let c=0;c<2;c++){let seed=1979+c*919;const plane=impulse.getChannelData(c);
   for(let i=0;i<plane.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;plane[i]=((seed>>>0)/2147483648-1)*Math.exp(-i/rate*5);}
  }
  const room=keep(new Tone.Convolver({context,url:impulse})).connect(master);
  for(const [index,track] of score.tracks.entries()){
   options.signal?.throwIfAborted();
   const p=musicPresets[track.instrument], s=track.sound, patch=track.patch;
   const attack=s?.attack??patch?.attack??p.attack, release=s?.release??patch?.release??p.release;
   const brightness=s?.brightness??patch?.brightness??.5, warmth=s?.warmth??.5;
   const cutoff=Math.min(rate*.45,Math.max(80,(patch?.cutoff??p.cutoff)*2**((brightness-.5)*3-(warmth-.5)*2)));
   const envelope={attack,decay:p.decay,sustain:p.sustain,release};
   const out=keep(new Tone.Gain({context,gain:track.gain})).connect(master);
   const pan=keep(new Tone.Panner({context,pan:track.pan})).connect(out);
   const send=keep(new Tone.Gain({context,gain:(s?.space??p.space)*.5})).connect(room);out.connect(send);
   let destination:Tone.ToneAudioNode=pan;
   const delay=s?.delay??p.delay;
   if(delay>0){const fx=keep(new Tone.FeedbackDelay({context,delayTime:30/score.bpm,feedback:.25,wet:delay*.35})).connect(destination);destination=fx;}
   const movement=s?.movement??p.movement;
   if(movement>0){const fx=keep(new Tone.Chorus({context,frequency:.8,delayTime:3.5,depth:movement,wet:movement*.4})).connect(destination).start(0);destination=fx;}
   const filter=keep(new Tone.Filter({context,frequency:cutoff,type:p.family==='hat'?'highpass':'lowpass',rolloff:-12})).connect(destination);
   const detune=patch?.detune??0;
   const voice=p.family==='fm'
    ?keep(new Tone.PolySynth({context,voice:Tone.FMSynth,maxPolyphony:64,options:{volume:p.level,detune,harmonicity:p.harmonicity,modulationIndex:p.modulationIndex,oscillator:{type:'sine'},envelope,modulationEnvelope:{...envelope,sustain:.15}}})).connect(filter)
    :p.family==='synth'
    ?keep(new Tone.PolySynth({context,voice:Tone.Synth,maxPolyphony:64,options:{volume:p.level,detune,oscillator:{type:p.wave},envelope}})).connect(filter)
    :p.family==='kick'
    ?keep(new Tone.MembraneSynth({context,volume:p.level,pitchDecay:.04,octaves:5,envelope})).connect(filter)
    :keep(new Tone.NoiseSynth({context,volume:p.level,noise:{type:p.family==='hat'?'white':'pink'},envelope})).connect(filter);
   for(const note of [...track.notes].sort((a,b)=>a.beat-b.beat)){
    if(!note.velocity)continue;
    const start=note.beat*60/score.bpm, duration=note.durationBeats*60/score.bpm;
    if(voice instanceof Tone.NoiseSynth)voice.triggerAttackRelease(duration,start,note.velocity);
    else voice.triggerAttackRelease(p.family==='kick'?48:440*2**((note.pitch-69)/12),duration,start,note.velocity);
   }
   options.onProgress?.(.3*(index+1)/score.tracks.length);
   await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  options.signal?.throwIfAborted();
  const buffer=await context.render();
  options.signal?.throwIfAborted();
  const channels=[new Float32Array(buffer.getChannelData(0)),new Float32Array(buffer.getChannelData(1))];
  buffer.dispose();
  let peak=0;
  for(const plane of channels)for(let i=0;i<length;i++){
   if(!Number.isFinite(plane[i]))throw new Error('Music renderer produced invalid audio.');
   plane[i]*=Math.min(1,(length-1-i)/(rate*.02));
   peak=Math.max(peak,Math.abs(plane[i]));
  }
  // Master generated scores to a usable source level; clip dB controls set mix loudness.
  const gain=peak>1e-5?.85/peak:1;
  if(gain!==1)for(const plane of channels)for(let i=0;i<length;i++)plane[i]*=gain;
  const pcm={numberOfChannels:2,length,sampleRate:rate,getChannelData:(channel:number)=>channels[channel]};
  options.onProgress?.(1);
  return {blob:encodeWav(pcm),pcm,peak,normalizationGain:gain};
 } finally {
  for(const node of nodes.reverse())node.dispose();
  context.dispose();
 }
}
