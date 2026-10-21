/** An origin-local virtual filesystem. All paths are POSIX-style absolute paths. */
export interface FileStat {
  path: string;
  type: 'file' | 'directory';
  /** File bytes; directories have size zero. */
  size: number;
  createdAt: number;
  modifiedAt: number;
}
export interface WriteOptions { createParents?: boolean; exclusive?: boolean; /** Atomic text compare before overwrite. */ expectedContent?: string }
export interface BrowserFileSystem {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string | Uint8Array, options?: WriteOptions): Promise<void>;
  stat(path: string): Promise<FileStat>;
  list(path: string, options?: { recursive?: boolean }): Promise<FileStat[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
}
export type FsErrorCode = 'ENOENT' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'ENOTEMPTY' | 'EINVAL' | 'ECONFLICT';
export class FsError extends Error {
  constructor(public readonly code: FsErrorCode, public readonly path: string) {
    super(`${code}: ${path}`);
    this.name = 'FsError';
  }
}
export function normalizePath(path: string): string {
  if (!path.startsWith('/') || path.includes('\0') || path.includes('\\')) throw new FsError('EINVAL', path);
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new FsError('EINVAL', path);
      parts.pop();
    } else parts.push(part);
  }
  return `/${parts.join('/')}`;
}
type Entry = FileStat & { data?: Uint8Array };
type Entries = Map<string, Entry>;
const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/';
const metadata = ({ path, type, size, createdAt, modifiedAt }: Entry): FileStat => ({ path, type, size, createdAt, modifiedAt });
const directory = (path: string): Entry => ({ path, type: 'directory', size: 0, createdAt: Date.now(), modifiedAt: Date.now() });
function lookup(entries: Entries, path: string): Entry {
  let ancestor = parentOf(path);
  while (path !== '/' && ancestor !== '/') {
    if (entries.get(ancestor)?.type === 'file') throw new FsError('ENOTDIR', ancestor);
    ancestor = parentOf(ancestor);
  }
  const entry = entries.get(path);
  if (!entry) throw new FsError('ENOENT', path);
  return entry;
}
function ensureDirectory(entries: Entries, path: string, recursive: boolean): void {
  const existing = entries.get(path);
  if (existing) {
    if (existing.type !== 'directory') throw new FsError('ENOTDIR', path);
    return;
  }
  if (!recursive) throw new FsError('ENOENT', path);
  ensureDirectory(entries, parentOf(path), true);
  entries.set(path, directory(path));
}
abstract class BaseFileSystem implements BrowserFileSystem {
  protected abstract run<T>(write: boolean, operation: (entries: Entries) => T): Promise<T>;
  async readFile(path: string): Promise<Uint8Array> {
    path = normalizePath(path);
    return this.run(false, entries => {
      const entry = lookup(entries, path);
      if (entry.type === 'directory') throw new FsError('EISDIR', path);
      return entry.data!.slice();
    });
  }
  async writeFile(path: string, data: string | Uint8Array, options: WriteOptions = {}): Promise<void> {
    path = normalizePath(path);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data.slice();
    return this.run(true, entries => {
      const previous = entries.get(path);
      if (options.expectedContent !== undefined) {
        const expected = new TextEncoder().encode(options.expectedContent);
        if (previous?.type !== 'file' || previous.data?.length !== expected.length || !expected.every((byte, i) => previous.data![i] === byte)) throw new FsError('ECONFLICT', path);
      }
      if (previous && options.exclusive) throw new FsError('EEXIST', path);
      if (previous?.type === 'directory') throw new FsError('EISDIR', path);
      ensureDirectory(entries, parentOf(path), options.createParents ?? false);
      const now = Date.now();
      entries.set(path, { path, type: 'file', size: bytes.byteLength, data: bytes, createdAt: previous?.createdAt ?? now, modifiedAt: now });
    });
  }
  async stat(path: string): Promise<FileStat> {
    path = normalizePath(path);
    return this.run(false, entries => metadata(lookup(entries, path)));
  }
  async list(path: string, options: { recursive?: boolean } = {}): Promise<FileStat[]> {
    path = normalizePath(path);
    return this.run(false, entries => {
      if (lookup(entries, path).type !== 'directory') throw new FsError('ENOTDIR', path);
      const prefix = path === '/' ? '/' : `${path}/`;
      return [...entries.values()]
        .filter(entry => entry.path !== path && entry.path.startsWith(prefix) && (options.recursive || parentOf(entry.path) === path))
        .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(metadata);
    });
  }
  async mkdir(path: string, options: { recursive?: boolean } = {}): Promise<void> {
    path = normalizePath(path);
    return this.run(true, entries => {
      if (entries.has(path) && !options.recursive) throw new FsError('EEXIST', path);
      ensureDirectory(entries, parentOf(path), options.recursive ?? false);
      ensureDirectory(entries, path, true);
    });
  }
  async remove(path: string, options: { recursive?: boolean } = {}): Promise<void> {
    path = normalizePath(path);
    if (path === '/') throw new FsError('EINVAL', path);
    return this.run(true, entries => {
      lookup(entries, path);
      const children = [...entries.keys()].filter(key => key.startsWith(`${path}/`));
      if (children.length && !options.recursive) throw new FsError('ENOTEMPTY', path);
      for (const child of children) entries.delete(child);
      entries.delete(path);
    });
  }
}
/** Ephemeral storage, with defensive copies on both reads and writes. */
export class MemoryFileSystem extends BaseFileSystem {
  private entries: Entries = new Map([['/', directory('/')]]);
  protected async run<T>(write: boolean, operation: (entries: Entries) => T): Promise<T> {
    const next = new Map(this.entries);
    const result = operation(next);
    if (write) this.entries = next;
    return result;
  }
}
export interface IndexedDBFileSystemOptions { databaseName?: string; indexedDB?: IDBFactory }
/** Persistent storage. Each operation uses a single transaction, including parent creation. */
export class IndexedDBFileSystem extends BaseFileSystem {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly options: IndexedDBFileSystemOptions = {}) { super(); }
  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      const factory = this.options.indexedDB ?? globalThis.indexedDB;
      if (!factory) { reject(new Error('IndexedDB is unavailable in this environment')); return; }
      const request = factory.open(this.options.databaseName ?? 'deepbench-filesystem', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('entries', { keyPath: 'path' });
        store.put(directory('/'));
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); this.database = undefined; };
        resolve(database);
      };
    });
    this.database.catch(() => { this.database = undefined; });
    return this.database;
  }
  protected async run<T>(write: boolean, operation: (entries: Entries) => T): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction('entries', write ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('entries');
      let result: T;
      let failure: unknown;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Filesystem transaction aborted'));
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          const before = new Map<string, Entry>((request.result as Entry[]).map(entry => [entry.path, entry]));
          const after = new Map(before);
          result = operation(after);
          if (write) {
            for (const key of before.keys()) if (!after.has(key)) store.delete(key);
            for (const [key, entry] of after) if (before.get(key) !== entry) store.put(entry);
          }
        } catch (error) { failure = error; transaction.abort(); }
      };
    });
  }
  /** Close this instance's connection. A later operation lazily reopens it. */
  async close(): Promise<void> {
    const database = this.database;
    this.database = undefined;
    (await database)?.close();
  }
}
