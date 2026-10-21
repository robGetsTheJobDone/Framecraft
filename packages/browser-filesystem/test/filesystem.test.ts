import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { MemoryFileSystem, IndexedDBFileSystem, normalizePath, type BrowserFileSystem } from '../src/index.js';

for (const [name, create] of [
  ['memory', () => new MemoryFileSystem()],
  ['indexeddb', () => new IndexedDBFileSystem({ indexedDB: new IDBFactory() })],
] as const) {
  describe(name, () => {
    it('writes UTF-8 with parents and returns isolated bytes and metadata', async () => {
      const fs: BrowserFileSystem = create();
      await fs.writeFile('/project/./docs/../hello.txt', 'héllo', { createParents: true });
      expect(await fs.stat('/project/hello.txt')).toMatchObject({ type: 'file', size: 6 });
      const bytes = await fs.readFile('/project/hello.txt');
      bytes[0] = 0;
      expect(new TextDecoder().decode(await fs.readFile('/project/hello.txt'))).toBe('héllo');
      const input = new Uint8Array([1, 2]);
      const pending = fs.writeFile('/binary', input);
      input[0] = 5;
      await pending;
      expect(await fs.readFile('/binary')).toEqual(new Uint8Array([1, 2]));
      expect((await fs.list('/')).map(entry => entry.path)).toEqual(['/binary', '/project']);
      expect((await fs.list('/', { recursive: true })).map(entry => entry.path)).toEqual(['/binary', '/project', '/project/hello.txt']);
    });
    it('preserves files on exclusive write and rejects invalid operations', async () => {
      const fs = create();
      await expect(fs.writeFile('/missing/file', 'x')).rejects.toMatchObject({ code: 'ENOENT' });
      await fs.writeFile('/file', 'original');
      await expect(fs.writeFile('/file', 'changed', { exclusive: true })).rejects.toMatchObject({ code: 'EEXIST' });
      expect(new TextDecoder().decode(await fs.readFile('/file'))).toBe('original');
      await expect(fs.readFile('/')).rejects.toMatchObject({ code: 'EISDIR' });
      await expect(fs.list('/file')).rejects.toMatchObject({ code: 'ENOTDIR' });
      await expect(fs.writeFile('/file/child', 'x', { createParents: true })).rejects.toMatchObject({ code: 'ENOTDIR' });
      await expect(fs.readFile('/file/child')).rejects.toMatchObject({ code: 'ENOTDIR' });
      await expect(fs.remove('/', { recursive: true })).rejects.toMatchObject({ code: 'EINVAL' });
    });
    it('rejects stale text edits atomically, including competing writers', async () => {
      const fs = create();
      await fs.writeFile('/brief.md', 'original');
      const results = await Promise.allSettled([
        fs.writeFile('/brief.md', 'user edit', {expectedContent: 'original'}),
        fs.writeFile('/brief.md', 'agent edit', {expectedContent: 'original'}),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find(r => r.status === 'rejected')).toMatchObject({reason: {code: 'ECONFLICT'}});
      const winner = new TextDecoder().decode(await fs.readFile('/brief.md'));
      await expect(fs.writeFile('/brief.md', 'stale', {expectedContent: 'original'})).rejects.toMatchObject({code: 'ECONFLICT'});
      expect(new TextDecoder().decode(await fs.readFile('/brief.md'))).toBe(winner);
      await expect(fs.writeFile('/missing', 'new', {expectedContent: ''})).rejects.toMatchObject({code: 'ECONFLICT'});
    });
    it('creates and removes empty and recursive directories', async () => {
      const fs = create();
      await fs.mkdir('/a/b', { recursive: true });
      await expect(fs.mkdir('/a')).rejects.toMatchObject({ code: 'EEXIST' });
      await fs.mkdir('/a', { recursive: true });
      await fs.writeFile('/a/b/c', 'data');
      await expect(fs.remove('/a')).rejects.toMatchObject({ code: 'ENOTEMPTY' });
      await fs.remove('/a', { recursive: true });
      expect(await fs.list('/')).toEqual([]);
      await expect(fs.stat('/a/b/c')).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });
}
it('normalizes absolute paths without escaping the root', () => {
  expect(normalizePath('//a/../b/.//')).toBe('/b');
  for (const path of ['', 'relative', '/../a', '/a/../../b', '/bad\0name', '/a\\b']) {
    expect(() => normalizePath(path)).toThrow();
  }
});
it('persists across connections and serializes simultaneous exclusive writes', async () => {
  const indexedDB = new IDBFactory();
  const first = new IndexedDBFileSystem({ indexedDB, databaseName: 'shared' });
  const second = new IndexedDBFileSystem({ indexedDB, databaseName: 'shared' });
  await first.writeFile('/persisted', 'survives');
  await first.close();
  expect(new TextDecoder().decode(await second.readFile('/persisted'))).toBe('survives');
  const results = await Promise.allSettled([
    first.writeFile('/race', 'a', { exclusive: true }),
    second.writeFile('/race', 'b', { exclusive: true }),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect((await second.list('/')).map(entry => entry.path)).toEqual(['/persisted', '/race']);
  await first.close();
  await second.close();
});
