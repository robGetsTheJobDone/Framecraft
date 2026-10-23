import {verifyPackageIntegrity, type PackageLock} from './packages.js';
import {validateComposition, sceneReviewFrames, type SceneComposition} from '@deepbench/studio-project';
import {createSceneBuildOptions, sceneCompilationKey} from './module-graph.js';
import {Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, CanvasSource, AudioBufferSource, canEncodeVideo, canEncodeAudio} from 'mediabunny';
import * as esbuild from 'esbuild-wasm';
import {harnessCode, tailwindCode} from './harness-code.js';
export interface AdFormat {id: string; width: number; height: number}
export interface AdRenderInput {packages?:PackageLock; modules?: Record<string, string>; composition?: SceneComposition; source: string; assets: Record<string, string>; format: AdFormat; durationSeconds: number; fps: number; audioMix?: string}
export interface AdFrame {format: string; timeSeconds: number; dataUrl: string}
let initialized: Promise<void> | undefined;
let aacFallback: Promise<void> | undefined;
export async function compileAd(source: string, wasmURL = new URL('./esbuild.wasm', import.meta.url).href) {
  if (source.length > 60000) throw new Error('Ad.tsx is limited to 60000 characters');
  initialized ??= esbuild.initialize({wasmURL}).catch(error => {initialized = undefined; throw error;});
  await initialized;
  const result = await esbuild.transform(source, {loader: 'tsx', format: 'cjs', target: 'es2022', jsx: 'transform', sourcefile: 'Ad.tsx'});
  return result.code;
}
const sceneCache = new Map<string, string>();
export async function compileSceneModules(modules: Record<string, string>, composition: SceneComposition, wasmURL = new URL('./esbuild.wasm', import.meta.url).href, packages?:PackageLock) {
  packages=packages?structuredClone(packages):undefined;
  modules = {...modules};
  composition = structuredClone(composition);
  if(packages)await verifyPackageIntegrity(packages);
  const options = createSceneBuildOptions(modules, composition, packages);
  const key = sceneCompilationKey(modules, composition, packages);
  const cached = sceneCache.get(key); if (cached !== undefined) return cached;
  initialized ??= esbuild.initialize({wasmURL}).catch(error => {initialized = undefined; throw error;});
  await initialized;
  const result = await esbuild.build(options);
  const code = result.outputFiles![0].text;
  if (sceneCache.size >= 4) sceneCache.delete(sceneCache.keys().next().value!);
  sceneCache.set(key, code); return code;
}
const escapeScript = (code: string) => code.replace(/<\/script/gi, '<\\/script');
export async function mountAd(container: HTMLElement, input: AdRenderInput, options: {mode?: 'preview' | 'review' | 'export'; container?: 'mp4' | 'webm'; signal?: AbortSignal; wasmURL?: string; onProgress?(progress: number): void} = {}) {
  options.signal?.throwIfAborted();
  input = structuredClone(input);
  for (const value of [input.format.width, input.format.height, input.fps, input.durationSeconds]) if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid composition dimensions or duration');
  const frameCount = Math.max(1, Math.round(input.durationSeconds * input.fps));
  if (input.composition) {
    const issues = validateComposition(input.composition, {durationInFrames: frameCount, assetIds: new Set(Object.keys(input.assets))});
    if (issues.length) throw new Error(issues.map(i => `${i.path}: ${i.message}`).join('; '));
  }
  const code = input.composition ? await compileSceneModules(input.modules ?? {}, input.composition, options.wasmURL, input.packages)
    : input.packages?.packages.length ? await compileSceneModules({'/Source.tsx':input.source},{version:1,components:[{id:'source',entry:'/Source.tsx',authoredDurationInFrames:frameCount}],scenes:[]},options.wasmURL,input.packages).then(code=>code+'\nmodule.exports = {default: module.exports.default.source};') : await compileAd(input.source, options.wasmURL);
  options.signal?.throwIfAborted();
  const frame = document.createElement('iframe'); frame.title = 'Ad composition'; frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = `border:0;width:100%;aspect-ratio:${input.format.width}/${input.format.height};background:#fff;`;
  const channel = new MessageChannel();
  let pending: {resolve(value: string): void; reject(error: Error): void} | undefined;
  let disposed = false, settled = false;
  let rejectResult: (error: Error) => void = () => {};
  const dispose = (reason: Error = new Error('Render disposed')) => {if (disposed) return; disposed = true; pending?.reject(reason); pending = undefined; clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); channel.port1.close(); frame.remove(); if (!settled) {settled = true; rejectResult(reason);}};
  const abort = () => dispose(new DOMException('Render cancelled', 'AbortError'));
  let stage = 'starting renderer';
  const deadline = options.mode === 'export' ? 300000 : 60000;
  const timedOut = () => dispose(new Error(`Render timed out after ${deadline / 1000}s without completing ${stage} (${input.format.id}, ${input.format.width}×${input.format.height})`));
  let timeout = setTimeout(timedOut, deadline);
  const result = new Promise<{frames?: AdFrame[]; blob?: Blob}>((resolve, reject) => {
    rejectResult = reject;
    channel.port1.onmessage = event => {
      if (disposed) return;
      if (typeof event.data?.stage === 'string' && !settled) {stage = event.data.stage; clearTimeout(timeout); timeout = setTimeout(timedOut, deadline); return;}
      if (pending && typeof event.data?.dataUrl === 'string') {pending.resolve(event.data.dataUrl); pending = undefined; return;}
      if (typeof event.data?.progress === 'number') {options.onProgress?.(event.data.progress); return;}
      if (event.data?.error) {settled = true; reject(new Error(String(event.data.error))); dispose();}
      else if (event.data?.ready || event.data?.frames || event.data?.blob) {settled = true; clearTimeout(timeout); resolve(event.data);}
    };
  });
  // A private transferred port connects this iframe to this render operation.
  frame.onload = () => frame.contentWindow?.postMessage({type: 'deepbench-render', config: {...input, reviewFrames: input.composition ? sceneReviewFrames(input.composition, frameCount) : undefined, code, mode: options.mode ?? 'preview', container: options.container ?? 'mp4'}}, '*', [channel.port2]);
  frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; worker-src blob:;"><style>html,body{margin:0;}*{box-sizing:border-box}#root{overflow:hidden}*,*::before,*::after{animation:none!important;transition:none!important}</style><script>for(const key of ['localStorage','sessionStorage']){const values=new Map();Object.defineProperty(window,key,{value:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),clear:()=>values.clear(),key:i=>[...values.keys()][i]??null,get length(){return values.size}}});}</script><script>${escapeScript(tailwindCode)}</script></head><body><div id="root"></div><script>${escapeScript(harnessCode)}</script></body></html>`;
  container.append(frame); options.signal?.addEventListener('abort', abort, {once: true});
  if (options.signal?.aborted) abort();
  return {element: frame, result, dispose, captureFrame: (frame: number) => new Promise<string>((resolve, reject) => {
    if (disposed || pending) {reject(new Error('Renderer unavailable')); return;}
    const timer = setTimeout(() => dispose(new Error(`Frame ${frame} capture timed out after 30s (${input.format.id})`)), 30000);
    pending = {resolve: value => {clearTimeout(timer); resolve(value);}, reject: error => {clearTimeout(timer); reject(error);}};
    channel.port1.postMessage({frame});
  })};
}
export async function renderAd(input: AdRenderInput, options: {mode: 'review' | 'export'; container?: 'mp4' | 'webm'; signal?: AbortSignal; wasmURL?: string; onProgress?(progress: number): void}) {
  input = structuredClone(input);
  const container = document.createElement('div'); container.style.cssText = `position:fixed;left:-20000px;top:0;width:${input.format.width}px;pointer-events:none;`; document.body.append(container);
  let mounted: Awaited<ReturnType<typeof mountAd>> | undefined;
  try {
    mounted = await mountAd(container, input, options);
    const result = await mounted.result;
    if (options.mode === 'review') return result;
    const mp4 = options.container !== 'webm';
    const codec = mp4 ? 'avc' : 'vp8';
    if (!await canEncodeVideo(codec, {width: input.format.width, height: input.format.height})) throw new Error(mp4 ? 'This browser cannot encode H.264 for MP4. Select WebM in the export format menu, or use a browser with H.264 encoding support.' : 'This browser cannot encode WebM video. Try MP4 or another browser.');
    const canvas = document.createElement('canvas'); canvas.width = input.format.width; canvas.height = input.format.height;
    const context = canvas.getContext('2d')!;
    const target = new BufferTarget();
    const output = new Output({format: mp4 ? new Mp4OutputFormat() : new WebMOutputFormat(), target});
    const video = new CanvasSource(canvas, {codec, bitrate: 6000000});
    output.addVideoTrack(video, {frameRate: input.fps});
    let audioContext: AudioContext | undefined;
    let complete = false;
    try {
      let audio: AudioBufferSource | undefined; let decoded: AudioBuffer | undefined;
      if (input.audioMix) {
        audioContext = new AudioContext();
        decoded = await audioContext.decodeAudioData(await (await fetch(input.audioMix)).arrayBuffer());
        if (mp4 && !await canEncodeAudio('aac', {sampleRate: decoded.sampleRate, numberOfChannels: decoded.numberOfChannels})) {
          aacFallback ??= import('@mediabunny/aac-encoder').then(({registerAacEncoder}) => {registerAacEncoder();}).catch(error => {aacFallback = undefined; throw error;});
          await aacFallback;
          options.signal?.throwIfAborted();
        }
        if (!await canEncodeAudio(mp4 ? 'aac' : 'opus', {sampleRate: decoded.sampleRate, numberOfChannels: decoded.numberOfChannels})) throw new Error(mp4 ? 'AAC encoding is unavailable for this audio configuration, including the software fallback. Select WebM or another browser.' : 'This browser cannot encode Opus audio for WebM. Try MP4 or another browser.');
        audio = new AudioBufferSource({codec: mp4 ? 'aac' : 'opus', bitrate: 128000});
        output.addAudioTrack(audio);
      }
      await output.start();
      if (audio && decoded) await audio.add(decoded);
      const count = Math.max(1, Math.round(input.durationSeconds * input.fps));
      for (let frame = 0; frame < count; frame++) {
        options.signal?.throwIfAborted();
        const image = new Image(); image.src = await mounted.captureFrame(frame); await image.decode();
        if (image.width !== canvas.width || image.height !== canvas.height) throw new Error('Unexpected rendered frame dimensions');
        context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
        await video.add(frame / input.fps, 1 / input.fps);
        options.onProgress?.((frame + 1) / count);
      }
      await output.finalize(); complete = true;
      return {blob: new Blob([target.buffer!], {type: mp4 ? 'video/mp4' : 'video/webm'})};
    } finally {if (!complete) await output.cancel(); await audioContext?.close();}
  }
  finally {mounted?.dispose(); container.remove();}
}
