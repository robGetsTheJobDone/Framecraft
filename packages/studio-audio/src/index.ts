import { assertValidProject, type StudioAsset, type StudioProject } from '@deepbench/studio-project';

export type AudioData = Blob | ArrayBuffer;
export type AssetResolver = (asset: StudioAsset) => AudioData | Promise<AudioData>;
export type OfflineContextFactory = (options: OfflineAudioContextOptions) => OfflineAudioContext;
export interface PcmAudio {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

function createOfflineContext(options: OfflineAudioContextOptions): OfflineAudioContext {
  if (typeof globalThis.OfflineAudioContext !== 'function') {
    throw new Error('OfflineAudioContext is unavailable. Audio decoding and mixing require a supported browser.');
  }
  return new OfflineAudioContext(options);
}

export function getAudioCapabilities(): { offlineMixing: boolean; decoding: boolean } {
  const available = typeof globalThis.OfflineAudioContext === 'function';
  return { offlineMixing: available, decoding: available };
}

/** Decodes a complete media file. Container/codec support is browser dependent; no transcoder is bundled. */
export async function decodeMediaAudio(
  data: AudioData,
  options: { sampleRate?: number; createContext?: OfflineContextFactory } = {},
): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 48_000;
  assertSampleRate(sampleRate);
  const context = (options.createContext ?? createOfflineContext)({ numberOfChannels: 2, length: 1, sampleRate });
  return decode(context, data);
}

async function decode(context: OfflineAudioContext, data: AudioData): Promise<AudioBuffer> {
  // decodeAudioData may detach its input; keep ownership with the caller.
  const bytes = data instanceof ArrayBuffer ? data.slice(0) : await data.arrayBuffer();
  try {
    return await context.decodeAudioData(bytes);
  } catch (cause) {
    throw new Error('Cannot decode audio from this media file in this browser. Use a supported audio file or transcode/extract the source audio first.', { cause });
  }
}

function assertSampleRate(value: number): void {
  if (!Number.isInteger(value) || value < 8_000 || value > 96_000) throw new RangeError('sampleRate must be an integer between 8000 and 96000.');
}

export interface MixProjectAudioOptions {
  resolveAsset: AssetResolver;
  sampleRate?: number;
  numberOfChannels?: 1 | 2;
  /** Default normalize scales down only when peak exceeds 1; reject throws instead. */
  clipping?: 'normalize' | 'reject';
  /** require (default) decodes every unmuted video; skip omits all embedded video audio. */
  videoAudio?: 'require' | 'skip';
  /** Inject for testing or an alternative compatible browser implementation. */
  createContext?: OfflineContextFactory;
}

export interface AudioMixResult {
  blob: Blob;
  buffer: AudioBuffer;
  /** Peak before optional normalization. */
  peak: number;
  /** Gain applied to prevent PCM clipping; 1 when no adjustment was needed. */
  normalizationGain: number;
}

/** Mixes all audible audio AND video clips, including source offsets, envelopes and track gain. */
export async function mixProjectAudio(project: StudioProject, options: MixProjectAudioOptions): Promise<AudioMixResult> {
  assertValidProject(project);
  // Freeze the invocation timeline across asynchronous media reads and decoding.
  project = structuredClone(project);
  const sampleRate = options.sampleRate ?? 48_000;
  assertSampleRate(sampleRate);
  const numberOfChannels = options.numberOfChannels ?? 2;
  if (numberOfChannels !== 1 && numberOfChannels !== 2) throw new RangeError('numberOfChannels must be 1 or 2.');
  if (options.clipping !== undefined && options.clipping !== 'normalize' && options.clipping !== 'reject') throw new RangeError('Unknown clipping policy.');
  if (options.videoAudio !== undefined && options.videoAudio !== 'require' && options.videoAudio !== 'skip') throw new RangeError('Unknown video audio policy.');
  const length = Math.ceil(project.durationSeconds * sampleRate);
  if (!Number.isSafeInteger(length) || length <= 0 || length > 0xffffffff) throw new RangeError('Project duration cannot be represented as an audio buffer.');
  const context = (options.createContext ?? createOfflineContext)({ numberOfChannels, length, sampleRate });
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const buffers = new Map<string, Promise<AudioBuffer>>();
  for (const track of project.tracks) {
    if (track.muted || track.gain === 0) continue;
    for (const clip of track.clips) {
      if (clip.kind === 'text' || clip.kind === 'image' || clip.kind === 'voiceover' || clip.muted || clip.gain === 0) continue;
      if (clip.kind === 'video' && options.videoAudio === 'skip') continue;
      const asset = assets.get(clip.assetId);
      if (!asset) throw new Error(`Missing asset ${clip.assetId}.`);
      let pending = buffers.get(asset.id);
      if (!pending) {
        pending = Promise.resolve(options.resolveAsset(asset)).then((data) => decode(context, data));
        buffers.set(asset.id, pending);
      }
      const buffer = await pending;
      // Allow one sample of rounding only. Web Audio otherwise silently truncates overlong sources.
      if (clip.sourceStartSeconds + clip.durationSeconds > buffer.duration + 1 / buffer.sampleRate) {
        throw new RangeError(`Clip ${clip.id} extends beyond decoded audio duration (${buffer.duration}s).`);
      }
      const fadeIn = clip.fadeInSeconds ?? 0;
      const fadeOut = clip.fadeOutSeconds ?? 0;
      if (fadeIn + fadeOut > clip.durationSeconds) throw new RangeError(`Clip ${clip.id} has overlapping fades.`);
      const source = context.createBufferSource();
      source.buffer = buffer;
      const envelope = context.createGain();
      const gain = (track.gain ?? 1) * (clip.gain ?? 1);
      const start = clip.startSeconds;
      const end = start + clip.durationSeconds;
      envelope.gain.setValueAtTime(fadeIn > 0 ? 0 : gain, start);
      if (fadeIn > 0) envelope.gain.linearRampToValueAtTime(gain, start + fadeIn);
      if (fadeOut > 0) {
        envelope.gain.setValueAtTime(gain, end - fadeOut);
        envelope.gain.linearRampToValueAtTime(0, end);
      }
      source.connect(envelope);
      envelope.connect(context.destination);
      source.start(start, clip.sourceStartSeconds, clip.durationSeconds);
    }
  }
  const buffer = await context.startRendering();
  const peak = getAudioPeak(buffer);
  if (peak > 1 && options.clipping === 'reject') throw new RangeError(`Audio mix peak ${peak} exceeds 1. Reduce clip/track gain or use normalization.`);
  const normalizationGain = peak > 1 ? 1 / peak : 1;
  if (normalizationGain < 1) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index++) data[index] *= normalizationGain;
    }
  }
  return { buffer, blob: encodeWav(buffer), peak, normalizationGain };
}

export function getAudioPeak(audio: PcmAudio): number {
  let peak = 0;
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    for (const value of audio.getChannelData(channel)) {
      if (!Number.isFinite(value)) throw new RangeError('Audio contains a non-finite sample.');
      peak = Math.max(peak, Math.abs(value));
    }
  }
  return peak;
}

/** Standard interleaved little-endian 16-bit PCM WAV. Out-of-range samples are rejected. */
export function encodeWav(audio: PcmAudio): Blob {
  const channels = audio.numberOfChannels;
  if (!Number.isInteger(channels) || channels < 1 || channels > 2) throw new RangeError('WAV encoding supports mono or stereo.');
  if (!Number.isInteger(audio.length) || audio.length < 0) throw new RangeError('Invalid audio length.');
  assertSampleRate(audio.sampleRate);
  const size = audio.length * channels * 2;
  if (size > 0xffffffff - 36) throw new RangeError('Audio exceeds standard WAV size limits.');
  const buffer = new ArrayBuffer(44 + size);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + size, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, size, true);
  const planes = Array.from({ length: channels }, (_, index) => audio.getChannelData(index));
  if (planes.some((plane) => plane.length !== audio.length)) throw new RangeError('PCM channel lengths differ.');
  for (let frame = 0; frame < audio.length; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = planes[channel][frame];
      if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new RangeError('WAV samples must be finite and between -1 and 1; normalize the mix first.');
      view.setInt16(44 + (frame * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
