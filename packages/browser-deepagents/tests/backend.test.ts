import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '@deepbench/browser-filesystem';
import { AIMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { BrowserBackend, createBrowserAgent } from '../src/index.js';

class WritingModel extends BaseChatModel {
  calls = 0;
  constructor() { super({}); }
  _llmType() { return 'offline-writing-model'; }
  bindTools() { return this; }
  async _generate() {
    const message = this.calls++ === 0
      ? new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { file_path: '/agent/output.txt', content: 'Created by the agent' }, id: 'write-1', type: 'tool_call' }] })
      : new AIMessage('Done');
    return { generations: [{ text: typeof message.content === 'string' ? message.content : '', message }] };
  }
}

describe('BrowserBackend', () => {
  it('persists nested writes, overwrites, paginates and provides raw metadata', async () => {
    const fs = new MemoryFileSystem();
    const backend = new BrowserBackend(fs);
    expect(await backend.write('/nested/note.md', 'first\nsecond\nthird')).toEqual({ path: '/nested/note.md' });
    expect(await backend.read('/nested/note.md', 1, 1)).toMatchObject({ content: 'second', startLine: 2, endLine: 2, nextOffset: 2, totalLines: 3 });
    expect(await backend.ls('/')).toMatchObject({ files: [{ path: '/nested/', is_dir: true }] });
    expect(await backend.readRaw('/nested/note.md')).toMatchObject({ data: { content: 'first\nsecond\nthird', mimeType: 'text/markdown' } });
    await backend.write('/nested/note.md', 'replaced');
    expect(new TextDecoder().decode(await fs.readFile('/nested/note.md'))).toBe('replaced');
  });

  it('rejects ambiguous edits and replaces literal dollar sequences without interpolation', async () => {
    const backend = new BrowserBackend(new MemoryFileSystem());
    await backend.write('/note', 'abc abc');
    expect(await backend.edit('/note', 'abc', 'new')).toHaveProperty('error');
    expect(await backend.edit('/note', '', 'new')).toHaveProperty('error');
    expect(await backend.edit('/note', 'absent', 'new')).toHaveProperty('error');
    expect(await backend.edit('/note', 'abc', '$&', true)).toMatchObject({ occurrences: 2 });
    expect(await backend.read('/note')).toMatchObject({ content: '$& $&' });
  });

  it('supports recursive globs, literal search, per-file filters and match caps', async () => {
    const backend = new BrowserBackend(new MemoryFileSystem());
    await backend.write('/src/a.ts', 'a.b\na.b');
    await backend.write('/src/deep/b.ts', 'axb\na.b');
    await backend.write('/src/readme.md', 'a.b');
    expect((await backend.glob('**/*.ts', '/src')).files?.map((f) => f.path)).toEqual(['/src/a.ts', '/src/deep/b.ts']);
    expect(await backend.grep('a.b', '/src', '*.ts', 2)).toEqual({ matches: [
      { path: '/src/a.ts', line: 1, text: 'a.b' }, { path: '/src/a.ts', line: 2, text: 'a.b' },
    ], truncated: true });
    expect((await backend.grep('a.b', '/src/deep/b.ts')).matches).toEqual([{ path: '/src/deep/b.ts', line: 2, text: 'a.b' }]);
    expect((await backend.grep('a.b', '/src/deep/b.ts', '/src/**/*.ts')).matches).toHaveLength(1);
    expect((await backend.grep('a.b', '/src/deep/b.ts', '/other/**')).matches).toEqual([]);
  });

  it('preserves binary assets, handles batch errors, rejects invalid paths and deletes recursively', async () => {
    const backend = new BrowserBackend(new MemoryFileSystem());
    const bytes = new Uint8Array([0, 255, 1, 2]);
    expect(await backend.uploadFiles([['/assets/x.png', bytes]])).toEqual([{ path: '/assets/x.png', error: null }]);
    expect(await backend.read('/assets/x.png')).toMatchObject({ content: bytes, mimeType: 'image/png' });
    expect(await backend.edit('/assets/x.png', 'a', 'b')).toHaveProperty('error');
    expect(await backend.grep('', '/assets')).toEqual({ matches: [] });
    expect(await backend.downloadFiles(['/assets/x.png', '/missing', '/assets'])).toEqual([
      { path: '/assets/x.png', content: bytes, error: null },
      { path: '/missing', content: null, error: 'file_not_found' },
      { path: '/assets', content: null, error: 'is_directory' },
    ]);
    expect(await backend.write('/../../escape', 'no')).toHaveProperty('error');
    expect(await backend.read('/assets/x.png', -1)).toHaveProperty('error');
    expect(await backend.delete('/')).toHaveProperty('error');
    expect(await backend.delete('/assets')).toEqual({ path: '/assets' });
    expect(await backend.read('/assets/x.png')).toHaveProperty('error');
  });
});

it('runs a real Deep Agents graph and writes through its built-in tool without network calls', async () => {
  const filesystem = new MemoryFileSystem();
  const agent = createBrowserAgent({ filesystem, model: new WritingModel(), name: 'browser-test' });
  const result = await agent.invoke({ messages: [{ role: 'user', content: 'Write an output file.' }] });
  expect(new TextDecoder().decode(await filesystem.readFile('/agent/output.txt'))).toBe('Created by the agent');
  expect(result.messages.at(-1)?.content).toBe('Done');
});
