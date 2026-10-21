import { createDeepAgent } from 'deepagents/browser';
import type { BrowserFileSystem } from '@deepbench/browser-filesystem';
import { BrowserBackend } from './backend.js';

export { BrowserBackend } from './backend.js';
export type { BrowserBackendOptions } from './backend.js';
type AgentParams = NonNullable<Parameters<typeof createDeepAgent>[0]>;
export type BrowserAgentOptions = Omit<AgentParams, 'backend' | 'model'> & {
  filesystem: BrowserFileSystem;
  /** Supply a configured browser-compatible model; implicit provider loading is disabled. */
  model: Exclude<AgentParams['model'], string | undefined>;
};

/** Creates the real Deep Agents graph with browser-owned persistent file storage. */
export function createBrowserAgent({ filesystem, model, ...options }: BrowserAgentOptions): ReturnType<typeof createDeepAgent> {
  if (!model || typeof model === 'string') {
    throw new TypeError('Pass a configured browser-compatible chat model instance.');
  }
  return createDeepAgent({ ...options, model, backend: new BrowserBackend(filesystem) });
}
