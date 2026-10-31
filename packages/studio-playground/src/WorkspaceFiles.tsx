import {useEffect, useRef, useState} from 'react';
import type {FileStat} from '@deepbench/browser-filesystem';
import type {StudioSession, StudioProject} from '@deepbench/browser-studio';
import {assertValidProject} from '@deepbench/studio-project';

export type FileChange = {path: string; kind: 'added' | 'modified' | 'deleted'; time: number};
export function useWorkspace(session: StudioSession | undefined, onProject: (project: StudioProject) => void) {
  const [files, setFiles] = useState<FileStat[]>([]);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const callback = useRef(onProject); callback.current = onProject;
  const previous = useRef<Map<string, FileStat> | undefined>(undefined);
  const owner = useRef(session);
  useEffect(() => {
    if (owner.current !== session) {owner.current = session; previous.current = undefined; setFiles([]); setChanges([]); setError('');}
    if (!session) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const entries = (await session.filesystem.list('/', {recursive: true})).filter(f => f.type === 'file');
        if (stopped) return;
        const next = new Map(entries.map(f => [f.path, f]));
        const updates: FileChange[] = [];
        if (previous.current) {
          for (const file of entries) {
            const old = previous.current.get(file.path);
            if (!old || old.modifiedAt !== file.modifiedAt || old.size !== file.size) updates.push({path: file.path, kind: old ? 'modified' : 'added', time: Date.now()});
          }
          for (const path of previous.current.keys()) if (!next.has(path)) updates.push({path, kind: 'deleted', time: Date.now()});
        }
        previous.current = next;
        setFiles(old => JSON.stringify(old) === JSON.stringify(entries) ? old : entries);
        if (updates.length) setChanges(old => [...updates, ...old].slice(0, 100));
        // Project validation prevents a partial or invalid agent edit from breaking the preview.
        const project = await session.store.load();
        if (!stopped) {callback.current(project); setError('');}
      } catch (error) {if (!stopped) setError(error instanceof Error ? error.message : String(error));}
      finally {if (!stopped) timer = setTimeout(poll, 2500);}
    };
    void poll();
    return () => {stopped = true; clearTimeout(timer);};
  }, [session, tick]);
  return {files, changes, error, refresh: () => setTick(t => t + 1), clearChanges: () => setChanges([])};
}

type Props = {session: StudioSession; files: FileStat[]; changes: FileChange[]; busy: boolean; target?: string; showChanges: boolean; refresh(): void; clearChanges(): void; onClose(): void; onDirtyChange(dirty: boolean): void};
export function WorkspaceFiles({session, files, changes, busy, target, showChanges, refresh, clearChanges, onClose, onDirtyChange}: Props) {
  const [path, setPath] = useState(target ?? '/brief.md');
  const [view, setView] = useState<'files' | 'changes'>(showChanges ? 'changes' : 'files');
  const [loaded, setLoaded] = useState<{path: string; text?: string; url?: string; mime: string; editable: boolean}>();
  const [draft, setDraft] = useState('');
  const [original, setOriginal] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const dirty = draft !== original;
  useEffect(() => {onDirtyChange(dirty); return () => onDirtyChange(false);}, [dirty, onDirtyChange]);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const currentStat = files.find(f => f.path === path);
  const signature = currentStat ? `${currentStat.modifiedAt}:${currentStat.size}` : 'missing';
  const [loadedSignature, setLoadedSignature] = useState('');
  useEffect(() => {if (!target) return; if (dirtyRef.current) setError('Save or discard your edits before opening another file.'); else setPath(target);}, [target]);
  useEffect(() => {setView(showChanges ? 'changes' : 'files');}, [showChanges]);
  useEffect(() => {
    if (dirtyRef.current) return;
    let stopped = false; let url: string | undefined;
    setLoaded(undefined); setError('');
    void (async () => {
      const stat = await session.filesystem.stat(path);
      const project = await session.store.load().catch(() => undefined);
      const asset = project?.assets.find(a => `/${a.path}` === path);
      const mime = asset?.mimeType ?? (path.endsWith('.wav') ? 'audio/wav' : path.endsWith('.webm') ? 'video/webm' : path.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream');
      const isText = !path.startsWith('/assets/') && !path.startsWith('/exports/') && /\.(md|txt|json|tsx?|jsx?|css|html|csv|ya?ml)$/.test(path);
      if (isText && stat.size > 1024 * 1024) throw new Error('Text preview is limited to 1 MB.');
      const bytes = await session.filesystem.readFile(path);
      if (stopped) return;
      if (isText) {
        const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
        const editable = !path.startsWith('/revisions/') && path !== '/chat.json';
        setOriginal(text); setDraft(text); setLoaded({path, text, mime, editable});
      } else {
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: mime}));
        setOriginal(''); setDraft(''); setLoaded({path, url, mime, editable: false});
      }
      setLoadedSignature(signature);
    })().catch(error => {if (!stopped) setError(String(error));});
    return () => {stopped = true; if (url) URL.revokeObjectURL(url);};
  }, [session, path, signature, reload]);
  const choose = (next: string) => {if (dirty) {setError('Save or discard your edits before opening another file.'); return;} setPath(next);};
  const discard = () => {dirtyRef.current = false; setDraft(original); setReload(n => n + 1);};
  const save = async () => {
    if (!loaded?.editable || busy || saving) return;
    setSaving(true); setError('');
    try {
      if (path === '/project.json') {
        const project: unknown = JSON.parse(draft); assertValidProject(project);
        await session.store.save(project, {expectedProjectJson: JSON.stringify(JSON.parse(original))});
      } else await session.filesystem.writeFile(path, draft, {expectedContent: original});
      setOriginal(draft); dirtyRef.current = false; refresh(); setReload(n => n + 1);
    } catch (error) {setError(error instanceof Error ? error.message : String(error));}
    finally {setSaving(false);}
  };
  return <section className="file-workspace panel" aria-label="Conversation files">
    <div className="panel-heading"><h2>Conversation files</h2><div><button aria-pressed={view === 'files'} className={view === 'files' ? 'active' : ''} onClick={() => setView('files')}>Files ({files.length})</button><button aria-pressed={view === 'changes'} className={view === 'changes' ? 'active' : ''} onClick={() => setView('changes')}>Changes ({changes.length})</button><button onClick={refresh}>Refresh files</button><button disabled={saving} onClick={() => {if (dirty) setError('Save or discard your edits before closing.'); else onClose();}}>Close files</button></div></div>
    <p className="muted">Watching every 2.5 seconds · This conversation only · /files, /changes, /open /brief.md</p>
    <div className="file-layout"><nav aria-label={view === 'files' ? 'File list' : 'File changes'}>
      {view === 'files' ? files.map(file => <button key={file.path} className={path === file.path ? 'active' : ''} aria-current={path === file.path ? 'true' : undefined} onClick={() => choose(file.path)}>{file.path}<small>{file.size.toLocaleString()} bytes</small></button>) : <><button onClick={clearChanges}>Clear change history</button>{!changes.length && <p>No changes since watching started.</p>}{changes.map((change, i) => <button key={`${change.time}-${change.path}-${i}`} onClick={() => choose(change.path)}><strong>{change.kind}</strong> {change.path}<small>{new Date(change.time).toLocaleTimeString()}</small></button>)}</>}
    </nav><div className="file-editor"><h3>{path}{dirty ? ' • Unsaved' : ''}</h3>
      {error && <p role="alert">{error}</p>}
      {dirty && loadedSignature !== signature && <p role="status">This file changed on disk. Your draft is preserved; save will check for conflicts.</p>}
      {loaded?.path === path && loaded.text !== undefined && <><textarea aria-label="File contents" spellCheck={false} value={draft} readOnly={!loaded.editable} onChange={event => setDraft(event.target.value)} /><div className="file-actions"><button disabled={!dirty || !loaded.editable || busy || saving} onClick={() => void save()}>Save file</button><button disabled={!dirty || saving} onClick={discard}>Discard edits and reload</button><small>{loaded.editable ? busy ? 'Save is available after the agent finishes.' : path === '/project.json' ? 'Saving validates the timeline and creates a revision.' : 'Text files are editable; code is displayed, not executed.' : 'Application history is read-only.'}</small></div></>}
      {loaded?.path === path && loaded.url && <><div className="file-media">{loaded.mime.startsWith('image/') ? <img src={loaded.url} alt={path} /> : loaded.mime.startsWith('audio/') ? <audio src={loaded.url} controls /> : loaded.mime.startsWith('video/') ? <video src={loaded.url} controls /> : <p>Binary file · read-only</p>}</div><a href={loaded.url} download={path.split('/').at(-1)}>Download file</a></>}
    </div></div>
  </section>;
}
