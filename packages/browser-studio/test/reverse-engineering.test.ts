import {describe, it, expect, vi} from 'vitest';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {analyzeVideoReference, groupReferenceFrames, referenceSampleTimes, resolveReferenceTrim, saveVideoBreakdown, readVideoBreakdown, videoBreakdownMarkdown, type PreparedVideoReference, type VideoBreakdown} from '../src/reverse-engineering.js';
import {splitReferenceAudio} from '../src/video-reference-media.js';

const report = (start = 0, end = 8, evidence = [start]): VideoBreakdown => ({title: 'A moving title', overview: 'White lettering on a green field.', themes: ['Minimal'], palette: ['Green', 'White'], typography: ['Sans serif, exact font unknown'], recurringElements: [{name: 'Title', appearance: 'White text'}], scenes: [{title: 'Title card', startSeconds: start, endSeconds: end, description: 'A title appears.', elements: [{name: 'Title', appearance: 'White lettering', position: 'Center', motion: 'Moves upward between sampled frames'}], onScreenText: ['你好'], animation: 'Inferred upward movement', transitionIn: 'Unknown', transitionOut: 'Unknown', evidenceSeconds: evidence, uncertainties: ['Easing cannot be established from one-second samples.']}], recreationNotes: ['Animate title position.'], uncertainties: ['Exact font is unknown.']});
const reference = (duration = 15.4): PreparedVideoReference => ({metadata: {name: 'reference.mp4', durationSeconds: duration, width: 1920, height: 1080, sampleIntervalSeconds: 1}, frames: referenceSampleTimes(duration).map(timeSeconds => ({timeSeconds, dataUrl: 'data:image/jpeg;base64,aW1hZ2U='})), audio: {status: 'ready', chunks: [{startSeconds: 0, endSeconds: duration, blob: new Blob(['audio'])}]}});
function modelFor(ref: PreparedVideoReference) {
  const calls: Array<{name: string; messages: any[]}> = [];
  const model = {withStructuredOutput: (_: unknown, {name}: {name: string}) => ({invoke: async (messages: any[]) => {
    calls.push({name, messages});
    if (name === 'video_breakdown') return report(0, ref.metadata.durationSeconds, [0, ref.frames.at(-1)!.timeSeconds]);
    const context = JSON.parse(messages[1].content[0].text);
    return report(context.timeRange.startSeconds, context.timeRange.endSeconds);
  }})} as any;
  return {model, calls};
}

describe('video reverse engineering', () => {
  it('validates trims without changing fractional boundaries or the caller range', () => {
    expect(resolveReferenceTrim(35.1)).toEqual({startSeconds: 0, endSeconds: 35.1});
    const trim = {startSeconds: 3.25, endSeconds: 5.75};
    expect(resolveReferenceTrim(35.1, trim)).toEqual(trim);
    expect(resolveReferenceTrim(35.1, trim)).not.toBe(trim);
    for (const range of [{startSeconds: -1, endSeconds: 5}, {startSeconds: 5, endSeconds: 5}, {startSeconds: 6, endSeconds: 5}, {startSeconds: 0, endSeconds: 36}, {startSeconds: NaN, endSeconds: 5}, {startSeconds: 0, endSeconds: Infinity}]) expect(() => resolveReferenceTrim(35.1, range)).toThrow();
  });
  it('crops audio at the selected sample boundaries and rebases times to zero', async () => {
    const rate = 16000; const data = Float32Array.from({length: rate * 6}, (_, index) => index / (rate * 6));
    const buffer = {sampleRate: rate, length: data.length, numberOfChannels: 1, getChannelData: () => data} as AudioBuffer;
    const [chunk] = splitReferenceAudio(buffer, -3.25, 2.5);
    expect(chunk.startSeconds).toBe(0); expect(chunk.endSeconds).toBe(2.5);
    const wav = new DataView(await chunk.blob.arrayBuffer());
    expect(wav.byteLength).toBe(44 + rate * 2.5 * 2);
    expect(wav.getInt16(44, true) / 32767).toBeCloseTo(3.25 / 6, 4);
    expect(wav.getInt16(wav.byteLength - 2, true) / 32767).toBeCloseTo((5.75 - 1 / rate) / 6, 4);
    const [delayed] = splitReferenceAudio(buffer, 0.5, 2.5);
    expect(delayed.startSeconds).toBe(0.5); expect(delayed.endSeconds).toBe(2.5);
  });
  it('retains original source coordinates in saved reports and exports', async () => {
    const ref = reference(2.5); ref.metadata.source = {durationSeconds: 9.2, startSeconds: 3.25, endSeconds: 5.75};
    const result = await analyzeVideoReference(ref, modelFor(ref));
    const fs = new MemoryFileSystem(); const path = await saveVideoBreakdown(fs, result);
    expect((await readVideoBreakdown(fs, path)).metadata.source).toEqual(ref.metadata.source);
    expect(videoBreakdownMarkdown(result)).toContain('Source selection: 3.25–5.75s of 9.20s.');
    result.metadata.source!.endSeconds = 7;
    await fs.writeFile(path, JSON.stringify(result));
    await expect(readVideoBreakdown(fs, path)).rejects.toThrow('duration');
  });
  it('normalizes codec overshoot in the selected audio instead of losing transcription', async () => {
    const data = new Float32Array(16000).fill(1.1); data[0] = -1.2;
    const buffer = {sampleRate: 16000, length: data.length, numberOfChannels: 1, getChannelData: () => data} as AudioBuffer;
    const [chunk] = splitReferenceAudio(buffer, 0, 1);
    const wav = new DataView(await chunk.blob.arrayBuffer());
    expect(wav.getInt16(44, true)).toBe(-32768);
    expect(wav.getInt16(46, true) / 32767).toBeCloseTo(1.1 / 1.2, 4);
  });
  it('samples partial seconds without seeking past the end and overlaps bounded groups', () => {
    expect(referenceSampleTimes(0.2)).toEqual([0]);
    expect(referenceSampleTimes(3)).toEqual([0, 1, 2]);
    const ref = reference();
    const groups = groupReferenceFrames(ref.frames, ref.metadata.durationSeconds);
    expect(groups.map(group => group.frames.map(frame => frame.timeSeconds))).toEqual([[0, 1, 2, 3, 4, 5, 6, 7], [6, 7, 8, 9, 10, 11, 12, 13], [12, 13, 14, 15]]);
    expect(groups.at(-1)!.endSeconds).toBe(15.4);
    expect(groupReferenceFrames(reference(8).frames, 8)).toHaveLength(1);
    expect(() => referenceSampleTimes(301)).toThrow();
    expect(() => groupReferenceFrames(ref.frames.slice(1), ref.metadata.durationSeconds)).toThrow();
  });
  it('sends every frame in bounded groups, carries context, and synthesizes one multilingual report', async () => {
    const ref = reference(); const {model, calls} = modelFor(ref);
    const transcribe = vi.fn(async () => ({text: '你好 — مرحبًا — Bonjour.', languages: ['zh', 'ar', 'fr']}));
    const result = await analyzeVideoReference(ref, {model, transcription: {transcribe}});
    expect(transcribe).toHaveBeenCalledOnce();
    expect(calls.map(call => call.name)).toEqual(['video_frame_group', 'video_frame_group', 'video_frame_group', 'video_breakdown']);
    expect(calls.slice(0, 3).map(call => call.messages[1].content.filter((block: any) => block.type === 'image_url').length)).toEqual([8, 8, 4]);
    const secondContext = JSON.parse(calls[1].messages[1].content[0].text);
    expect(secondContext.previousGroup.scenes[0].title).toBe('Title card');
    expect(secondContext.transcript[0].text).toContain('مرحبًا');
    const merged = JSON.parse(calls[3].messages[1].content);
    expect(merged.groups).toHaveLength(3);
    expect(result.transcript.timing).toBe('audio-chunks');
    expect(result.breakdown.scenes).toHaveLength(1);
    const fs = new MemoryFileSystem(); const path = await saveVideoBreakdown(fs, result);
    expect(JSON.parse(new TextDecoder().decode(await fs.readFile(path)))).toEqual(result);
    expect(await readVideoBreakdown(fs, path)).toEqual(result);
    expect(videoBreakdownMarkdown(result)).toContain('你好 — مرحبًا — Bonjour.');
    result.frames[0].dataUrl = 'https://example.com/tracker.jpg';
    await fs.writeFile(path, JSON.stringify(result));
    await expect(readVideoBreakdown(fs, path)).rejects.toThrow();
  });
  it('handles silent videos and absent providers explicitly without fabricating a transcript', async () => {
    const ref = reference(1); ref.audio = {status: 'no-audio', chunks: []};
    const transcribe = vi.fn();
    expect((await analyzeVideoReference(ref, {...modelFor(ref), transcription: {transcribe}})).transcript.status).toBe('no-audio');
    expect(transcribe).not.toHaveBeenCalled();
    expect((await analyzeVideoReference(reference(1), modelFor(reference(1)))).transcript.status).toBe('unavailable');
  });
  it('stops on transcription failure or cancellation without synthesizing a misleading report', async () => {
    const ref = reference(1); const {model, calls} = modelFor(ref);
    await expect(analyzeVideoReference(ref, {model, transcription: {transcribe: async () => {throw new Error('Transcription failed');}}})).rejects.toThrow('Transcription failed');
    expect(calls).toHaveLength(0);
    const controller = new AbortController();
    await expect(analyzeVideoReference(ref, {model, signal: controller.signal, transcription: {transcribe: async () => {controller.abort(); return {text: '', languages: []};}}})).rejects.toMatchObject({name: 'AbortError'});
    expect(calls).toHaveLength(0);
  });
  it('rejects fabricated frame evidence and invalid scene ranges', async () => {
    const ref = reference(1); ref.audio.status = 'no-audio';
    for (const invalid of [report(0, 1, [50]), report(0, 2, [0]), report(0.5, 1, [0]), report(0, 0.5, [0])]) {
      const model = {withStructuredOutput: () => ({invoke: async () => invalid})} as any;
      await expect(analyzeVideoReference(ref, {model})).rejects.toThrow();
    }
  });
  it('cuts audio near quiet boundaries without gaps and keeps source-relative timing', () => {
    const rate = 16000; const left = new Float32Array(rate * 43).fill(0.5);
    left.fill(0, rate * 19, rate * 19.1);
    const buffer = {sampleRate: rate, length: left.length, numberOfChannels: 2, getChannelData: () => left} as AudioBuffer;
    const chunks = splitReferenceAudio(buffer, -0.25, 42.75);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].startSeconds).toBe(0);
    expect(chunks[0].endSeconds).toBeCloseTo(18.8);
    expect(chunks.at(-1)!.endSeconds).toBe(42.75);
    for (let index = 1; index < chunks.length; index++) expect(chunks[index].startSeconds).toBe(chunks[index - 1].endSeconds);
    expect(chunks.every(chunk => chunk.blob.size <= 640044 && chunk.blob.type === 'audio/wav')).toBe(true);
  });
});
