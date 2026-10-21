import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {exportComposition, titleCardComposition, validateComposition} from '../src/index.js';

const renderer = vi.hoisted(() => ({canRenderMediaOnWeb: vi.fn(), renderMediaOnWeb: vi.fn()}));
vi.mock('@remotion/web-renderer', () => renderer);

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', {});
  renderer.canRenderMediaOnWeb.mockResolvedValue({canRender: true, issues: []});
});

describe('browser export', () => {
  it('rejects invalid metadata before loading the renderer', async () => {
    await expect(exportComposition({...titleCardComposition, fps: NaN})).rejects.toThrow('fps');
    expect(renderer.canRenderMediaOnWeb).not.toHaveBeenCalled();
    expect(() => validateComposition({...titleCardComposition, width: 0})).toThrow('width');
  });

  it('does not render when the device cannot encode the requested format', async () => {
    renderer.canRenderMediaOnWeb.mockResolvedValue({canRender: false, issues: [{message: 'H.264 unavailable'}]});
    await expect(exportComposition(titleCardComposition)).rejects.toThrow('H.264 unavailable');
    expect(renderer.renderMediaOnWeb).not.toHaveBeenCalled();
  });

  it('uses matching preview props, checks WebM support, and returns the encoded blob', async () => {
    const blob = new Blob(['video'], {type: 'video/webm'});
    renderer.renderMediaOnWeb.mockResolvedValue({getBlob: async () => blob});
    const progress = vi.fn();
    expect(await exportComposition(titleCardComposition, {format: 'webm', onProgress: progress})).toBe(blob);
    expect(renderer.canRenderMediaOnWeb).toHaveBeenCalledWith({width: 1280, height: 720, container: 'webm', videoCodec: 'vp8'});
    const options = renderer.renderMediaOnWeb.mock.calls[0]![0];
    expect(options.composition.component().props).toEqual(titleCardComposition.inputProps);
    options.onProgress({progress: 0.5});
    expect(progress).toHaveBeenCalledWith(0.5);
  });

  it('honors cancellation without starting a render', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(exportComposition(titleCardComposition, {signal: controller.signal})).rejects.toThrow();
    expect(renderer.renderMediaOnWeb).not.toHaveBeenCalled();
  });

  it('rejects non-browser usage explicitly', async () => {
    vi.stubGlobal('window', undefined);
    await expect(exportComposition(titleCardComposition)).rejects.toThrow('browser document');
  });
});
