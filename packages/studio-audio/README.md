# @deepbench/studio-audio

Browser audio extraction, timeline mixing, and 16-bit PCM WAV export using the shared studio project model. Works before video production (music/voiceover assembly) and after import (source audio trim and mix).

```ts
import { mixProjectAudio } from '@deepbench/studio-audio';

const mix = await mixProjectAudio(project, {
  resolveAsset: async (asset) => new Blob([await fs.readFile(`${workspace.root}/${asset.path}`)]),
  clipping: 'normalize',
});
// mix.blob is audio/wav; mix.buffer can be previewed with Web Audio.
// peak and normalizationGain expose any overload correction.
```

The resolver owns media storage and access. Each asset is decoded once per mix. Every audio/video clip contributes at `startSeconds`, trimmed from `sourceStartSeconds` for `durationSeconds`, with linear fades, clip gain, track gain, and audio mute. The output spans the full project duration, including silence. Overlong source trims and overlapping fades throw. Muting a video suppresses only its audio, not its visual presence.

`decodeMediaAudio(blobOrArrayBuffer)` extracts decoded PCM from a complete browser-supported media file. `getAudioCapabilities()` detects the API, not individual codec support. Web Audio does not reliably decode every video container; this package does not bundle a demuxer/transcoder. Unsupported media and video without audio produce an actionable error by default. Mark a silent video clip muted, supply a separately extracted audio asset, or explicitly set `videoAudio: 'skip'` to omit all embedded video audio. Audio files still must decode successfully.

`mixProjectAudio` uses OfflineAudioContext, requiring a browser with Web Audio. Default output is stereo at 48 kHz (mono and 8–96 kHz supported). Summation can overload: default peak normalization scales down only when needed and reports the applied gain; `clipping: 'reject'` throws instead. The WAV encoder rejects invalid or clipped PCM instead of silently saturating. Processing retains decoded source buffers and rendered output in memory; this is intended for bounded studio projects, not streaming long-form media.

Web Audio references: [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext), [decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData), [source scheduling](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start).
