import {musicPresets} from './presets.js';
import {validateScore,type MusicScore} from './score.js';
const u32=(n:number)=>[n>>>24&255,n>>>16&255,n>>>8&255,n&255];
const vlq=(n:number)=>{const bytes=[n&127];while((n>>>=7))bytes.unshift((n&127)|128);return bytes;};
/** Standard MIDI file type 1. Custom synth patch timbres are stored in score JSON, not MIDI. */
export function exportMidi(input:MusicScore):Blob {
 const score=validateScore(input),ppq=480;const chunks:number[]=[];
 const chunk=(events:Array<{tick:number;data:number[];priority?:number}>)=>{events.sort((a,b)=>a.tick-b.tick||((a.data[0]&240)===128?-1:0)-((b.data[0]&240)===128?-1:0));let tick=0;const bytes:number[]=[];for(const e of events){bytes.push(...vlq(e.tick-tick),...e.data);tick=e.tick;}bytes.push(0,255,47,0);chunks.push(77,84,114,107,...u32(bytes.length),...bytes);};
 const tempo=Math.round(60_000_000/score.bpm);chunk([{tick:0,data:[255,81,3,tempo>>16&255,tempo>>8&255,tempo&255]}]);
 score.tracks.forEach((track,index)=>{const preset=musicPresets[track.instrument],channel=preset.percussion!==undefined?9:index>=9?index+1:index;const name=Array.from(new TextEncoder().encode(track.name));
 const events=[{tick:0,data:[255,3,...vlq(name.length),...name]},{tick:0,data:[192|channel,preset.midiProgram]},{tick:0,data:[176|channel,7,Math.round(track.gain*127)]},{tick:0,data:[176|channel,10,Math.round((track.pan+1)*63.5)]}];
 for(const note of track.notes){if(note.velocity===0)continue;const pitch=preset.percussion??note.pitch;events.push({tick:Math.round(note.beat*ppq),data:[144|channel,pitch,Math.max(1,Math.round(note.velocity*127))]},{tick:Math.max(Math.round(note.beat*ppq)+1,Math.round((note.beat+note.durationBeats)*ppq)),data:[128|channel,pitch,0]});}
 chunk(events);});
 return new Blob([new Uint8Array([77,84,104,100,0,0,0,6,0,1,0,score.tracks.length+1,ppq>>8,ppq&255,...chunks])],{type:'audio/midi'});
}
