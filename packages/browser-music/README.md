# @deepbench/browser-music

A standalone browser composer and procedural instrument library. New scores use Tone.js 15.1.22 with browser-local offline synthesis: no recordings, sample downloads or server renderer. An injected LangChain chat model supplies the separate composition agent; synthesis and MIDI export run locally.

```ts
import {createMusicComposer, synthesizeMusic, exportMidi} from '@deepbench/browser-music';
const composer = createMusicComposer({model});
const score = await composer.compose('Eight-second playful plucked groove, leave room for dialogue', {
  durationSeconds: 8,
  signal,
});
const {blob} = await synthesizeMusic(score, {signal, onProgress}); // stereo PCM WAV
const midi = exportMidi(score); // Standard MIDI type 1
```

`MusicScore` is editable JSON. Notes use MIDI pitches, beats, duration in beats and velocity 0–1. Tracks choose from 24 presets, plus gain and pan. Use `listMusicPresets()` for the catalog and mood/role tags: electric pianos, marimba, plucks, bells, pads, basses, leads and percussion. These are synthesized timbres, including stylized strings, rather than sampled acoustic instruments. Optional patch fields control attack/release seconds, cutoff Hz, detune cents and brightness; null retains the preset. Synthesis respects exact project duration, applies an ending fade, and scales peaks down when necessary. MIDI contains tempo, note events, program, volume and pan; it uses General MIDI approximations. Custom synth patches live in JSON and do not travel in MIDI.

For studio integration use `createMusicTools({model, durationSeconds, signal, onProgress, saveFile, readFile, addMusic})`. This returns `compose_music` and `revise_music`. Composition creates `/music/<id>.json`, `.mid` and `.wav`; each revision creates a new immutable id. `addMusic` receives `{id, title, blob, durationSeconds, replacesId?}`. The host imports the blob and places it on its music track. On revisions it removes the old clip identified by `replacesId` while preserving old assets for history. `readFile` makes revisions work after reloading the browser. Attach these tools to a visual agent and call the composer only when music is requested. Save functions should write into the active run's isolated candidate workspace so failed visual runs do not affect the main project.

The package exports `musicSkill` instructions and the instrument registry. Override composer instructions or choose another model without changing synthesis. The model creates validated data, never arbitrary executable audio code. Limits are 120 seconds, 12 tracks, 512 notes/track and 2048 notes total. Cancellation is checked while scheduling and around offline rendering; native offline rendering cannot be interrupted, but its result is discarded when cancelled. WAV here is an output format, not a source sample library.

Run `pnpm --filter @deepbench/browser-music test` and `pnpm --filter @deepbench/browser-music test:browser`. Browser smoke checks the eight legacy instruments and all 24 Tone presets, exact duration and onset, finite audible output, sound controls, concurrent isolated contexts and cancellation without any model calls.


New compositions and revisions use `renderer: "tone-v1"`. Existing scores with only the original eight instruments and no renderer or sound controls keep the original DSP renderer. Existing WAV assets are unchanged until you request a revision.

Track `sound` accepts nullable controls: `warmth`, `brightness`, `space` (generated convolution reverb), `movement` (chorus), `delay` (tempo-synced echoes), all 0–1; `attack` 0.001–2 seconds and `release` 0.005–3 seconds. Supply all fields with null for preset defaults, or set sound to null. The agent receives the catalog and control instructions automatically. Example prompt: “Keep the notes and timing, but use warm electric piano, a soft dream pad, and subtle reverb.”

Each render owns its offline audio context; it does not alter live playback. WAV output includes effects; MIDI retains notes and approximate General MIDI programs only. Tone noise/chorus renders are not guaranteed bit-identical. Output is limited to the project duration with a short ending fade; arrange space for reverb tails.
