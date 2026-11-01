import {ChatAttachments,readFeedbackFiles} from './ChatAttachments.js';
import {useEffect, useMemo, useRef, useState, type FormEvent} from 'react';
import {type AdSession, type StudioSession, type FeedbackAttachment} from '@deepbench/browser-studio';
import {BrowserRemotionPlayer, exportComposition, titleCardComposition} from '@deepbench/browser-remotion';
import {decodeMediaAudio} from '@deepbench/studio-audio';
import {DubbingWizardPanel} from '@deepbench/studio-dubbing/react';
import type {StudioAsset, StudioClip, StudioProject} from '@deepbench/studio-project';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {DubbingWizardOptions} from '@deepbench/studio-dubbing';
import type {ReactNode} from 'react';
import {ComponentLibrary} from './ComponentLibrary.js';
import {SceneEditor, type SceneTimelineParts} from './SceneEditor.js';
import {VoiceoverRecorder} from './VoiceoverRecorder.js';
import {useTheme} from './theme.js';
import {tone} from './tone.js';
import {streamAgent, type AgentProgress} from './agent-progress.js';
import {WorkspaceFiles, WorkspaceChanges, useWorkspace} from './WorkspaceFiles.js';

type Chat = {role: 'user' | 'assistant'; content: string};
export interface StudioViewProps {
  projectId: string;
  loadSession(id: string): Promise<StudioSession>;
  providers: {model: BaseChatModel; dubbing: DubbingWizardOptions};
  conversations?: Array<{id: string; name: string}>;
  onSelectProject?(id: string): void;
  onNewProject?(): void;
  connectionLabel?: string;
  demo?: boolean;
  imageGeneration?: boolean;
  onSettings?(): void;
  settings?: ReactNode;
  renderPreview?: ReactNode;
  send?(prompt: string, signal: AbortSignal, options: {review: boolean; libraryPublish?: boolean; attachments?:FeedbackAttachment[]}): Promise<string>;
  exportVideo?(options: {format: 'mp4' | 'webm'; signal: AbortSignal; onProgress(progress: number): void}): Promise<Blob>;
  onExport?(result: {blob: Blob; format: string; mediaType: string}): void | Promise<void>;
  downloadSessionZip?(): Promise<Blob>;
  importSessionZip?(file:File): Promise<void>;
  projectRevision?: number;
  sceneSession?: AdSession;
  activity?: string;
  progress?: AgentProgress[];
}

function SampleFilm() {
  return <div style={{width: '100%', height: '100%', backgroundColor: '#334b40', color: '#f1ecdf', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', textAlign: 'center', padding: 32}}>
    <div style={{fontSize: 11, letterSpacing: 4, color: '#b1c7b9', marginBottom: 24}}>DEEPBENCH STUDIO</div>
    <div style={{fontSize: 44, lineHeight: 1.15, fontWeight: 600}}>A small idea.<br />A bigger story.</div>
    <div style={{fontSize: 14, color: '#c5d3c5', marginTop: 24}}>Made in your browser.</div>
  </div>;
}

export function StudioView(props: StudioViewProps) {
  const [theme, toggleTheme] = useTheme();
  const conversations = props.conversations ?? [{id: props.projectId, name: props.projectId}];
  const conversationId = props.projectId;
  const connection = !props.demo;
  const zipInput=useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<StudioSession>();
  const [project, setProject] = useState<StudioProject>();
  useEffect(()=>{let stopped=false;if(session)void session.store.load().then(project=>{if(!stopped)setProject(project);}).catch(error=>{if(!stopped)setError(String(error));});return()=>{stopped=true;};},[session,props.projectRevision]);
  const [filesDirty, setFilesDirty] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [fileTarget, setFileTarget] = useState<string>();
  const [showChanges, setShowChanges] = useState(false);
  const [watchingFiles, setWatchingFiles] = useState(false);
  const workspace = useWorkspace(session, next => setProject(old => JSON.stringify(old) === JSON.stringify(next) ? old : next), watchingFiles, filesOpen);
  const [chat, setChat] = useState<Chat[]>([]);
  const [liveProgress,setLiveProgress] = useState<AgentProgress[]>([]);
  const progressEnd=useRef<HTMLDivElement>(null);
  const progressEntries=props.progress??liveProgress;
  useEffect(()=>{const history=progressEnd.current?.closest('.chat-history');if(history)history.scrollTop=history.scrollHeight;},[progressEntries]);
  const updateProgress=(entry:AgentProgress)=>setLiveProgress(entries=>{const index=entries.findIndex(item=>item.id===entry.id);return index<0?[...entries,entry].slice(-100):entries.map((item,i)=>i===index?entry:item);});
  const [reviewEnabled, setReviewEnabled] = useState(true);
  const [libraryPublish,setLibraryPublish]=useState(false);
  const [prompt, setPrompt] = useState('');
  const [attachments,setAttachments]=useState<FeedbackAttachment[]>([]);
  const [attachmentLoading,setAttachmentLoading]=useState(false);
  const [attachmentError,setAttachmentError]=useState('');
  const feedbackLock=useRef(false);
  const feedbackEpoch=useRef(0);
  const attachFiles=async(files:File[])=>{if(!props.send||busy||feedbackLock.current||!files.length)return;feedbackLock.current=true;const epoch=feedbackEpoch.current;setAttachmentLoading(true);setAttachmentError('');try{const next=await readFeedbackFiles(files,attachments);if(epoch===feedbackEpoch.current)setAttachments(next);}catch(error){if(epoch===feedbackEpoch.current)setAttachmentError(error instanceof Error?error.message:String(error));}finally{if(epoch===feedbackEpoch.current){feedbackLock.current=false;setAttachmentLoading(false);}}};
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string>();
  const [selectedScene,setSelectedScene]=useState<string>();
  const [libraryTab,setLibraryTab]=useState<'media'|'components'>('media');
  const [modal, setModal] = useState<'dub' | 'settings' | 'voiceover' | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<StudioSession['preparePreview']>>>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [videoFormat, setVideoFormat] = useState<'mp4' | 'webm'>('mp4');
  const [exportProgress, setExportProgress] = useState<{value: number; stage: string}>();
  const [download, setDownload] = useState<{url: string; name: string}>();
  const uploadRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | undefined>(undefined);
  const operationLock = useRef(false);
  useEffect(() => () => abort.current?.abort(), []);
  const providers = props.providers;
  const wizard = useMemo(() => session?.createDubbingWizard(providers.dubbing), [session, providers]);
  const closeModal = () => {
    if (operationLock.current || wizard?.state.stage === 'applying') return;
    if (wizard && ['drafting', 'synthesizing'].includes(wizard.state.stage)) wizard.cancel();
    setModal(null);
  };
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? [])].filter(element => !element.closest('fieldset:disabled'));
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {event.preventDefault(); closeModal();}
      if (event.key === 'Tab') {
        const items = focusable(); const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {document.removeEventListener('keydown', onKey); previous?.focus();};
  }, [modal, wizard]);
  useEffect(() => {
    let stopped = false;
    feedbackEpoch.current++;feedbackLock.current=false;setAttachments([]);setAttachmentError('');setAttachmentLoading(false);setSelectedScene(undefined);setLibraryTab('media');
    setLiveProgress([]); setSession(undefined); setProject(undefined); setFilesOpen(false); setWatchingFiles(false); setFileTarget(undefined); setChat([]); setSelected(undefined); setError(''); setNotice(''); setDownload(undefined);
    void (async () => {
      const next = await props.loadSession(conversationId);
      const project = await next.store.load();
      let history: Chat[] = [];
      try {
        const parsed = JSON.parse(new TextDecoder().decode(await next.filesystem.readFile('/chat.json')));
        if (Array.isArray(parsed)) history = parsed.filter(item => ['user', 'assistant'].includes(item.role) && typeof item.content === 'string');
      } catch (error) {if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;}
      if (!stopped) {setSession(next); setProject(project); setChat(history); setReviewEnabled(!history.some(message => message.role === 'user'));}
    })().catch(error => {if (!stopped) setError(String(error));});
    return () => {stopped = true;};
  }, [conversationId, props.loadSession]);
  useEffect(() => {
    if (!session || !project || props.renderPreview) return;
    let stopped = false;
    let resource: Awaited<ReturnType<StudioSession['preparePreview']>> | undefined;
    setPreview(undefined); setPreviewBusy(true);
    void session.preparePreview().then(value => {
      resource = value;
      if (stopped) value.dispose(); else setPreview(value);
    }).catch(error => {if (!stopped) setError(`Preview: ${error instanceof Error ? error.message : String(error)}`);}).finally(() => {if (!stopped) setPreviewBusy(false);});
    return () => {stopped = true; resource?.dispose();};
  }, [session, project]);
  useEffect(() => () => {if (download) URL.revokeObjectURL(download.url);}, [download]);
  const run = async (label: string, action: () => Promise<void>) => {
    if (operationLock.current) return;
    operationLock.current = true; setBusy(label); setError(''); setNotice('');
    try {await action(); if (session) setProject(await session.store.load());}
    catch (error) {setError(error instanceof Error ? error.message : String(error)); if (session) {try {setProject(await session.store.load());} catch {}}}
    finally {operationLock.current = false; setBusy('');}
  };
  const updateProject = async (mutate:(project:StudioProject)=>void) => {
    if(props.sceneSession){const {revision}=await props.sceneSession.sceneState();const next=await session!.store.load();mutate(next);await props.sceneSession.editProject({baseRevision:revision,project:next});}
    else await session!.store.update(mutate);
  };
  const edit = (mutate: (project: StudioProject) => void) => run('Saving', () => updateProject(mutate));
  const addAsset = async (asset: StudioAsset) => {
    if (props.renderPreview && (asset.kind === 'image' || asset.kind === 'video')) {setNotice('Asset available. Ask the assistant to use it in a scene.');return;}
    await updateProject(current => {
      if (asset.kind === 'image') {
        let images = current.tracks.find(t => t.kind === 'image');
        if (!images) {images = {id: crypto.randomUUID(), kind: 'image', name: 'Scenes', clips: []}; current.tracks.unshift(images);}
        images.clips.push({id: crypto.randomUUID(), kind: 'image', assetId: asset.id, startSeconds: 0, durationSeconds: Math.min(3, current.durationSeconds), objectFit: 'cover'});
        return;
      }
      const track = current.tracks.find(track => asset.kind === 'video' ? track.kind === 'video' : track.id === 'music')!;
      const duration = asset.durationSeconds ?? current.durationSeconds;
      current.durationSeconds = Math.max(current.durationSeconds, duration);
      if (asset.kind === 'audio' || asset.kind === 'video') track.clips.push({id: crypto.randomUUID(), kind: asset.kind, assetId: asset.id, startSeconds: 0, sourceStartSeconds: 0, durationSeconds: duration, ...(asset.kind === 'video' ? {muted: true} : {gain: 0.5})});
    });
  };
  const importFile = (file: File) => run('Importing media', async () => {
    const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : undefined;
    if (!kind) throw new Error('Choose an image, audio, or video file.');
    if (file.size > 100 * 1024 * 1024) throw new Error('This playground supports files up to 100 MB.');
    if (kind === 'image') {
      const bitmap = await createImageBitmap(file);
      try {await addAsset(await session!.importAsset({id: crypto.randomUUID(), name: file.name, kind, mimeType: file.type, width: bitmap.width, height: bitmap.height}, file));}
      finally {bitmap.close();}
      setNotice(props.renderPreview ? 'Image available for scene settings or the assistant.' : 'Image added to the scenes track.'); return;
    }
    const duration = kind === 'audio' ? (await decodeMediaAudio(file)).duration : await videoDuration(file);
    const asset = await session!.importAsset({id: crypto.randomUUID(), name: file.name, kind, mimeType: file.type, durationSeconds: duration}, file);
    await addAsset(asset);
    setNotice(kind === 'video' ? (props.renderPreview ? 'Video stored as an asset. Source-mode video compositing is not available.' : 'Video added. Its source audio starts muted; enable it in the clip inspector.') : 'Audio added to the music track.');
  });
  const sampleVideo = () => run('Creating sample video', async () => {
    const blob = await exportComposition({...titleCardComposition, component: SampleFilm, width: 640, height: 360, fps: 10, durationInFrames: 20}, {format: 'webm'});
    const asset = await session!.importAsset({id: crypto.randomUUID(), name: 'Sample video', kind: 'video', mimeType: 'video/webm', durationSeconds: 2}, blob);
    await addAsset(asset);
    await session!.store.update(project => {project.tracks.filter(track => track.kind === 'text').forEach(track => {track.clips = [];});});
    setNotice('Sample video added. Open Dub video to try the workflow.');
  });
  const sampleMusic = () => run('Adding demo music', async () => {
    const asset = await session!.importAsset({id: crypto.randomUUID(), name: 'Demo synth loop', kind: 'audio', mimeType: 'audio/wav', durationSeconds: project!.durationSeconds}, tone(project!.durationSeconds, true));
    await addAsset(asset);
  });
  const sendChat = (event: FormEvent) => {event.preventDefault(); if ((!prompt.trim()&&!attachments.length) || !session || attachmentLoading) return; const draft=prompt; const text=(prompt.trim()||'Use the attached feedback to improve this video.')+(attachments.length?'\n\nAttached feedback: '+attachments.map(file=>file.name).join(', '):''); setPrompt(''); if (/^\/(files|changes|open)(?:\s|$)/.test(text)) {setFilesOpen(true); setShowChanges(text === '/changes'); if (text.startsWith('/open ')) setFileTarget(text.slice(6).trim()); return;} void run('Agent is editing', async () => {
    setLiveProgress([{id:'start',label:'Starting agent…'}]);
    const history: Chat[] = [...chat, {role: 'user', content: text}]; setChat(history);
    await session.filesystem.writeFile('/chat.json', JSON.stringify(history));
    const controller = new AbortController(); abort.current = controller;
    try {
      if (props.send) {const answer = await props.send(text, controller.signal, {review: reviewEnabled,libraryPublish,attachments}); setAttachments([]); const next: Chat[] = [...history, {role: 'assistant', content: answer}]; setChat(next); await session.filesystem.writeFile('/chat.json', JSON.stringify(next)); return;}
      const answer = await streamAgent(session.createAgent({model: providers.model}), history, controller.signal, updateProgress);
      const next: Chat[] = [...history, {role: 'assistant', content: answer}]; setChat(next);
      await session.filesystem.writeFile('/chat.json', JSON.stringify(next));
    } catch(error) {setPrompt(draft);updateProgress({id:'end',label:controller.signal.aborted?'Cancelled':`Error: ${error instanceof Error?error.message:String(error)}`});throw error;} finally {abort.current = undefined; setReviewEnabled(false);setLibraryPublish(false);}
  });};
  const makeExport = (format: 'mp4' | 'webm' | 'wav') => run('Exporting', async () => {
    const controller = new AbortController(); abort.current = controller;
    setExportProgress({value: 0, stage: format === 'wav' ? 'Mixing audio' : 'Preparing video'});
    const onProgress = (value: number) => {
      if (!Number.isFinite(value) || controller.signal.aborted) return;
      const progress = Math.min(1, Math.max(0, value));
      setExportProgress({value: progress, stage: progress >= 1 ? 'Finalizing video' : 'Rendering video'});
    };
    try {
      const result = format === 'wav' ? await session!.mixAudio() : props.exportVideo
        ? {blob: await props.exportVideo({format, signal: controller.signal, onProgress})}
        : await session!.exportVideo({format, signal: controller.signal, onProgress});
      controller.signal.throwIfAborted();
      if (!result.blob.size) throw new Error('Export returned an empty file. Please retry.');
      const file = {url: URL.createObjectURL(result.blob), name: `deepbench.${format}`};
      setDownload(file);
      setExportProgress({value: 1, stage: 'Export ready'});
      // Browsers may block an automatic download after a long render. Keep the link too.
      const anchor = document.createElement('a');
      anchor.href = file.url; anchor.download = file.name;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setNotice('Export ready. If the download did not start, use the download link.');
      try {await props.onExport?.({blob: result.blob, format, mediaType: result.blob.type});}
      catch (error) {setError(`Export is ready to download, but the app could not save it: ${error instanceof Error ? error.message : String(error)}`);}
    } catch (error) {
      if (controller.signal.aborted) setNotice('Export cancelled.'); else throw error;
    } finally {abort.current = undefined; setExportProgress(undefined);}
  });
  const clipLabel = (clip: StudioClip) => clip.kind === 'voiceover' ? `! ${clip.title} — record script` : clip.kind === 'text' ? clip.text : project?.assets.find(asset => asset.id === clip.assetId)?.name ?? 'Voiceover';
  const clipCount=project?.tracks.reduce((count,track)=>count+track.clips.length,0)??0;
  const selectedClip = project?.tracks.flatMap(track => track.clips).find(clip => clip.id === selected);
  const renderTimeline=(scenes?:SceneTimelineParts)=>(<section className="timeline panel" aria-label="Timeline"><div className="panel-heading"><h2>Timeline</h2>{props.renderPreview && <small>{project?.composition ? 'Scenes, music and voiceover' : 'Picture, music and voiceover'}</small>}<div>{scenes?.controls}{!props.renderPreview && <button disabled={!project || !!busy} onClick={() => void edit(project => {project.tracks.find(track => track.kind === 'text')!.clips.push({id: crypto.randomUUID(), kind: 'text', text: 'Your title', startSeconds: 0, durationSeconds: Math.min(3, project.durationSeconds)});})}>＋ Title</button>}<label>Length <input aria-label="Project duration" type="number" min="0.1" step="0.1" value={project?.durationSeconds ?? 8} disabled={!project || !!busy} onChange={event => {const value = Number(event.target.value); void edit(project => {project.durationSeconds = value;});}} /> s</label></div></div>{scenes?.status}<div className="timeline-body"><div className="tracks"><div className="ruler"><span>00:00</span><span>{((project?.durationSeconds ?? 8) / 2).toFixed(1)}s</span><span>{project?.durationSeconds}s</span></div>{scenes?.lanes}{project?.tracks.filter(track => !props.renderPreview || track.kind === 'audio' || track.kind === 'voiceover' || (track.kind === 'video' && track.clips.length>0)).map(track => <div className="track" key={track.id}><div className="track-label"><strong>{track.name}</strong>{(track.kind === 'audio' || track.kind === 'video') && <button aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`} disabled={!!busy} onClick={() => void edit(project => {const target = project.tracks.find(item => item.id === track.id)!; target.muted = !target.muted;})}>{track.muted ? '○' : '♪'}</button>}</div><div className="track-lane">{track.clips.map(clip => <button key={clip.id} className={`clip ${clip.kind} ${selected === clip.id ? 'selected' : ''}`} style={{left: `${clip.startSeconds / project.durationSeconds * 100}%`, width: `${clip.durationSeconds / project.durationSeconds * 100}%`}} onClick={() => {setSelectedScene(undefined); setSelected(clip.id); if (clip.kind === 'voiceover') setModal('voiceover');}} title={clipLabel(clip)}>{clipLabel(clip)}</button>)}</div></div>)}</div><aside className="inspector">{scenes?.inspector ?? (selectedClip ? <ClipInspector key={`${selectedClip.id}-${JSON.stringify(selectedClip)}`} clip={selectedClip} busy={!!busy} onSave={clip => void edit(project => {const track = project.tracks.find(track => track.clips.some(item => item.id === clip.id))!; track.clips = track.clips.map(item => item.id === clip.id ? clip : item);})} onRemove={() => void edit(project => {project.tracks.forEach(track => {track.clips = track.clips.filter(clip => clip.id !== selected);}); setSelected(undefined);})} /> : <><span className="eyebrow">CLIP INSPECTOR</span><p>Select a scene or audio clip to edit its settings.</p></>)}</aside></div></section>);
  return <div data-theme={theme} className={`deepbench-studio studio${filesOpen ? ' studio-files-mode' : ''}`}>
    <header className="topbar"><span className="brand">d<span>◒</span> DeepBench <em>STUDIO</em></span><div className="project-switch"><select aria-label="Conversation" value={conversationId} disabled={!!busy || !!modal || filesDirty} onChange={event => props.onSelectProject?.(event.target.value)}>{conversations.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>{props.onNewProject && <button aria-label="New conversation" disabled={!!busy || !!modal || filesDirty} onClick={props.onNewProject}>＋</button>}</div><div className="top-actions"><button aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>{theme === 'dark' ? '☀' : '☾'}</button>{props.downloadSessionZip&&<button disabled={!!busy||filesDirty} onClick={()=>void run('Packing session ZIP',async()=>{const blob=await props.downloadSessionZip!();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='deepbench-session.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setNotice('Session ZIP downloaded.');})}>Download ZIP</button>}{props.importSessionZip&&<><button disabled={!!busy||filesDirty} onClick={()=>zipInput.current?.click()}>Import ZIP</button><input ref={zipInput} aria-label="Import session ZIP" type="file" accept=".zip,application/zip" hidden onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void run('Importing session ZIP',()=>props.importSessionZip!(file));}}/></>}<span className="mode">{props.connectionLabel ?? (connection ? 'Connected model' : 'Demo mode')}</span>{filesOpen && <button disabled={filesDirty} title={filesDirty ? 'Save or discard your edits first' : undefined} onClick={() => setFilesOpen(false)}>← Back to studio</button>}<button aria-pressed={filesOpen && !showChanges} onClick={() => {setFilesOpen(true); setShowChanges(false); if (!filesDirty) setFileTarget(workspace.files.some(file => file.path === '/Ad.tsx') ? '/Ad.tsx' : '/brief.md');}} disabled={!session}>Files</button><button aria-pressed={filesOpen && showChanges} onClick={() => {setFilesOpen(true); setShowChanges(true);}} disabled={!session || filesDirty}>Watch changes{watchingFiles ? ` (${workspace.changes.length})` : ''}</button>{props.onSettings && <button onClick={props.onSettings} disabled={!!busy}>Settings</button>}<select aria-label="Video export format" value={videoFormat} disabled={!!busy} onChange={event => setVideoFormat(event.target.value as 'mp4' | 'webm')}><option value="mp4">MP4 · H.264</option><option value="webm">WebM</option></select><button className="primary" disabled={!project || !!busy} onClick={() => void makeExport(videoFormat)}>Export video ↗</button></div></header>
    <div className="statusline" aria-live="polite"><span className="status-dot" />{busy || notice || props.activity || 'Your workspace is saved in this browser.'}{busy && abort.current && <button onClick={() => abort.current?.abort()}>Cancel</button>}{download && <a href={download.url} download={download.name}>Download {download.name} ↓</a>}</div>
    {exportProgress && <div className="export-progress" role="status"><span>{exportProgress.stage} · {Math.floor(exportProgress.value * 100)}%</span><progress aria-label="Export progress" max={100} value={Math.floor(exportProgress.value * 100)} /><small>{exportProgress.value >= 1 ? 'Finishing the file before download…' : 'Keep this tab open while the browser renders your video.'}</small></div>}
    {error && <div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
    {filesOpen && session ? showChanges ? <WorkspaceChanges changes={workspace.changes} watching={watchingFiles} onWatch={setWatchingFiles} refresh={workspace.refresh} clearChanges={workspace.clearChanges} onOpen={path => {setFileTarget(path); setShowChanges(false);}} /> : <WorkspaceFiles theme={theme} saveFile={props.sceneSession ? (path,content,expected)=>props.sceneSession!.workspace.write(path,content,expected) : undefined} key={conversationId} onDirtyChange={setFilesDirty} session={session} files={workspace.files} target={fileTarget} busy={!!busy} refresh={workspace.refresh} /> : <>
    <div className="workspace">
      <aside className="library panel"><div className="panel-heading"><h2>Library</h2></div><div className="library-tabs" role="tablist" aria-label="Library">
        {(['media','components'] as const).filter(tab=>tab==='media'||!!props.sceneSession?.library).map(tab=><button key={tab} role="tab" id={`library-tab-${tab}`} aria-controls={`library-panel-${tab}`} aria-selected={libraryTab===tab} tabIndex={libraryTab===tab?0:-1} onClick={()=>setLibraryTab(tab)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)&&props.sceneSession?.library){event.preventDefault();const next=event.key==='Home'?'media':event.key==='End'?'components':tab==='media'?'components':'media';setLibraryTab(next);event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#library-tab-${next}`)?.focus();}}}>{tab==='media'?`Media (${project?.assets.length??0})`:'Brand components'}</button>)}
      </div><div id="library-panel-media" role="tabpanel" aria-labelledby="library-tab-media" hidden={libraryTab!=='media'}><p className="muted">The ingredients for your next story.</p><input ref={uploadRef} type="file" accept="audio/*,video/*,image/*" aria-label="Upload media" hidden onChange={event => {const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file);}} /><button className="upload" disabled={!session || !!busy} onClick={() => uploadRef.current?.click()}>＋ Upload media <small>Images, video or audio · up to 100 MB</small></button><div className="sample-buttons"><button disabled={!session || !!busy} onClick={() => void sampleVideo()}>Sample video</button><button disabled={!session || !!busy} onClick={() => void sampleMusic()}>Demo music</button></div><button disabled={!session || !!busy || !props.imageGeneration} title={props.imageGeneration ? 'Ask the assistant to compose image scenes' : 'Supply an image generation adapter'} onClick={() => {setPrompt('Create a cinematic video with three generated image scenes. First ask me for the subject and visual style.');}}>✦ Generate scenes</button><div className="assets">{project?.assets.map(asset => <button className="asset" key={asset.id} disabled={!!busy} onClick={() => void run('Adding to timeline', () => addAsset(asset))}><span className={`asset-icon ${asset.kind}`}>{asset.kind === 'video' ? '▸' : asset.kind === 'image' ? '▧' : '♫'}</span><span><strong>{asset.name ?? asset.id}</strong><small>{asset.kind}{asset.kind === 'image' ? (asset.width&&asset.height?` · ${asset.width} × ${asset.height}`:'') : (asset.durationSeconds!==undefined?` · ${asset.durationSeconds.toFixed(1)}s`:'')}</small></span><b>＋</b></button>)}</div></div><div id="library-panel-components" role="tabpanel" aria-labelledby="library-tab-components" hidden={libraryTab!=='components'}>{props.sceneSession&&project&&<ComponentLibrary session={props.sceneSession} project={project} onChanged={()=>{void session!.store.load().then(setProject);workspace.refresh();}}/>}</div><div className="library-footer"><span>LOCAL WORKSPACE</span><p>Each conversation has its own files, timeline, and chat.</p></div></aside>
      <section className="canvas panel"><div className="panel-heading"><div><span className="eyebrow">PREVIEW</span><h1>{project?.title ?? 'Opening your studio…'}</h1></div><span className="spec">{project?.width} × {project?.height} · {project?.fps} fps</span></div><div className="preview-area">{props.renderPreview ?? (preview ? <BrowserRemotionPlayer composition={preview.composition} style={{width: '100%', maxHeight: '100%'}} /> : <div className="empty-preview">{previewBusy ? 'Preparing picture & sound…' : 'Your preview will appear here'}</div>)}</div><div className="preview-toolbar"><span>{project?.durationSeconds.toFixed(1)}s <i>•</i> {project?.composition ? `${project.composition.scenes.length} scene${project.composition.scenes.length===1?'':'s'} · ` : ''}{clipCount} {project?.composition ? 'audio ' : ''}clip{clipCount===1?'':'s'}</span><button disabled={!session || !!busy} onClick={() => setModal('dub')}>♫ Dub video</button><button disabled={!session || !!busy} onClick={() => void makeExport('wav')}>Export audio</button></div></section>
      <aside className="chat panel" onDragOver={event=>{if(props.send&&event.dataTransfer.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=busy?'none':'copy';}}} onDrop={event=>{if(props.send&&event.dataTransfer.files.length){event.preventDefault();void attachFiles(Array.from(event.dataTransfer.files));}}}><div className="panel-heading"><h2>Studio assistant</h2><span className="spark">✦</span></div><p className="muted">{connection ? 'Describe the edit. Your agent works on this timeline.' : 'Try the workflow locally. Demo chat uses fixed commands, not an AI model.'}</p><div className="chat-history">{!chat.length && <div className="chat-welcome"><span>✦</span><h3>What are we making?</h3><p>Start with a title, bring in your footage, then give it a voice.</p><button onClick={() => setPrompt('title: A small idea, a big story')}>Set an opening title ↗</button><button onClick={() => setPrompt('mute music')}>Mute the music ↗</button></div>}{chat.map((message, index) => <div className={`message ${message.role}`} key={index}><small>{message.role === 'user' ? 'YOU' : connection ? 'ASSISTANT' : 'DEMO ASSISTANT'}</small><p>{message.content}</p></div>)}{progressEntries.length>0&&<section className="agent-progress" aria-label="Agent activity"><h3>Agent activity {busy?'· Live':''}</h3><div role="log" aria-live="polite" aria-relevant="additions text">{progressEntries.map(entry=><div className="progress-entry" key={entry.id}><small>{entry.label}</small>{entry.text&&<p>{entry.text}</p>}</div>)}<div ref={progressEnd}/></div></section>}</div><form onSubmit={sendChat}>{props.send && <label className="review-toggle"><input type="checkbox" role="switch" aria-label="Reviewer mode" checked={reviewEnabled} disabled={!!busy || !session} onChange={event=>setReviewEnabled(event.target.checked)} /> Reviewer {reviewEnabled ? 'on' : 'off'}</label>}{props.sceneSession?.library?.capabilities.canPublish && <label className="review-toggle"><input type="checkbox" aria-label="Allow library publishing for this request" checked={libraryPublish} disabled={!!busy} onChange={event=>setLibraryPublish(event.target.checked)}/> Allow library publishing for this request</label>}{props.send&&<ChatAttachments attachments={attachments} disabled={!!busy||!session} loading={attachmentLoading} error={attachmentError} onFiles={files=>void attachFiles(files)} onRemove={index=>{setAttachments(files=>files.filter((_,i)=>i!==index));setAttachmentError('');}}/>}<textarea aria-label="Message assistant" placeholder={connection ? 'Describe an edit…' : 'Try “title: Your story”'} value={prompt} onChange={event => setPrompt(event.target.value)} disabled={!!busy || !session} /><div><small>{connection ? 'Edits create revisions' : 'No credentials needed'}</small><button className="primary" disabled={!!busy || !session || attachmentLoading || (!prompt.trim()&&!attachments.length)}>Send ↑</button></div></form></aside>
    </div>
    {props.sceneSession && project ? <SceneEditor session={props.sceneSession} project={project} revision={props.projectRevision} busy={!!busy || props.sceneSession.busy} selected={selectedScene} onSelect={id=>{setSelectedScene(id);setSelected(undefined);}} onChanged={()=>{void session!.store.load().then(setProject);workspace.refresh();}}>{renderTimeline}</SceneEditor> : renderTimeline()}
    </>}
    {workspace.error && <p className="error" role="status">Workspace: {workspace.error}</p>}

    {props.settings}
    {modal && <div className="modal-backdrop"><section className={`modal ${modal === 'dub' ? 'dub-modal' : ''}`} role="dialog" aria-modal="true" aria-label={modal === 'dub' ? 'Dubbing wizard' : modal === 'voiceover' ? 'Voiceover teleprompter' : 'Connection settings'}><button className="close-modal" aria-label="Close dialog" onClick={closeModal}>×</button>{modal === 'voiceover' && selectedClip?.kind === 'voiceover' ? <VoiceoverRecorder key={selectedClip.id} clip={selectedClip} onApply={async (takes,expectedClip)=>{
      if(operationLock.current)throw new Error('Wait for the current operation.');
      operationLock.current=true;setBusy('Adding recorded voiceover');
      try{await session!.applyVoiceoverRecordings(selectedClip.id,expectedClip,takes);setProject(await session!.store.load());workspace.refresh();setModal(null);setNotice('Your recorded voiceover is on the timeline.');}
      finally{operationLock.current=false;setBusy('');}
    }} /> : modal === 'dub' && wizard && session && project ? <><div className="demo-note">{connection ? 'Your connected model drafts the script. Voiceover is AI-generated speech.' : 'DEMO: your brief becomes the script, and generated audio is a test tone—not spoken words.'}</div><DubbingWizardPanel wizard={wizard} store={session.store} project={project} onApplied={project => {setProject(project); setNotice('Voiceover added to the timeline.');}} /></> : null}</section></div>}
  </div>;
}

function ClipInspector({clip, busy, onSave, onRemove}: {clip: StudioClip; busy: boolean; onSave(clip: StudioClip): void; onRemove(): void}) {
  const [draft, setDraft] = useState(clip);
  const number = (key: string, label: string, max?: number) => <label>{label}<input aria-label={label} type="number" min="0" max={max} step="0.1" value={Number((draft as unknown as Record<string, unknown>)[key] ?? (key === 'gain' ? 1 : 0))} onChange={event => setDraft({...draft, [key]: Number(event.target.value)})} /></label>;
  return <form onSubmit={event => {event.preventDefault(); onSave(draft);}}><span className="eyebrow">{clip.kind.toUpperCase()} CLIP</span>{draft.kind === 'text' ? <label>Title text<textarea aria-label="Title text" value={draft.text} onChange={event => setDraft({...draft, text: event.target.value})} /></label> : draft.kind === 'voiceover' ? <p>! Script awaiting recording. Click this timeline clip to open the teleprompter.</p> : draft.kind === 'image' ? <label>Image fit<select value={draft.objectFit ?? 'cover'} onChange={event => setDraft({...draft, objectFit: event.target.value as 'cover' | 'contain'})}><option value="cover">Fill frame</option><option value="contain">Fit image</option></select></label> : <><label><input type="checkbox" checked={draft.muted ?? false} onChange={event => setDraft({...draft, muted: event.target.checked})} /> Mute clip audio</label>{number('sourceStartSeconds', 'Source offset')}<label>Volume (dB)<input aria-label="Volume (dB)" type="number" min="-60" max="36" step="any" value={draft.gain===0 ? -60 : Number((20*Math.log10(draft.gain??1)).toFixed(2))} onChange={event=>setDraft({...draft,gain:10**(Number(event.target.value)/20)})} /></label><small>0 dB = original level. Use mute for silence.</small></>}{number('startSeconds', 'Start time')}{number('durationSeconds', 'Duration')}{(draft.kind === 'audio' || draft.kind === 'video') && <>{number('fadeInSeconds', 'Fade in (seconds)', Math.max(0,draft.durationSeconds-(draft.fadeOutSeconds??0)))}{number('fadeOutSeconds', 'Fade out (seconds)', Math.max(0,draft.durationSeconds-(draft.fadeInSeconds??0)))}<small>Fades apply at the clip’s start and end.</small></>}<div className="inspector-actions"><button className="primary" disabled={busy}>Apply changes</button><button type="button" disabled={busy} onClick={onRemove}>Remove</button></div></form>;
}

async function videoDuration(file: Blob): Promise<number> {
  const url = URL.createObjectURL(file); const video = document.createElement('video');
  try {return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {cleanup(); reject(new Error('Timed out reading video metadata. Try another format.'));}, 15000);
    const cleanup = () => {clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null;};
    video.onloadedmetadata = () => {cleanup(); Number.isFinite(video.duration) && video.duration > 0 ? resolve(video.duration) : reject(new Error('Video has no finite duration.'));};
    video.onerror = () => {cleanup(); reject(new Error('This browser cannot read the video.'));}; video.preload = 'metadata'; video.src = url;
  });} finally {video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);}
}
