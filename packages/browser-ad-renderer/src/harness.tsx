import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Player, Thumbnail} from '@remotion/player';
import * as Remotion from 'remotion';
import {toPng} from 'html-to-image';
import type {SceneComposition, SceneComponent, SceneInstance} from '@deepbench/studio-project';


// Sequence normally clips its context duration at the project boundary. Preserve the
// authored clock for trims; nested Sequences still establish their own clocks.
function AuthoredDuration({duration, children}: {duration: number; children: React.ReactNode}) {
  const context = React.useContext(Remotion.Internals.SequenceContext);
  if (!context) throw new Error('Missing scene clock');
  return <Remotion.Internals.SequenceContext.Provider value={{...context, durationInFrames: duration}}>{children}</Remotion.Internals.SequenceContext.Provider>;
}
function StructuredScene({scene, definition, component: Component, common}: {scene: SceneInstance; definition: SceneComponent; component: React.ComponentType<any>; common: Record<string, unknown>}) {
  const frame = Remotion.useCurrentFrame();
  if (frame < scene.startFrame || frame >= scene.startFrame + scene.durationInFrames) return null;
  const assets = {...common.assets as Record<string, string>};
  for (const [alias, assetId] of Object.entries(definition.assetBindings ?? {})) assets[alias] = (common.assets as Record<string, string>)[assetId];
  return <Remotion.Sequence from={scene.startFrame - scene.sourceStartFrame} durationInFrames={definition.authoredDurationInFrames}>
    <AuthoredDuration duration={definition.authoredDurationInFrames}><Component {...definition.defaults} {...scene.props} {...common} assets={assets} sceneId={scene.id} durationInFrames={definition.authoredDurationInFrames} /></AuthoredDuration>
  </Remotion.Sequence>;
}

// This entry is bundled as trusted code into an opaque sandbox iframe.
const root = createRoot(document.getElementById('root')!);
window.addEventListener('message', async event => {
  if (event.source !== parent || event.data?.type !== 'deepbench-render' || !event.ports[0]) return;
  const port = event.ports[0]; const config = event.data.config;
  const send = (data: unknown) => port.postMessage(data);
  try {
    if (config.mode !== 'preview') {
      // Offscreen iframe RAF can be suspended; rendering seeks deterministic frames.
      const tick = new MessageChannel(); const callbacks = new Map<number, FrameRequestCallback>(); let next = 0;
      tick.port1.onmessage = event => {const callback = callbacks.get(event.data); callbacks.delete(event.data); callback?.(performance.now());};
      window.requestAnimationFrame = callback => {const id = ++next; callbacks.set(id, callback); tick.port2.postMessage(id); return id;};
      window.cancelAnimationFrame = id => {callbacks.delete(id);};
    }
    const module = {exports: {} as {default?: React.ComponentType<any> | Record<string, React.ComponentType<any>>}};
    const require = (id: string) => {if (id === 'react') return React; if (id === 'remotion') return Remotion; throw new Error(`Unsupported import: ${id}`);};
    const names = ['useCurrentFrame','useVideoConfig','interpolate','interpolateColors','spring','Easing','Sequence','Series','AbsoluteFill','Img','Freeze','Loop','random'];
    new Function('module', 'exports', 'require', 'React', ...names, config.code)(module, module.exports, require, React, ...names.map(name => (Remotion as any)[name]));
    const exported = module.exports.default;
    const composition = config.composition as SceneComposition | undefined;
    let Ad: React.ComponentType<any>;
    if (composition) {
      if (!exported || typeof exported !== 'object') throw new Error('Invalid scene component registry');
      const definitions = new Map(composition.components.map(c => [c.id,c]));
      for (const c of composition.components) {
        const component = exported[c.id] as any;
        if (typeof component !== 'function' && (!component || ![Symbol.for('react.memo'), Symbol.for('react.forward_ref')].includes(component.$$typeof))) throw new Error(`${c.entry} must default-export a React component`);
      }
      const ordered = [...composition.scenes].sort((a,b) => a.layer - b.layer);
      Ad = props => <Remotion.AbsoluteFill>{ordered.map(scene => <StructuredScene key={scene.id} scene={scene} definition={definitions.get(scene.componentId)!} component={exported[scene.componentId]} common={props} />)}</Remotion.AbsoluteFill>;
    } else {
      if (typeof exported !== 'function') throw new Error('Ad.tsx must export a default React component');
      Ad = exported;
    }
    const frames = Math.max(1, Math.round(config.durationSeconds * config.fps));
    const props = {format: config.format.id, width: config.format.width, height: config.format.height, assets: config.assets};
    const Scene = (props: any) => <><Ad {...props} />{config.mode === 'preview' && config.audioMix && <Remotion.Audio src={config.audioMix} />}</>;
    const common = {component: Scene, compositionWidth: props.width, compositionHeight: props.height, durationInFrames: frames, fps: config.fps, inputProps: props, errorFallback: ({error}: {error: Error}) => {send({error: error.message}); return null;}};
    if (config.mode === 'preview') {
      root.render(<Player {...common} controls style={{width: '100%'}} />); send({ready: true}); return;
    }
    const capture = async (frame: number) => {
      if (!Number.isInteger(frame) || frame < 0 || frame >= frames) throw new Error('Invalid frame');
      flushSync(() => root.render(<Thumbnail {...common} frameToDisplay={frame} style={{width: props.width, height: props.height}} />));
      await document.fonts.ready;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await Promise.all(Array.from(document.images).map(img => img.decode()));
      return toPng(document.getElementById('root')!, {width: props.width, height: props.height, pixelRatio: 1, skipFonts: true});
    };
    if (config.mode === 'export') {
      port.onmessage = async event => {
        try {send({frame: event.data.frame, dataUrl: await capture(event.data.frame)});}
        catch (error) {send({error: String(error)});}
      };
      send({ready: true}); return;
    }
    const results = [];
    for (const frame of config.reviewFrames ?? [.1, .35, .6, .85].map(fraction => Math.floor((frames - 1) * fraction))) {
      results.push({format: props.format, timeSeconds: frame / config.fps, dataUrl: await capture(frame)});
    }
    send({frames: results});
  } catch (error) {send({error: error instanceof Error ? error.message : String(error)});}
});
