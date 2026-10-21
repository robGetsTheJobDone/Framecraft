import {createRoot} from 'react-dom/client';
import {useEffect, useState} from 'react';
import {IndexedDBFileSystem} from '../../packages/browser-filesystem/dist/index.js';
import {openStudioSession} from '../../packages/browser-studio/dist/index.js';
import {DubbingWizardPanel} from '../../packages/studio-dubbing/dist/react.js';
import {encodeWav, decodeMediaAudio, getAudioPeak} from '../../packages/studio-audio/dist/index.js';
import {BrowserRemotionPlayer, exportComposition, titleCardComposition} from '../../packages/browser-remotion/dist/index.js';

function tone(seconds: number, frequency: number) {
  const sampleRate = 48_000;
  const samples = Float32Array.from({length: Math.round(seconds * sampleRate)}, (_, i) => Math.sin(i * 2 * Math.PI * frequency / sampleRate) * 0.2);
  return encodeWav({numberOfChannels: 1, length: samples.length, sampleRate, getChannelData: () => samples});
}

async function setup() {
  const filesystem = new IndexedDBFileSystem({databaseName: 'deepbench-studio-integration'});
  const session = await openStudioSession({filesystem, conversationId: 'dub-demo', seed: {title: 'Studio integration', width: 320, height: 180, fps: 10, durationSeconds: 1}});
  let project = await session.store.load();
  if (!project.assets.length) {
    const source = await exportComposition({...titleCardComposition, width: 320, height: 180, fps: 10, durationInFrames: 10}, {format: 'webm'});
    await session.importAsset({id: 'source', name: 'Source video', kind: 'video', mimeType: 'video/webm', durationSeconds: 1}, source);
    await session.importAsset({id: 'music', name: 'Music', kind: 'audio', mimeType: 'audio/wav', durationSeconds: 1}, tone(1, 220));
    project = await session.store.update(current => {
      current.tracks[0].clips.push({id: 'source-clip', kind: 'video', assetId: 'source', startSeconds: 0, durationSeconds: 1, sourceStartSeconds: 0, muted: true});
      current.tracks.find(track => track.id === 'music')!.clips.push({id: 'music-clip', kind: 'audio', assetId: 'music', startSeconds: 0, durationSeconds: 1, sourceStartSeconds: 0, gain: 0.4, fadeInSeconds: 0.1, fadeOutSeconds: 0.1});
    });
  }
  const other = await openStudioSession({filesystem, conversationId: 'other-conversation'});
  const wizard = session.createDubbingWizard({
    scriptProvider: {draft: async () => [{id: 'line-1', text: 'An AI-written draft for review.', startSeconds: 0.1, durationSeconds: 0.7}]},
    // Deterministic tone stands in for a speech provider; real audio mixing/export is exercised.
    speechProvider: {synthesize: async () => ({blob: tone(0.5, 440), durationSeconds: 0.5})},
  });
  function App() {
    const [current, setCurrent] = useState(project);
    const [preview, setPreview] = useState<Awaited<ReturnType<typeof session.preparePreview>>>();
    const [status, setStatus] = useState('');
    useEffect(() => () => preview?.dispose(), [preview]);
    const run = async (action: () => Promise<void>) => {
      try { await action(); } catch (error) { Object.assign(window, {studioError: error instanceof Error ? error.stack : String(error)}); setStatus(String(error)); }
    };
    return <main>
      <DubbingWizardPanel wizard={wizard} project={current} store={session.store} onApplied={setCurrent} />
      <button onClick={() => void run(async () => { setPreview(await session.preparePreview()); setStatus('Preview ready'); })}>Preview studio</button>
      <button onClick={() => void run(async () => {
        setStatus('Exporting');
        const exported = await session.exportVideo({format: 'webm'});
        const decoded = await decodeMediaAudio(exported.blob);
        const saved = await session.store.load();
        Object.assign(window, {studioResult: {bytes: exported.blob.size, path: exported.path, audioPeak: getAudioPeak(decoded), audioDuration: decoded.duration, script: saved.dubbingScripts[0]?.segments[0]?.text, scripts: saved.dubbingScripts.length, otherAssets: (await other.store.load()).assets.length, revisions: (await session.store.listRevisions()).length}});
        setStatus('Export complete');
      })}>Export studio video</button>
      <p>{status}</p>
      {preview && <BrowserRemotionPlayer composition={preview.composition} style={{width: 320}} />}
    </main>;
  }
  createRoot(document.getElementById('root')!).render(<App />);
  Object.assign(window, {studioReady: {savedScripts: project.dubbingScripts.length}});
}
setup().catch(error => Object.assign(window, {studioError: error instanceof Error ? error.stack : String(error)}));
