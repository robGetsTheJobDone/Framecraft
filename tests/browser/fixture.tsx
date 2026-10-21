import { createRoot } from 'react-dom/client';
import { AIMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { IndexedDBFileSystem } from '../../packages/browser-filesystem/dist/index.js';
import { createBrowserAgent } from '../../packages/browser-deepagents/dist/index.js';
import { BrowserRemotionPlayer, exportComposition, titleCardComposition } from '../../packages/browser-remotion/dist/index.js';

// A deterministic model exercises the real agent/tool loop without credentials.
class CompositionModel extends BaseChatModel {
  calls = 0;
  constructor() { super({}); }
  _llmType() { return 'offline-browser-smoke'; }
  bindTools() { return this; }
  async _generate() {
    const message = this.calls++ === 0
      ? new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: {
          file_path: '/video/props.json',
          content: JSON.stringify({ title: 'Browser agent video', background: '#152033' }),
        }, id: 'write-composition', type: 'tool_call' }] })
      : new AIMessage('Composition ready');
    return { generations: [{ text: typeof message.content === 'string' ? message.content : '', message }] };
  }
}

async function run() {
  const filesystem = new IndexedDBFileSystem({ databaseName: 'deepbench-browser-smoke' });
  let persisted = false;
  try { persisted = (await filesystem.stat('/video/output.webm')).size > 0; }
  catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
  const agent = createBrowserAgent({ filesystem, model: new CompositionModel(), name: 'browser-smoke' });
  const result = await agent.invoke({ messages: [{ role: 'user', content: 'Create video props.' }] });
  const inputProps = JSON.parse(new TextDecoder().decode(await filesystem.readFile('/video/props.json')));
  const composition = { ...titleCardComposition, inputProps, width: 320, height: 180, durationInFrames: 3 };
  createRoot(document.getElementById('root')!).render(<BrowserRemotionPlayer composition={composition} />);
  const blob = await exportComposition(composition, { format: 'webm' });
  await filesystem.writeFile('/video/output.webm', new Uint8Array(await blob.arrayBuffer()));
  await filesystem.close();
  const reopened = new IndexedDBFileSystem({ databaseName: 'deepbench-browser-smoke' });
  const saved = await reopened.readFile('/video/output.webm');
  await reopened.close();
  return { persisted, bytes: saved.byteLength, header: [...saved.slice(0, 4)], type: blob.type, lastMessage: result.messages.at(-1)?.content, title: inputProps.title };
}

run().then(
  result => { Object.assign(window, { smokeResult: result }); },
  error => { Object.assign(window, { smokeError: error instanceof Error ? error.stack : String(error) }); },
);
