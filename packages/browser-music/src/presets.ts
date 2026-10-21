/** Versioned, sample-free recipes. MIDI programs are approximations; JSON retains timbre. */
export const presetIds = ['warm-pad','pluck','bass','bell','lead','kick','snare','hat','warm-electric-piano','velvet-keys','bright-electric-piano','music-box','glass-bell','soft-marimba','playful-pluck','muted-pluck','dream-pad','string-pad','airy-pad','rounded-bass','deep-sub','gentle-lead','soft-kick','shaker'] as const;
export type PresetId = typeof presetIds[number];
export interface SynthPreset {
 name:string; role:'keys'|'harmony'|'melody'|'bass'|'percussion'; moods:string[];
 family:'fm'|'synth'|'kick'|'snare'|'hat'; wave:'sine'|'triangle'|'fatsawtooth'|'fattriangle'|'square';
 attack:number;decay:number;sustain:number;release:number;cutoff:number;level:number;
 harmonicity:number;modulationIndex:number;space:number;movement:number;delay:number;
 midiProgram:number;percussion?:number;
}
const recipe=(name:string,role:SynthPreset['role'],moods:string[],overrides:Partial<SynthPreset>):SynthPreset=>({name,role,moods,family:'fm',wave:'sine',attack:.008,decay:1.2,sustain:.1,release:.5,cutoff:4000,level:-16,harmonicity:2,modulationIndex:1.5,space:.12,movement:0,delay:0,midiProgram:4,...overrides});
export const musicPresets:Readonly<Record<PresetId,SynthPreset>>={
 'warm-electric-piano':recipe('Warm electric piano','keys',['emotional','intimate'],{decay:1.7,release:.7,cutoff:2800,modulationIndex:1.1,movement:.12,space:.2}),
 'velvet-keys':recipe('Velvet keys','keys',['gentle','luxury'],{attack:.025,decay:2.2,release:.9,cutoff:1800,modulationIndex:.65,harmonicity:1,movement:.2,space:.22}),
 'bright-electric-piano':recipe('Bright electric piano','keys',['optimistic','confident'],{decay:1.1,cutoff:6500,modulationIndex:3.2,space:.12}),
 'music-box':recipe('Music box','melody',['cute','nostalgic'],{harmonicity:3,modulationIndex:2.2,decay:1.2,sustain:0,release:1,space:.3,midiProgram:10}),
 'glass-bell':recipe('Glass bell','melody',['magical','luxury'],{harmonicity:2.76,modulationIndex:3.4,decay:1.5,sustain:0,release:1.2,cutoff:8500,space:.32,delay:.12,midiProgram:14}),
 'soft-marimba':recipe('Soft marimba','melody',['playful','organic'],{harmonicity:4,modulationIndex:1.7,decay:.32,sustain:0,release:.18,cutoff:3000,space:.1,midiProgram:12}),
 'playful-pluck':recipe('Playful pluck','melody',['cute','upbeat'],{harmonicity:3,modulationIndex:2.5,decay:.22,sustain:0,release:.15,cutoff:4800,delay:.1,midiProgram:24}),
 'muted-pluck':recipe('Muted pluck','melody',['calm','minimal'],{harmonicity:2,modulationIndex:1,decay:.12,sustain:0,release:.09,cutoff:1800,space:.07,midiProgram:28}),
 'dream-pad':recipe('Dream pad','harmony',['emotional','dreamy'],{family:'synth',wave:'fattriangle',attack:.6,decay:.8,sustain:.65,release:1.5,cutoff:2200,space:.32,movement:.35,level:-21,midiProgram:89}),
 'string-pad':recipe('String pad','harmony',['cinematic','emotional'],{family:'synth',wave:'fatsawtooth',attack:.3,decay:.5,sustain:.65,release:.9,cutoff:1800,space:.24,movement:.2,level:-24,midiProgram:50}),
 'airy-pad':recipe('Airy pad','harmony',['light','hopeful'],{family:'synth',wave:'fattriangle',attack:.4,decay:.7,sustain:.55,release:1.2,cutoff:4800,space:.4,movement:.4,level:-22,midiProgram:91}),
 'rounded-bass':recipe('Rounded bass','bass',['warm','confident'],{family:'synth',wave:'triangle',attack:.012,decay:.25,sustain:.5,release:.12,cutoff:700,space:0,level:-14,midiProgram:38}),
 'deep-sub':recipe('Deep sub','bass',['bold','cinematic'],{family:'synth',wave:'sine',attack:.015,decay:.2,sustain:.7,release:.15,cutoff:350,space:0,level:-14,midiProgram:38}),
 'gentle-lead':recipe('Gentle lead','melody',['friendly','emotional'],{family:'synth',wave:'triangle',attack:.03,decay:.25,sustain:.5,release:.3,cutoff:2300,space:.15,movement:.1,midiProgram:80}),
 'soft-kick':recipe('Soft kick','percussion',['gentle','organic'],{family:'kick',attack:.003,decay:.25,sustain:0,release:.08,cutoff:600,space:0,level:-12,midiProgram:0,percussion:36}),
 'shaker':recipe('Shaker','percussion',['organic','playful'],{family:'hat',attack:.008,decay:.075,sustain:0,release:.035,cutoff:6500,space:.04,level:-25,midiProgram:0,percussion:70}),
 'warm-pad':recipe('Warm pad','harmony',['warm','calm'],{family:'synth',wave:'fattriangle',attack:.18,decay:.5,sustain:.65,release:.7,cutoff:1800,space:.2,movement:.2,level:-22,midiProgram:89}),
 'pluck':recipe('Classic pluck','melody',['bright','upbeat'],{harmonicity:2,modulationIndex:3,decay:.25,sustain:0,release:.15,space:.12,midiProgram:24}),
 'bass':recipe('Classic bass','bass',['punchy','upbeat'],{family:'synth',wave:'triangle',attack:.008,decay:.2,sustain:.6,release:.1,cutoff:800,space:0,level:-14,midiProgram:38}),
 'bell':recipe('Soft bell','melody',['sweet','hopeful'],{harmonicity:2.76,modulationIndex:2,decay:1,sustain:0,release:.7,space:.25,midiProgram:10}),
 'lead':recipe('Retro lead','melody',['energetic','retro'],{family:'synth',wave:'square',attack:.015,decay:.2,sustain:.4,release:.15,cutoff:2600,level:-22,delay:.12,midiProgram:80}),
 'kick':recipe('Punchy kick','percussion',['energetic','confident'],{family:'kick',attack:.002,decay:.2,sustain:0,release:.07,cutoff:1800,space:0,level:-10,midiProgram:0,percussion:36}),
 'snare':recipe('Soft snare','percussion',['upbeat','confident'],{family:'snare',attack:.001,decay:.13,sustain:0,release:.06,cutoff:7000,space:.08,level:-24,midiProgram:0,percussion:38}),
 'hat':recipe('Closed hi-hat','percussion',['bright','energetic'],{family:'hat',attack:.001,decay:.045,sustain:0,release:.02,cutoff:12000,space:.02,level:-28,midiProgram:0,percussion:42}),
};
export const listMusicPresets=()=>presetIds.map(id=>({id,...structuredClone(musicPresets[id])}));
