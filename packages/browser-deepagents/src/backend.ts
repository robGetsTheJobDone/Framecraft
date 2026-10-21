import { normalizePath, type BrowserFileSystem, type FileStat } from '@deepbench/browser-filesystem';
import { minimatch } from 'minimatch';
import type {
  BackendProtocolV2, FileInfo, ReadResult, ReadRawResult, LsResult, GlobResult,
  GrepResult, WriteResult, EditResult, DeleteResult, FileUploadResponse,
  FileDownloadResponse, FileOperationError,
} from 'deepagents/browser';

export interface BrowserBackendOptions {
  /** Override MIME detection for custom asset formats. */
  mimeType?: (path: string) => string | undefined;
}
const mimeTypes: Record<string, string> = {
  json: 'application/json', js: 'text/javascript', jsx: 'text/javascript',
  ts: 'text/typescript', tsx: 'text/typescript', html: 'text/html', css: 'text/css',
  md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', zip: 'application/zip',
};
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const info = (stat: FileStat): FileInfo => ({
  path: stat.type === 'directory' && stat.path !== '/' ? `${stat.path}/` : stat.path,
  is_dir: stat.type === 'directory', size: stat.size,
  modified_at: new Date(stat.modifiedAt).toISOString(),
});
function operationError(error: unknown): FileOperationError {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') return 'file_not_found';
  if (code === 'EISDIR') return 'is_directory';
  if (code === 'EINVAL' || code === 'ENOTDIR') return 'invalid_path';
  return 'permission_denied';
}

/** V2 filesystem backend. Deliberately has no shell/execute capability. */
export class BrowserBackend implements BackendProtocolV2 {
  constructor(readonly filesystem: BrowserFileSystem, private readonly options: BrowserBackendOptions = {}) {}

  private decode(path: string, bytes: Uint8Array): { content: string | Uint8Array; mimeType: string } {
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = this.options.mimeType?.(path) ?? mimeTypes[extension];
    const text = !mimeType || mimeType.startsWith('text/') || /(?:json|xml|javascript)$/.test(mimeType);
    if (text && !bytes.includes(0)) {
      try { return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), mimeType: mimeType ?? 'text/plain' }; }
      catch { /* Invalid UTF-8 is preserved as binary. */ }
    }
    return { content: bytes, mimeType: mimeType ?? 'application/octet-stream' };
  }

  async ls(path: string): Promise<LsResult> {
    try { return { files: (await this.filesystem.list(path)).map(info) }; }
    catch (error) { return { error: message(error) }; }
  }

  async read(path: string, offset = 0, limit = 500): Promise<ReadResult> {
    try {
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1) {
        throw new Error('offset must be a nonnegative integer and limit a positive integer');
      }
      const data = this.decode(path, await this.filesystem.readFile(path));
      if (typeof data.content !== 'string') return data;
      const lines = data.content.split('\n');
      const end = Math.min(offset + limit, lines.length);
      return {
        content: lines.slice(offset, end).join('\n'), mimeType: data.mimeType,
        totalLines: lines.length, startLine: offset + 1, endLine: end,
        ...(end < lines.length ? { nextOffset: end } : {}),
      };
    } catch (error) { return { error: message(error) }; }
  }

  async readRaw(path: string): Promise<ReadRawResult> {
    try {
      const stat = await this.filesystem.stat(path);
      return { data: {
        ...this.decode(path, await this.filesystem.readFile(path)),
        created_at: new Date(stat.createdAt).toISOString(), modified_at: new Date(stat.modifiedAt).toISOString(),
      } };
    } catch (error) { return { error: message(error) }; }
  }

  async write(path: string, content: string): Promise<WriteResult> {
    try {
      const normalized = normalizePath(path);
      await this.filesystem.writeFile(normalized, content, { createParents: true });
      return { path: normalized };
    } catch (error) { return { error: message(error) }; }
  }

  async edit(path: string, oldString: string, newString: string, replaceAll = false): Promise<EditResult> {
    try {
      if (!oldString) throw new Error('oldString must not be empty');
      const normalized = normalizePath(path);
      const data = this.decode(normalized, await this.filesystem.readFile(normalized));
      if (typeof data.content !== 'string') throw new Error('Cannot edit a binary file');
      const parts = data.content.split(oldString);
      const occurrences = parts.length - 1;
      if (occurrences === 0) throw new Error('oldString was not found');
      if (occurrences > 1 && !replaceAll) throw new Error('oldString occurs multiple times; provide unique context or set replaceAll');
      await this.filesystem.writeFile(normalized, parts.join(newString));
      return { path: normalized, occurrences };
    } catch (error) { return { error: message(error) }; }
  }

  async glob(pattern: string, path = '/'): Promise<GlobResult> {
    try {
      const base = normalizePath(path);
      const entries = await this.filesystem.list(base, { recursive: true });
      return { files: entries.filter((entry) => minimatch(
        pattern.startsWith('/') ? entry.path : entry.path.slice(base === '/' ? 1 : base.length + 1),
        pattern, { dot: true },
      )).map(info) };
    } catch (error) { return { error: message(error) }; }
  }

  async grep(pattern: string, path: string | null = '/', glob: string | null = null, maxCount?: number | null): Promise<GrepResult> {
    try {
      if (maxCount != null && (!Number.isInteger(maxCount) || maxCount < 1)) throw new Error('maxCount must be a positive integer');
      const base = normalizePath(path ?? '/');
      const stat = await this.filesystem.stat(base);
      const entries = stat.type === 'file' ? [stat] : await this.filesystem.list(base, { recursive: true });
      const matches: NonNullable<GrepResult['matches']> = [];
      for (const entry of entries) {
        if (entry.type !== 'file') continue;
        const candidate = glob?.startsWith('/') ? entry.path : entry.path.slice(base === '/' ? 1 : base.length + 1);
        if (glob && !minimatch(glob.startsWith('/') ? entry.path : stat.type === 'file' ? entry.path.split('/').pop()! : candidate, glob, { dot: true, matchBase: true })) continue;
        const data = this.decode(entry.path, await this.filesystem.readFile(entry.path));
        if (typeof data.content !== 'string') continue;
        for (const [index, line] of data.content.split('\n').entries()) {
          if (!line.includes(pattern)) continue;
          if (maxCount != null && matches.length >= maxCount) return { matches, truncated: true };
          matches.push({ path: entry.path, line: index + 1, text: line });
        }
      }
      return { matches };
    } catch (error) { return { error: message(error) }; }
  }

  async delete(path: string): Promise<DeleteResult> {
    try {
      const normalized = normalizePath(path);
      if (normalized === '/') throw new Error('Cannot delete the filesystem root');
      await this.filesystem.remove(normalized, { recursive: true });
      return { path: normalized };
    } catch (error) { return { error: message(error) }; }
  }

  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    const results: FileUploadResponse[] = [];
    for (const [path, content] of files) {
      try {
        await this.filesystem.writeFile(path, content, { createParents: true });
        results.push({ path, error: null });
      } catch (error) { results.push({ path, error: operationError(error) }); }
    }
    return results;
  }

  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    return Promise.all(paths.map(async (path) => {
      try { return { path, content: await this.filesystem.readFile(path), error: null }; }
      catch (error) { return { path, content: null, error: operationError(error) }; }
    }));
  }
}
