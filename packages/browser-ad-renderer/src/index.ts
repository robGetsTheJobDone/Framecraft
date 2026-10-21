// Keep compiler, encoder, and iframe harness code behind the first render call.
import type * as Runtime from './renderer-runtime.js';
export type {AdFormat, AdRenderInput, AdFrame} from './renderer-runtime.js';
export async function compileAd(...args: Parameters<typeof Runtime.compileAd>) {
  return (await import('./renderer-runtime.js')).compileAd(...args);
}
export async function mountAd(...args: Parameters<typeof Runtime.mountAd>) {
  args[1] = structuredClone(args[1]);
  return (await import('./renderer-runtime.js')).mountAd(...args);
}
export async function renderAd(...args: Parameters<typeof Runtime.renderAd>) {
  args[0] = structuredClone(args[0]);
  return (await import('./renderer-runtime.js')).renderAd(...args);
}

export async function compileSceneModules(...args: Parameters<typeof Runtime.compileSceneModules>) {
  args[0] = {...args[0]};
  args[1] = structuredClone(args[1]);
  return (await import('./renderer-runtime.js')).compileSceneModules(...args);
}
