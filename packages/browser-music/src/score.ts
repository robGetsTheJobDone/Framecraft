import {z} from 'zod';
import {presetIds,musicPresets} from './presets.js';
export const instrumentIds = ['warm-pad','pluck','bass','bell','lead','kick','snare','hat'] as const;
export type InstrumentId = typeof instrumentIds[number];
export interface Instrument {wave: 'sine'|'triangle'|'sawtooth'|'square'|'noise'; attack: number; release: number; cutoff: number; detune: number; brightness: number; gain: number; midiProgram: number; percussion?: number}
export const instruments: Readonly<Record<InstrumentId, Instrument>> = {
  'warm-pad': {wave:'triangle',attack:.15,release:.35,cutoff:1800,detune:6,brightness:.2,gain:.25,midiProgram:89},
  pluck: {wave:'sawtooth',attack:.003,release:.15,cutoff:2400,detune:0,brightness:.35,gain:.2,midiProgram:24},
  bass: {wave:'triangle',attack:.008,release:.08,cutoff:600,detune:0,brightness:.1,gain:.35,midiProgram:38},
  bell: {wave:'sine',attack:.002,release:.3,cutoff:9000,detune:0,brightness:.7,gain:.2,midiProgram:10},
  lead: {wave:'square',attack:.015,release:.08,cutoff:3000,detune:3,brightness:.2,gain:.15,midiProgram:80},
  kick: {wave:'sine',attack:.002,release:.08,cutoff:500,detune:0,brightness:.1,gain:.65,midiProgram:0,percussion:36},
  snare: {wave:'noise',attack:.001,release:.06,cutoff:7000,detune:0,brightness:.8,gain:.3,midiProgram:0,percussion:38},
  hat: {wave:'noise',attack:.001,release:.025,cutoff:14000,detune:0,brightness:1,gain:.12,midiProgram:0,percussion:42},
};
// Nullable fields make the schema compatible with strict provider structured output.
export const soundSchema=z.object({warmth:z.number().min(0).max(1).nullable(),brightness:z.number().min(0).max(1).nullable(),space:z.number().min(0).max(1).nullable(),movement:z.number().min(0).max(1).nullable(),delay:z.number().min(0).max(1).nullable(),attack:z.number().min(.001).max(2).nullable(),release:z.number().min(.005).max(3).nullable()}).strict();
export const scoreSchema = z.object({renderer:z.literal('tone-v1').optional(),title:z.string().min(1).max(120),bpm:z.number().min(30).max(240),durationSeconds:z.number().positive().max(120),tracks:z.array(z.object({name:z.string().min(1).max(80),instrument:z.enum(presetIds),gain:z.number().min(0).max(1),pan:z.number().min(-1).max(1),sound:soundSchema.nullable().optional(),patch:z.object({attack:z.number().min(.001).max(2).nullable(),release:z.number().min(.005).max(3).nullable(),cutoff:z.number().min(80).max(18000).nullable(),detune:z.number().min(-50).max(50).nullable(),brightness:z.number().min(0).max(1).nullable()}).nullable(),notes:z.array(z.object({pitch:z.number().int().min(0).max(127),beat:z.number().min(0),durationBeats:z.number().positive(),velocity:z.number().min(0).max(1)})).max(512)})).min(1).max(12)});
// The provider sees required nullable controls; old on-disk scores may omit them.
export const composerScoreSchema=scoreSchema.extend({renderer:z.literal('tone-v1'),tracks:z.array(scoreSchema.shape.tracks.element.extend({sound:soundSchema.nullable()})).min(1).max(12)});
export type MusicScore = z.infer<typeof scoreSchema>;
export function validateScore(value: unknown): MusicScore {
 const score=scoreSchema.parse(value); const beats=score.durationSeconds*score.bpm/60;
 for(const track of score.tracks) for(const note of track.notes) if(note.beat>=beats || note.beat+note.durationBeats>beats+1e-6) throw new Error('Notes must fit within the score duration.');
 if(score.tracks.reduce((n,t)=>n+t.notes.length,0)>2048) throw new Error('Scores are limited to 2048 notes.');
 return score;
}
export const musicSkill = {id:'procedural-music',version:'2.0.0',instructions:`Compose short instrumental soundtracks supporting an advertisement's pacing. Return a complete editable score, not prose. Time is in beats at the supplied BPM. Every note must fit inside durationSeconds; use the exact requested duration. Leave space for voiceover: sparse notes, low music gain. Build a clear ending rather than cutting off a sustained chord. Use at most 6 tracks and 256 notes for short ads. Select presets by their musical role and mood. Use warm-electric-piano plus dream-pad for intimate/emotional music; playful-pluck and soft-marimba for cute ads; rounded-bass with soft-kick for support. string-pad is stylized synthesized strings, not a sampled orchestra. Tone presets are sample-free. Sound controls warmth/brightness/space/movement/delay are 0..1, attack/release are seconds; null uses the preset. Keep reverb/delay subtle, especially on bass and drums. Do not shift note beats when improving timbre; align important accents exactly to scene cues. Leave room before the ending for effect tails. Use renderer tone-v1. Instruments: warm-pad for soft harmony; pluck for short rhythmic chords; bass for the root groove; bell for accents; lead for melody; kick/snare/hat for percussion. For drums pitch is ignored by synthesis, but use MIDI 36/38/42 respectively. Patch attack, release, cutoff, detune cents and brightness are tweakable; null preserves preset. Do not request files or samples. Use moderate velocities and avoid dense competing melodies. For revisions retain the existing musical identity and change only what was requested.`};

export const presetGuide=Object.entries(musicPresets).map(([id,p])=>`${id}: ${p.role}; ${p.moods.join(", ")}`).join("\n");
