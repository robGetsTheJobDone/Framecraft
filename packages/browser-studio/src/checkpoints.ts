import {normalizePath, type BrowserFileSystem} from '@deepbench/browser-filesystem';

/** Implement save as an atomic compare-and-swap (e.g. ETag/If-Match). Never silently overwrite. */
export interface CheckpointAdapter {
  read(projectId: string): Promise<{snapshot: Blob; version: string} | null>;
  save(projectId: string, snapshot: Blob, options: {expectedVersion: string | null; signal?: AbortSignal}): Promise<{version: string}>;
}
export class CheckpointConflictError extends Error {
  constructor(message = 'The remote session changed. Restore it before saving again.') {super(message); this.name = 'CheckpointConflictError';}
}
export class UncertainToolCallError extends Error {
  constructor(public readonly runId: string, public readonly operation: {id: string; name: string}) {
    super(`Tool ${operation.name} (${operation.id}) was interrupted with an unknown outcome. Automatic replay is blocked. Reconcile its provider result before starting another run.`);
    this.name = 'UncertainToolCallError';
  }
}
export type WorkspaceFiles = Array<{path: string; data: string}>;
export const checkpointVersionPath = '/.checkpoint-version.json';
export async function captureFiles(fs: BrowserFileSystem, include: (path: string) => boolean = () => true): Promise<WorkspaceFiles> {
  const files: WorkspaceFiles = [];
  for (const file of await fs.list('/', {recursive: true})) if (file.type === 'file' && file.path !== checkpointVersionPath && include(file.path)) {
    const bytes = await fs.readFile(file.path); let raw = '';
    for (let i=0; i<bytes.length; i+=8192) raw += String.fromCharCode(...bytes.subarray(i,i+8192));
    files.push({path: file.path, data: btoa(raw)});
  }
  return files;
}
export async function writeFiles(fs: BrowserFileSystem, files: WorkspaceFiles) {
  for (const file of files) await fs.writeFile(file.path, Uint8Array.from(atob(file.data), c=>c.charCodeAt(0)), {createParents:true});
}
export function validateFiles(value: unknown): asserts value is WorkspaceFiles {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid checkpoint files');
  const paths = new Set<string>();
  for (const file of value) {
    if (!file || typeof file.path !== 'string' || normalizePath(file.path) !== file.path || file.path === '/' || paths.has(file.path) || typeof file.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw new Error('Invalid checkpoint file');
    paths.add(file.path);
  }
}
export async function checkpointSnapshot(fs: BrowserFileSystem, projectId: string) {
  const snapshot=new Blob([JSON.stringify({schemaVersion:1,projectId,files:await captureFiles(fs)})], {type:'application/json'});
  if(snapshot.size>256*1024*1024)throw new Error('Checkpoint exceeds 256 MB');
  return snapshot;
}
export async function parseCheckpoint(snapshot: Blob, projectId: string): Promise<WorkspaceFiles> {
  if (snapshot.size > 256*1024*1024) throw new Error('Checkpoint exceeds 256 MB');
  const value = JSON.parse(await snapshot.text());
  if (value.schemaVersion !== 1 || value.projectId !== projectId) throw new Error('Checkpoint schema or project ID mismatch');
  validateFiles(value.files); return value.files;
}
