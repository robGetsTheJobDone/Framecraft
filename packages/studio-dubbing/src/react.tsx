import { useEffect, useId, useState, type CSSProperties } from 'react';
import type { StudioProject } from '@deepbench/studio-project';
import { DubbingWizard, type DubProjectStore, type GeneratedSpeech } from './index.js';

export interface DubbingWizardPanelProps {
  /** Keep this instance stable for the lifetime of the conversation. */
  wizard: DubbingWizard;
  store: DubProjectStore;
  project: StudioProject;
  onApplied?: (project: StudioProject) => void;
}
const field: CSSProperties = { display: 'grid', gap: 6, marginBottom: 12 };
const input: CSSProperties = { font: 'inherit', padding: '8px 10px', border: '1px solid #9ca3af', borderRadius: 6, maxWidth: '100%', boxSizing: 'border-box' };
const section: CSSProperties = { border: '1px solid #d1d5db', borderRadius: 10, padding: 16, margin: '0 0 16px' };
const button: CSSProperties = { font: 'inherit', padding: '9px 14px', borderRadius: 6, border: '1px solid #9ca3af', cursor: 'pointer' };

function SpeechPreview({ audio, index }: { audio: GeneratedSpeech; index: number }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const value = URL.createObjectURL(audio.blob); setUrl(value);
    return () => { URL.revokeObjectURL(value); };
  }, [audio.blob]);
  return <div style={{ margin: '12px 0' }}>
    <p>Segment {index + 1}: {audio.durationSeconds.toFixed(2)}s generated, {audio.clipDurationSeconds.toFixed(2)}s on timeline</p>
    <audio aria-label={`Preview speech segment ${index + 1}`} controls src={url} style={{ maxWidth: '100%' }} />
  </div>;
}

/** Composable browser wizard; no network credentials, provider implementation, or app shell required. */
export function DubbingWizardPanel({ wizard, store, project, onApplied }: DubbingWizardPanelProps) {
  const id = useId();
  const [state, setState] = useState(() => wizard.state);
  const [segments, setSegments] = useState(() => wizard.state.segments);
  const [brief, setBrief] = useState('');
  const [language, setLanguage] = useState(() => wizard.state.language);
  const [voice, setVoice] = useState('');
  const [sourceAudio, setSourceAudio] = useState<'preserve' | 'mute'>('preserve');
  const [overflow, setOverflow] = useState<'reject' | 'trim'>('reject');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [audio, setAudio] = useState<GeneratedSpeech[]>(() => wizard.getGeneratedAudio());
  const refresh = () => {
    const next = wizard.state; setState(next); setSegments(next.segments);
    setAudio(wizard.getGeneratedAudio()); setDirty(false);
  };
  useEffect(() => { refresh(); setLanguage(wizard.state.language); setError(undefined); }, [wizard]);
  const run = async (action: () => unknown | Promise<unknown>) => {
    setError(undefined);
    try { const pending = action(); refresh(); await pending; refresh(); }
    catch (cause) { setState(wizard.state); setAudio(wizard.getGeneratedAudio()); if (!(cause instanceof Error && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const busy = ['drafting', 'synthesizing', 'applying'].includes(state.stage);
  const editable = ['source', 'editing', 'approved', 'ready'].includes(state.stage);
  const sources = project.tracks.flatMap(track => track.clips.filter(clip => clip.kind === 'video').map(clip => ({ clip, track })));
  return <section aria-labelledby={`${id}-title`} style={{ fontFamily: 'system-ui, sans-serif', color: '#111827', maxWidth: 760, padding: 20, background: '#fff' }}>
    <h2 id={`${id}-title`}>Dub your video</h2>
    <p>Draft a timed script, review the words, and create a voiceover for your timeline.</p>
    <p role="status" aria-live="polite">Stage: {state.stage}{dirty ? ' — script has unsaved edits' : ''}</p>
    {(error || state.error) && <p role="alert" style={{ color: '#b91c1c' }}>{error ?? state.error}</p>}
    <fieldset style={section} disabled={busy}>
      <legend>1. Choose a video</legend>
      <label style={field}>Source video
        <select aria-label="Source video" style={input} value={state.source?.clipId ?? ''} onChange={event => { const clipId = event.target.value; if (clipId) void run(() => wizard.selectSource(project, clipId)); }}>
          <option value="" disabled>Select a timeline video</option>
          {sources.map(({ clip, track }) => <option key={clip.id} value={clip.id}>{project.assets.find(asset => asset.id === ('assetId' in clip ? clip.assetId : ''))?.name ?? clip.id} · {track.name} · {clip.durationSeconds}s</option>)}
        </select>
      </label>
      {!sources.length && <p>Add a video to the project timeline to begin.</p>}
      {state.source && <p>Selected timeline window: {state.source.startSeconds}s–{state.source.startSeconds + state.source.durationSeconds}s. Script times use the project timeline.</p>}
    </fieldset>
    <fieldset style={section} disabled={busy || !editable}>
      <legend>2. Draft your script</legend>
      <label style={field}>What should the voiceover say?
        <textarea aria-label="Voiceover brief" style={input} rows={3} value={brief} onChange={event => setBrief(event.target.value)} placeholder="Introduce the product, explain the key benefit, and finish with an invitation." />
      </label>
      <label style={field}>Language
        <input style={input} value={language} onChange={event => setLanguage(event.target.value)} placeholder="en" />
      </label>
      <button type="button" style={button} disabled={!brief.trim() || !language.trim()} onClick={() => void run(() => wizard.draft(brief, { language }))}>{state.segments.length ? 'Redraft script' : 'Draft script'}</button>
    </fieldset>
    {segments.length > 0 && <fieldset style={section} disabled={busy || state.stage === 'applied'}>
      <legend>3. Edit and approve</legend>
      {segments.map((segment, index) => <div key={segment.id} style={{ borderBottom: '1px solid #e5e7eb', padding: '12px 0' }}>
        <label style={field}>Segment {index + 1} script
          <textarea aria-label={`Segment ${index + 1} script`} style={input} rows={3} value={segment.text} onChange={event => { setSegments(previous => previous.map((item, i) => i === index ? { ...item, text: event.target.value } : item)); setDirty(true); }} />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <label style={field}>Segment {index + 1} start (seconds)
            <input aria-label={`Segment ${index + 1} start (seconds)`} type="number" min={state.source?.startSeconds ?? 0} step="0.1" style={input} value={Number.isNaN(segment.startSeconds) ? '' : segment.startSeconds} onChange={event => { const value = event.target.valueAsNumber; setSegments(previous => previous.map((item, i) => i === index ? { ...item, startSeconds: value } : item)); setDirty(true); }} />
          </label>
          <label style={field}>Segment {index + 1} duration (seconds)
            <input aria-label={`Segment ${index + 1} duration (seconds)`} type="number" min="0.1" step="0.1" style={input} value={Number.isNaN(segment.durationSeconds) ? '' : segment.durationSeconds} onChange={event => { const value = event.target.valueAsNumber; setSegments(previous => previous.map((item, i) => i === index ? { ...item, durationSeconds: value } : item)); setDirty(true); }} />
          </label>
        </div>
      </div>)}
      <button type="button" style={{ ...button, marginTop: 12 }} disabled={!dirty && state.stage !== 'editing'} onClick={() => void run(() => { wizard.editSegments(segments); wizard.approve(); })}>Approve script</button>
    </fieldset>}
    <fieldset style={section} disabled={busy || state.stage !== 'approved' || dirty}>
      <legend>4. Generate speech</legend>
      <label style={field}>Voice (optional provider voice ID)
        <input style={input} value={voice} onChange={event => setVoice(event.target.value)} />
      </label>
      <label style={field}>If speech is longer than its segment
        <select style={input} value={overflow} onChange={event => setOverflow(event.target.value as 'reject' | 'trim')}>
          <option value="reject">Ask me to shorten the script</option>
          <option value="trim">Trim the end of the speech</option>
        </select>
      </label>
      <button type="button" style={button} onClick={() => void run(() => wizard.synthesize({ voice: voice.trim() || undefined, overflow }))}>Generate speech</button>
    </fieldset>
    {audio.length > 0 && <section aria-label="Generated speech previews" style={section}>
      <h3>Listen to your voiceover</h3>
      {audio.map((item, index) => <SpeechPreview key={item.segmentId} audio={item} index={index} />)}
    </section>}
    <fieldset style={section} disabled={busy || state.stage !== 'ready' || dirty}>
      <legend>5. Add to timeline</legend>
      <label style={field}>Original video audio
        <select aria-label="Original video audio" style={input} value={sourceAudio} onChange={event => setSourceAudio(event.target.value as 'preserve' | 'mute')}>
          <option value="preserve">Keep original audio</option>
          <option value="mute">Mute original audio</option>
        </select>
      </label>
      <button type="button" style={button} onClick={() => void run(async () => { const updated = await wizard.apply(store, { sourceAudio }); onApplied?.(updated); })}>Add voiceover to timeline</button>
    </fieldset>
    {['drafting', 'synthesizing'].includes(state.stage) && <button type="button" style={button} onClick={() => void run(() => wizard.cancel())}>Cancel generation</button>}
    {state.stage === 'applied' && <><p role="status">Voiceover saved to your project.</p><button type="button" style={button} onClick={() => void run(async () => wizard.selectSource(await store.load(), state.source!.clipId))}>Start another dub</button></>}
  </section>;
}
