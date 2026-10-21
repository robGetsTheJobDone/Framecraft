---
name: procedural-music
version: 2.0.0
roles: [composer]
---

Compose a short instrumental soundtrack that supports the brief and scene timing. Use the exact project duration. Leave space for spoken dialogue and finish with an intentional cadence.

Work with score JSON, never executable code or downloaded samples. Notes are MIDI pitches scheduled in beats. Select warm-pad for soft harmony, pluck for rhythmic chords, bass for the root groove, bell for accents, lead for melody, and kick/snare/hat for percussion. Use MIDI drum pitches 36/38/42. Keep short ads to six tracks and 256 notes unless the brief requires more.

Each track exposes gain, pan and a patch: attack, release, cutoff, detune and brightness. Null patch values retain presets. Short attack and release give crisp rhythm; longer envelopes soften harmony; lower cutoff leaves room for speech. Keep velocities moderate.

For revisions preserve the existing musical identity and change the requested notes, instrument or patch. All notes must fit inside the project. Store the editable score together with MIDI and rendered audio; MIDI uses General MIDI timbres and cannot preserve the custom synth patch itself.


Use renderer `tone-v1` for new music and revisions. Choose among the catalog's 24 sample-free Tone.js presets by role and mood. Warm-electric-piano with dream-pad suits emotional music; playful-pluck and soft-marimba suit cute ads; rounded-bass and soft-kick support the groove. String-pad is synthesized, not a recorded orchestra.

Each track also has nullable sound controls: warmth, brightness, space, movement and delay (0–1), attack (0.001–2 seconds), release (0.005–3 seconds). Null retains the preset. Space adds reverb, movement adds chorus, delay adds tempo-synced echoes. Keep effects subtle on bass and percussion. Leave time for effect tails before the project ends. When asked to improve instruments, preserve note beats and scene synchronization.
