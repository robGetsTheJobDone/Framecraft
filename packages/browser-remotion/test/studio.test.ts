import {describe, expect, it, vi, afterEach} from 'vitest';
import {createStudioProject} from '@deepbench/studio-project';
import {clipVolumeAtTime, createStudioComposition, prepareStudioComposition} from '../src/studio.js';

afterEach(() => vi.restoreAllMocks());
describe('studio compositions', () => {
  it('validates missing media, snapshots timelines, and rounds composition duration', () => {
    const project = createStudioProject({durationSeconds: 1.01, fps: 30});
    project.assets.push({id: 'v', kind: 'video', path: 'assets/v', mimeType: 'video/webm'});
    project.tracks[0].clips.push({id: 'v', kind: 'video', assetId: 'v', startSeconds: 0, durationSeconds: 1, sourceStartSeconds: 0});
    expect(() => createStudioComposition(project, {})).toThrow('Missing URL');
    const composition = createStudioComposition(project, {v: 'blob:v'});
    project.title = 'Changed';
    expect(composition.inputProps.project.title).toBe('Untitled video');
    expect(composition.durationInFrames).toBe(31);
  });
  it('combines clip/track gain with fades and mute while preserving visual clips', () => {
    const clip = {id: 'v', kind: 'video' as const, assetId: 'v', startSeconds: 5, durationSeconds: 4, sourceStartSeconds: 2, gain: 0.5, fadeInSeconds: 1, fadeOutSeconds: 1};
    const track = {id: 'video', kind: 'video' as const, name: 'Video', gain: 0.4, clips: [clip]};
    expect(clipVolumeAtTime(clip, track, 0.5)).toBeCloseTo(0.1);
    expect(clipVolumeAtTime(clip, track, 2)).toBeCloseTo(0.2);
    expect(clipVolumeAtTime(clip, track, 3.5)).toBeCloseTo(0.1);
    expect(clipVolumeAtTime(clip, {...track, muted: true}, 2)).toBe(0);
  });
  it('releases already-created media URLs if another asset fails to load', async () => {
    const project = createStudioProject();
    project.assets = ['a','b'].map(id => ({id, kind: 'audio', path: `assets/${id}`, mimeType: 'audio/wav'}));
    project.tracks[1].clips = ['a','b'].map(id => ({id, kind: 'audio', assetId: id, startSeconds: 0, durationSeconds: 1, sourceStartSeconds: 0}));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await expect(prepareStudioComposition(project, async asset => { if (asset.id === 'b') throw new Error('Missing file'); return new Blob(['a']); })).rejects.toThrow('Missing file');
    expect(revoke).toHaveBeenCalledWith('blob:test');
  });
  it('handles asset IDs matching object prototype keys without leaking media URLs', async () => {
    const project = createStudioProject();
    project.assets = [{id: '__proto__', kind: 'audio', path: 'assets/proto', mimeType: 'audio/wav'}];
    project.tracks[1].clips = [{id: 'clip', kind: 'audio', assetId: '__proto__', startSeconds: 0, durationSeconds: 1, sourceStartSeconds: 0}];
    expect(() => createStudioComposition(project, {})).toThrow('Missing URL');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:proto');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const prepared = await prepareStudioComposition(project, async () => new Blob(['audio']));
    expect(prepared.composition.inputProps.assetUrls['__proto__']).toBe('blob:proto');
    prepared.dispose();
    expect(revoke).toHaveBeenCalledWith('blob:proto');
  });
});
