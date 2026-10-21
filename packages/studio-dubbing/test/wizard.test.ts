import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '@deepbench/browser-filesystem';
import { createProjectStore, createStudioProject, type StudioProject, type DubbingSegment } from '@deepbench/studio-project';
import { DubbingWizard, type DubProjectStore, type ScriptProvider, type SpeechProvider } from '../src/index';
const segments: DubbingSegment[] = [{ id: 's1', text: 'Welcome aboard', startSeconds: 2, durationSeconds: 3 }];
function project(): StudioProject {
  const p = createStudioProject({ durationSeconds: 10 });
  p.assets.push({ id: 'source', kind: 'video', path: 'assets/source.mp4', mimeType: 'video/mp4', durationSeconds: 8 });
  p.tracks[0].clips.push({ id: 'video1', kind: 'video', assetId: 'source', startSeconds: 2, durationSeconds: 6, sourceStartSeconds: 1 });
  return p;
}
function setup(overrides: { scriptProvider?: ScriptProvider; speechProvider?: SpeechProvider } = {}) {
  let counter = 0;
  const wizard = new DubbingWizard({
    scriptProvider: { draft: async () => structuredClone(segments) },
    speechProvider: { synthesize: async () => ({ blob: new Blob(['test audio'], { type: 'audio/wav' }), durationSeconds: 2 }) },
    createId: () => `generated${++counter}`, ...overrides,
  });
  wizard.selectSource(project(), 'video1'); return wizard;
}
async function ready(wizard: DubbingWizard) { await wizard.draft('Introduce this video'); wizard.approve(); await wizard.synthesize(); }
function memoryStore(p = project()) {
  const blobs: Blob[] = []; let saves = 0;
  const store: DubProjectStore = {
    load: async () => structuredClone(p),
    save: async value => { p = structuredClone(value); saves++; },
    update: async mutator => { const next = structuredClone(p); p = structuredClone(await mutator(next) ?? next); saves++; return structuredClone(p); },
    writeAsset: async (asset, data) => { blobs.push(data as Blob); return { ...asset, path: `assets/${asset.id}.wav` }; },
  };
  return { store, blobs, get saves() { return saves; } };
}
describe('DubbingWizard', () => {
  it('persists voiceover assets and script in the conversation project store', async () => {
    const fs = new MemoryFileSystem();
    const store = createProjectStore(fs, 'conversation1');
    await store.seed(); await store.save(project());
    const wizard = setup(); await ready(wizard);
    await wizard.apply(store, { sourceAudio: 'preserve' });
    const reopened = await createProjectStore(fs, 'conversation1').load();
    const voiceAsset = reopened.assets.at(-1)!;
    expect(new TextDecoder().decode(await fs.readFile(store.resolveAssetPath(voiceAsset)))).toBe('test audio');
    expect(reopened.dubbingScripts).toHaveLength(1);
  });
  it('writes real provider bytes and applies aligned voiceover while muting source audio', async () => {
    const wizard = setup(); await ready(wizard);
    const persistence = memoryStore();
    const result = await wizard.apply(persistence.store, { sourceAudio: 'mute' });
    expect(wizard.state.stage).toBe('applied');
    expect(result.tracks[0].clips[0]).toMatchObject({ muted: true, kind: 'video' });
    expect(result.tracks.at(-1)!.clips[0]).toMatchObject({ startSeconds: 2, durationSeconds: 2, sourceStartSeconds: 0 });
    expect(result.dubbingScripts[0].segments[0].audioAssetId).toBe(result.assets.at(-1)!.id);
    expect(await persistence.blobs[0].text()).toBe('test audio'); expect(persistence.saves).toBe(1);
    await expect(wizard.apply(persistence.store, { sourceAudio: 'mute' })).rejects.toThrow('applied');
  });
  it('exposes preview audio without allowing metadata mutation', async () => {
    const wizard = setup(); await ready(wizard);
    const preview = wizard.getGeneratedAudio(); preview[0].clipDurationSeconds = 999; preview.length = 0;
    expect(wizard.getGeneratedAudio()[0].clipDurationSeconds).toBe(2);
    expect(await wizard.getGeneratedAudio()[0].blob.text()).toBe('test audio');
    wizard.editSegments(segments); expect(wizard.getGeneratedAudio()).toHaveLength(0);
  });
  it('preserves prepared speech when invalid language is rejected', async () => {
    const wizard = setup(); await ready(wizard);
    await expect(wizard.draft('Hello', { language: ' ' })).rejects.toThrow('language');
    expect(wizard.state.stage).toBe('ready');
    const result = await wizard.apply(memoryStore().store, { sourceAudio: 'preserve' });
    expect(result.tracks.at(-1)!.clips).toHaveLength(1);
  });
  it('rejects malformed provider script data', async () => {
    const wizard = setup({ scriptProvider: { draft: async () => [{ ...segments[0], id: '../bad' }] } });
    await expect(wizard.draft('Hello')).rejects.toThrow('IDs');
    expect(wizard.state.stage).toBe('source');
    expect(() => wizard.editSegments([{ ...segments[0], text: null } as any])).toThrow('text');
  });
  it('requires approval and invalidates approved audio on edit', async () => {
    const wizard = setup(); await expect(wizard.synthesize()).rejects.toThrow('source');
    await ready(wizard); wizard.editSegments([{ ...segments[0], text: 'Changed' }]);
    await expect(wizard.synthesize()).rejects.toThrow('editing');
    await expect(wizard.apply(memoryStore().store, { sourceAudio: 'preserve' })).rejects.toThrow('editing');
  });
  it('rejects out-of-window and overlapping segments', () => {
    const wizard = setup();
    expect(() => wizard.editSegments([{ ...segments[0], startSeconds: 0 }])).toThrow('contained');
    expect(() => wizard.editSegments([...segments, { ...segments[0], id: 's2', startSeconds: 4 }])).toThrow('non-overlapping');
    expect(() => wizard.editSegments([{ ...segments[0], durationSeconds: NaN }])).toThrow();
  });
  it('rejects overflow unless explicit trimming is selected', async () => {
    const wizard = setup({ speechProvider: { synthesize: async () => ({ blob: new Blob(['long'], { type: 'audio/wav' }), durationSeconds: 4 }) } });
    await wizard.draft('Hello'); wizard.approve();
    await expect(wizard.synthesize()).rejects.toThrow('exceeds'); expect(wizard.state.stage).toBe('approved');
    await wizard.synthesize({ overflow: 'trim' });
    const result = await wizard.apply(memoryStore().store, { sourceAudio: 'preserve' });
    expect(result.tracks.at(-1)!.clips[0].durationSeconds).toBe(3);
    expect(result.assets.at(-1)!.durationSeconds).toBe(4);
    expect(result.tracks[0].clips[0]).not.toHaveProperty('muted');
  });
  it('ignores stale provider results after edits', async () => {
    let resolve!: (value: DubbingSegment[]) => void;
    const wizard = setup({ scriptProvider: { draft: () => new Promise(done => { resolve = done; }) } });
    const pending = wizard.draft('Hello');
    wizard.editSegments([{ ...segments[0], text: 'My replacement' }]); resolve(segments);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(wizard.state.segments[0].text).toBe('My replacement'); expect(wizard.state.stage).toBe('editing');
  });
  it('supports cancellation even when a speech provider ignores the signal', async () => {
    let resolve!: (value: {blob: Blob; durationSeconds: number}) => void;
    const wizard = setup({ speechProvider: { synthesize: () => new Promise(done => { resolve = done; }) } });
    await wizard.draft('Hello'); wizard.approve(); const pending = wizard.synthesize();
    wizard.cancel(); resolve({ blob: new Blob(['audio'], { type: 'audio/wav' }), durationSeconds: 1 });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(wizard.state.stage).toBe('approved');
  });
  it('reports provider failure and allows retry', async () => {
    let fail = true;
    const wizard = setup({ scriptProvider: { draft: async () => { if (fail) throw new Error('Provider unavailable'); return segments; } } });
    await expect(wizard.draft('Hello')).rejects.toThrow('Provider unavailable');
    expect(wizard.state.stage).toBe('source'); expect(wizard.state.error).toContain('Provider unavailable');
    fail = false; await wizard.draft('Hello'); expect(wizard.state.stage).toBe('editing');
  });
  it('rejects changed source at apply and preserves ready audio', async () => {
    const wizard = setup(); await ready(wizard); const p = project(); p.tracks[0].clips[0].startSeconds = 3;
    const persistence = memoryStore(p);
    await expect(wizard.apply(persistence.store, { sourceAudio: 'mute' })).rejects.toThrow('Source video changed');
    expect(persistence.saves).toBe(0); expect(persistence.blobs).toHaveLength(0); expect(wizard.state.stage).toBe('ready');
  });
  it('checks an already-aborted signal before calling the provider', async () => {
    let called = false; const wizard = setup({ scriptProvider: { draft: async () => { called = true; return segments; } } });
    const controller = new AbortController(); controller.abort();
    await expect(wizard.draft('Hello', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(called).toBe(false);
  });
});
