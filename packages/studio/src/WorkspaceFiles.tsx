import {useEffect, useRef, useState, type ReactNode} from 'react';
import type {FileStat} from '@deepbench/browser-filesystem';
import type {StudioSession, StudioProject} from '@deepbench/browser-studio';
import {assertValidProject} from '@deepbench/studio-project';
import {MonacoFileEditor} from './MonacoFileEditor.js';

export type FileChange = {path: string; kind: 'added' | 'modified' | 'deleted'; time: number};
export function useWorkspace(session: StudioSession | undefined, onProject: (project: StudioProject) => void, watching = false, active = false) {
  const [files, setFiles] = useState<FileStat[]>([]);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const callback = useRef(onProject); callback.current = onProject;
  const previous = useRef<Map<string, FileStat> | undefined>(undefined);
  const owner = useRef(session);
  const wasWatching = useRef(watching);
  useEffect(() => {
    if (watching && !wasWatching.current) previous.current = undefined;
    wasWatching.current = watching;
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
        if (watching && updates.length) setChanges(old => [...updates, ...old].slice(0, 100));
        // Project validation prevents a partial or invalid agent edit from breaking the preview.
        const project = await session.store.load();
        if (!stopped) {callback.current(project); setError('');}
      } catch (error) {if (!stopped) setError(error instanceof Error ? error.message : String(error));}
      finally {if (!stopped && watching) timer = setTimeout(poll, 2500);}
    };
    void poll();
    return () => {stopped = true; clearTimeout(timer);};
  }, [session, tick, watching, active]);
  return {files, changes, error, refresh: () => setTick(t => t + 1), clearChanges: () => setChanges([])};
}

type Props = {session: StudioSession; files: FileStat[]; busy: boolean; target?: string; refresh(): void; onDirtyChange(dirty: boolean): void};
export function WorkspaceFiles({session, files, busy, target, refresh, onDirtyChange}: Props) {
  const [path, setPath] = useState(target ?? (files.some(file => file.path === '/Ad.tsx') ? '/Ad.tsx' : '/brief.md'));
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
        const editable = !['/revisions/','/runs/','/skills/','/context/'].some(prefix=>path.startsWith(prefix)) && !['/chat.json','/history.json'].includes(path);
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
    if (!dirty || !loaded?.editable || busy || saving) return;
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
    <div className="panel-heading"><div><h2>Conversation files</h2><p className="muted">{files.length} files · Saved in this browser</p></div><button onClick={refresh}>Refresh files</button></div>
    <div className="file-layout"><FileTree files={files} selected={path} onSelect={choose} /><div className="file-editor"><h3>{path}{dirty ? ' • Unsaved' : ''}</h3>
      {error && <p role="alert">{error}</p>}
      {dirty && loadedSignature !== signature && <p role="status">This file changed on disk. Your draft is preserved; save will check for conflicts.</p>}
      {loaded?.path === path && loaded.text !== undefined && <><MonacoFileEditor path={path} value={draft} readOnly={!loaded.editable || saving} onChange={setDraft} onSave={() => void save()} /><div className="file-actions"><button disabled={!dirty || !loaded.editable || busy || saving} onClick={() => void save()}>Save file</button><button disabled={!dirty || saving} onClick={discard}>Discard edits and reload</button><small>{loaded.editable ? busy ? 'Save is available after the agent finishes.' : path === '/project.json' ? 'Saving validates the timeline and creates a revision.' : 'Text files are editable. Ad.tsx updates the source studio preview.' : path.startsWith('/context/') ? 'Product context is read-only. Supply a new context version from the host to change it.' : 'Application history is read-only.'}</small></div></>}
      {loaded?.path === path && loaded.url && <><div className="file-media">{loaded.mime.startsWith('image/') ? <img src={loaded.url} alt={path} /> : loaded.mime.startsWith('audio/') ? <audio src={loaded.url} controls /> : loaded.mime.startsWith('video/') ? <video src={loaded.url} controls /> : <p>Binary file · read-only</p>}</div><a href={loaded.url} download={path.split('/').at(-1)}>Download file</a></>}
    </div></div>
  </section>;
}


type TreeNode = {name: string; path: string; file?: FileStat; children: Map<string, TreeNode>};
function FileTree({files, selected, onSelect}: {files: FileStat[]; selected: string; onSelect(path: string): void}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(files.flatMap(file => {const parts = file.path.split('/').filter(Boolean); return parts.slice(0, -1).map((_, index) => '/' + parts.slice(0, index + 1).join('/'));})));
  useEffect(() => {setCollapsed(old => new Set([...old].filter(path => !selected.startsWith(path + '/'))));}, [selected]);
  const root: TreeNode = {name: '', path: '', children: new Map()};
  for (const file of files) {
    let node = root;
    for (const name of file.path.split('/').filter(Boolean)) {
      if (!node.children.has(name)) node.children.set(name, {name, path: node.path + '/' + name, children: new Map()});
      node = node.children.get(name)!;
    }
    node.file = file;
  }
  const render = (node: TreeNode, depth: number): ReactNode => [...node.children.values()].sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name)).map(child => child.file ?
    <button key={child.path} className={selected === child.path ? 'active' : ''} aria-label={child.path} aria-current={selected === child.path ? 'page' : undefined} style={{paddingLeft: 14 + depth * 16}} onClick={() => onSelect(child.path)}><span className="file-tree-icon">◇</span><span>{child.name}</span><small>{child.file.size < 1024 ? `${child.file.size} B` : `${Math.ceil(child.file.size / 1024)} KB`}</small></button> :
    <div key={child.path}><button className="file-tree-folder" style={{paddingLeft: 14 + depth * 16}} aria-expanded={!collapsed.has(child.path)} aria-label={`Folder ${child.path}`} onClick={() => setCollapsed(old => {const next = new Set(old); if (next.has(child.path)) next.delete(child.path); else next.add(child.path); return next;})}><span className="file-tree-icon">{collapsed.has(child.path) ? '▸' : '▾'}</span>{child.name}</button>{!collapsed.has(child.path) && render(child, depth + 1)}</div>);
  return <nav aria-label="File list"><span className="file-tree-heading">EXPLORER</span>{render(root, 0)}</nav>;
}

export function WorkspaceChanges({changes, watching, onWatch, refresh, clearChanges, onOpen}: {changes: FileChange[]; watching: boolean; onWatch(value: boolean): void; refresh(): void; clearChanges(): void; onOpen(path: string): void}) {
  return <section className="workspace-changes panel" aria-label="Watch changes"><div className="panel-heading"><div><h2>Watch changes</h2><p className="muted">{watching ? 'Watching this conversation every 2.5 seconds.' : 'Watching is off. Start watching to follow agent and file edits.'}</p></div><label className="workspace-watch-toggle"><input type="checkbox" role="switch" aria-label="Watch file changes" checked={watching} onChange={event => onWatch(event.target.checked)} /> {watching ? 'Watching' : 'Watch changes'}</label></div><div className="change-actions"><button onClick={refresh}>Refresh files</button><button onClick={clearChanges}>Clear change history</button></div><nav aria-label="File changes">{!changes.length && <p className="muted">No changes recorded. Changes appear here while watching is on.</p>}{changes.map((change, i) => <button key={`${change.time}-${change.path}-${i}`} disabled={change.kind === 'deleted'} onClick={() => onOpen(change.path)}><strong>{change.kind}</strong><span>{change.path}</span><small>{new Date(change.time).toLocaleTimeString()}</small></button>)}</nav></section>;
}
