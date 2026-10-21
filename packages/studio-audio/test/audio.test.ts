import { describe, expect, it, vi } from 'vitest';
import { createStudioProject, type AudioClip } from '@deepbench/studio-project';
import { decodeMediaAudio, encodeWav, mixProjectAudio, type OfflineContextFactory } from '../src/index.js';

const pcm = (values: number[][], sampleRate = 48000) => ({
  numberOfChannels: values.length, length: values[0].length, sampleRate,
  getChannelData: (channel: number) => Float32Array.from(values[channel]),
});
const clip: AudioClip = { id: 'clip', kind: 'audio', assetId: 'sound', startSeconds: 1, durationSeconds: 2, sourceStartSeconds: 0.5, gain: 0.5, fadeInSeconds: 0.25, fadeOutSeconds: 0.5 };
function project() {
  const value = createStudioProject({ durationSeconds: 4 });
  value.assets.push({ id: 'sound', kind: 'audio', path: 'assets/sound.wav', mimeType: 'audio/wav' });
  value.tracks.find(t => t.id === 'music')!.clips.push({ ...clip });
  value.tracks.find(t => t.id === 'music')!.gain = 0.5;
  return value;
}
function mockContext(samples = [0.25, -0.25]) {
  const output = Float32Array.from(samples);
  const source = { connect: vi.fn(), start: vi.fn(), buffer: null };
  const envelope = { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } };
  const context = {
    decodeAudioData: vi.fn().mockResolvedValue({ duration: 10, sampleRate: 48000 }),
    createBufferSource: vi.fn(() => source), createGain: vi.fn(() => envelope), destination: {},
    startRendering: vi.fn().mockResolvedValue({ numberOfChannels: 1, length: samples.length, sampleRate: 48000, getChannelData: () => output }),
  };
  const factory = vi.fn(() => context) as unknown as OfflineContextFactory;
  return { context, source, envelope, factory, output };
}

describe('WAV PCM encoding', () => {
  it('writes valid stereo RIFF headers and interleaves signed samples', async () => {
    const blob = encodeWav(pcm([[-1, 1], [0.5, -0.5]]));
    const bytes = await blob.arrayBuffer();
    const view = new DataView(bytes);
    expect(blob.type).toBe('audio/wav'); expect(bytes.byteLength).toBe(52);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(44); expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000); expect(view.getUint32(40, true)).toBe(8);
    expect([44, 46, 48, 50].map(i => view.getInt16(i, true))).toEqual([-32768, 16384, 32767, -16384]);
  });
  it('rejects clipping and invalid PCM instead of silently distorting', () => {
    expect(() => encodeWav(pcm([[1.1]]))).toThrow('normalize');
    expect(() => encodeWav(pcm([[NaN]]))).toThrow('finite');
    expect(() => encodeWav({ ...pcm([[0]]), length: 2 })).toThrow('lengths');
  });
});

describe('browser mixing scheduling', () => {
  it('schedules source trim, clip placement, combined gain and fades', async () => {
    const { factory, source, envelope, context } = mockContext();
    const resolveAsset = vi.fn(() => new ArrayBuffer(1));
    const result = await mixProjectAudio(project(), { resolveAsset, createContext: factory });
    expect(factory).toHaveBeenCalledWith({ length: 192000, numberOfChannels: 2, sampleRate: 48000 });
    expect(source.start).toHaveBeenCalledWith(1, 0.5, 2);
    expect(envelope.gain.setValueAtTime.mock.calls).toEqual([[0, 1], [0.25, 2.5]]);
    expect(envelope.gain.linearRampToValueAtTime.mock.calls).toEqual([[0.25, 1.25], [0, 3]]);
    expect(context.startRendering).toHaveBeenCalledOnce();
    expect(result.peak).toBe(0.25); expect(result.normalizationGain).toBe(1);
  });
  it('decodes shared assets once and skips muted tracks/clips', async () => {
    const { factory, context } = mockContext(); const value = project();
    value.tracks[1].clips.push({ ...clip, id: 'second' }, { ...clip, id: 'muted', muted: true });
    value.tracks[0].muted = true;
    await mixProjectAudio(value, { resolveAsset: () => new ArrayBuffer(1), createContext: factory });
    expect(context.decodeAudioData).toHaveBeenCalledOnce(); expect(context.createBufferSource).toHaveBeenCalledTimes(2);
  });
  it('captures a project snapshot before asynchronous asset reads', async () => {
    const { factory, source, envelope } = mockContext(); const value = project();
    let release!: (data: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>(resolve => { release = resolve; });
    const mix = mixProjectAudio(value, { resolveAsset: () => pending, createContext: factory });
    Object.assign(value.tracks[2].clips[0], { startSeconds: 2, sourceStartSeconds: 7, gain: 4 });
    value.tracks[2].gain = 8;
    release(new ArrayBuffer(1));
    await mix;
    expect(source.start).toHaveBeenCalledWith(1, 0.5, 2);
    expect(envelope.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.25, 1.25);
  });
  it('normalizes overload with explicit peak/gain reporting, or rejects', async () => {
    const first = mockContext([2, -1]);
    const result = await mixProjectAudio(project(), { resolveAsset: () => new ArrayBuffer(1), createContext: first.factory });
    expect(result.peak).toBe(2); expect(result.normalizationGain).toBe(0.5); expect([...first.output]).toEqual([1, -0.5]);
    await expect(mixProjectAudio(project(), { resolveAsset: () => new ArrayBuffer(1), createContext: mockContext([2]).factory, clipping: 'reject' })).rejects.toThrow('exceeds 1');
  });
  it('rejects clips past decoded media and overlapping envelopes', async () => {
    const short = mockContext(); short.context.decodeAudioData.mockResolvedValue({ duration: 1, sampleRate: 48000 });
    await expect(mixProjectAudio(project(), { resolveAsset: () => new ArrayBuffer(1), createContext: short.factory })).rejects.toThrow('decoded audio duration');
    const value = project(); Object.assign(value.tracks[2].clips[0], { fadeInSeconds: 1.5, fadeOutSeconds: 1 });
    await expect(mixProjectAudio(value, { resolveAsset: () => new ArrayBuffer(1), createContext: mockContext().factory })).rejects.toThrow(/fades/);
  });
  it('has an explicit policy for embedded video audio', async () => {
    const value = project(); value.tracks[2].clips = [];
    value.assets = [{ id: 'video', kind: 'video', path: 'assets/video.mp4', mimeType: 'video/mp4' }];
    value.tracks[0].clips.push({ ...clip, kind: 'video', assetId: 'video' });
    const skipped = mockContext();
    await mixProjectAudio(value, { resolveAsset: () => new ArrayBuffer(1), createContext: skipped.factory, videoAudio: 'skip' });
    expect(skipped.context.decodeAudioData).not.toHaveBeenCalled();
    const included = mockContext();
    await mixProjectAudio(value, { resolveAsset: () => new ArrayBuffer(1), createContext: included.factory });
    expect(included.context.decodeAudioData).toHaveBeenCalledOnce();
  });
  it('preserves caller buffer ownership and reports unsupported formats', async () => {
    const { factory, context } = mockContext(); const input = new ArrayBuffer(2);
    await decodeMediaAudio(input, { createContext: factory });
    expect(context.decodeAudioData.mock.calls[0][0]).not.toBe(input);
    context.decodeAudioData.mockRejectedValue(new Error('Unsupported'));
    await expect(decodeMediaAudio(input, { createContext: factory })).rejects.toThrow('transcode/extract');
  });
});
