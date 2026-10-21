import {encodeWav} from '@deepbench/studio-audio';
import {instruments, validateScore, type MusicScore} from './score.js';
export async function synthesizeMusic(input: MusicScore, options: {sampleRate?:number;signal?:AbortSignal;onProgress?:(progress:number)=>void}={}) {
 const score=validateScore(input), rate=options.sampleRate??48000;
 if(score.renderer==='tone-v1'||score.tracks.some(track=>!(track.instrument in instruments)||track.sound))return (await import('./tone-renderer.js')).renderToneMusic(score,options);
 if(!Number.isInteger(rate)||rate<8000||rate>96000)throw new Error('sampleRate must be between 8000 and 96000');
 const length=Math.ceil(score.durationSeconds*rate), channels=[new Float32Array(length),new Float32Array(length)];
 const count=score.tracks.reduce((n,t)=>n+t.notes.length,0);let completed=0;
 for(const track of score.tracks){
  const patch={...instruments[track.instrument as keyof typeof instruments]};for(const [key,value] of Object.entries(track.patch??{}))if(value!==null)(patch as unknown as Record<string,unknown>)[key]=value;
  const left=Math.cos((track.pan+1)*Math.PI/4),right=Math.sin((track.pan+1)*Math.PI/4);
  for(const note of track.notes){
   options.signal?.throwIfAborted(); const start=Math.round(note.beat*60/score.bpm*rate), held=note.durationBeats*60/score.bpm;
   const duration=Math.min(held+patch.release,score.durationSeconds-start/rate), size=Math.ceil(duration*rate);
   const frequency=440*2**((note.pitch-69)/12), alpha=1-Math.exp(-2*Math.PI*Math.min(patch.cutoff,rate*.45)/rate);
   let filtered=0,previousNoise=0,phase=0,seed=((start+note.pitch*7919+completed*104729)>>>0)||1;
   for(let i=0;i<size && start+i<length;i++){
    const t=i/rate;seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const noise=(seed>>>0)/2147483648-1;
    let sample:number;
    if(track.instrument==='kick'){phase+=2*Math.PI*(45+100*Math.exp(-t*35))/rate;sample=Math.sin(phase)*Math.exp(-t*12);}
    else if(track.instrument==='snare')sample=(noise*.8+Math.sin(2*Math.PI*180*t)*.2)*Math.exp(-t*20);
    else if(track.instrument==='hat'){sample=(noise-previousNoise)*.5*Math.exp(-t*45);previousNoise=noise;}
    else {const p=t*frequency; const wave=(v:number)=>patch.wave==='sine'?Math.sin(2*Math.PI*v):patch.wave==='triangle'?2/Math.PI*Math.asin(Math.sin(2*Math.PI*v)):patch.wave==='sawtooth'?2*(v-Math.floor(v+.5)):Math.sin(2*Math.PI*v)>=0?1:-1;
     sample=wave(p);if(patch.detune)sample=(sample+wave(p*2**(patch.detune/1200)))*.5;
     if(track.instrument==='bell')sample=(sample+patch.brightness*Math.sin(2*Math.PI*p*2.76)*Math.exp(-t*3))*Math.exp(-t*2);
     if(track.instrument==='pluck')sample*=Math.exp(-t*(3+patch.brightness*8));
    }
    filtered+=alpha*(sample-filtered);
    const attack=Math.min(1,t/patch.attack),release=t>held?Math.max(0,1-(t-held)/patch.release):1;
    // Short global fade prevents hard end-of-project clicks even when a note ends at the boundary.
    const endFade=Math.min(1,(length-start-i)/(rate*.015));
    const value=filtered*attack*release*endFade*track.gain*note.velocity*patch.gain;
    channels[0][start+i]+=value*left;channels[1][start+i]+=value*right;
   }
   options.onProgress?.(++completed/Math.max(1,count));
   // Yield so cancellation/UI updates remain responsive during large scores.
   await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
 }
 options.signal?.throwIfAborted();let peak=0;for(const plane of channels)for(const n of plane)peak=Math.max(peak,Math.abs(n));
 const gain=peak>.95?.95/peak:1;if(gain<1)for(const plane of channels)for(let i=0;i<plane.length;i++)plane[i]*=gain;
 const pcm={numberOfChannels:2,length,sampleRate:rate,getChannelData:(channel:number)=>channels[channel]};
 options.onProgress?.(1);return {blob:encodeWav(pcm),pcm,peak,normalizationGain:gain};
}
