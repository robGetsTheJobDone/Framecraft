import {createRoot} from 'react-dom/client';
import {useEffect, useMemo, useState} from 'react';
import {IndexedDBFileSystem} from '@deepbench/browser-filesystem';
import {openStudioSession, type StudioSession} from '@deepbench/browser-studio';
import {StudioView} from '@deepbench/studio/view';
import {Studio, createFileSystemComponentLibrary} from '@deepbench/studio';
import '@deepbench/studio/styles.css';
import {loadPierogiAssets, pierogiBrand} from './pierogi';
import {checkedURL, createProviders, serverImageProvider, type Connection} from './providers';
const disk = new IndexedDBFileSystem({databaseName: 'deepbench-playground'});
const componentLibrary = createFileSystemComponentLibrary(new IndexedDBFileSystem({databaseName:'framecraft-brand-library'}), {workspaceId:'local-brand'});
const sessionCache = new Map<string, Promise<StudioSession>>();
const loadSession = (id: string) => {
  if (!sessionCache.has(id)) sessionCache.set(id, (async () => {
    const session = await openStudioSession({filesystem: disk, conversationId: id, imageProvider: serverImageProvider, seed: {title: 'Untitled film', width: 640, height: 360, durationSeconds: 8, fps: 24}});
    try {await session.filesystem.stat('/playground-initialized');} catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      await session.store.update(project => {project.tracks.find(track => track.kind === 'text')!.clips.push({id: crypto.randomUUID(), kind: 'text', text: 'Make something\nworth watching.', startSeconds: 0, durationSeconds: 8});});
      await session.filesystem.writeFile('/playground-initialized', '1');
    }
    for (const asset of await loadPierogiAssets()) if (!(await session.store.load()).assets.some(item => item.id === asset.metadata.id)) await session.importAsset(asset.metadata, asset.data);
    return session;
  })().catch(error => {sessionCache.delete(id); throw error;}));
  return sessionCache.get(id)!;
};
type Chat = {role: 'user' | 'assistant'; content: string};
type Conversation = {id: string; name: string};
const initialConversations = (): Conversation[] => {
  try {const data = JSON.parse(localStorage.getItem('deepbench-conversations') ?? '[]'); if (Array.isArray(data) && data.length && data.every(x => typeof x.id === 'string' && typeof x.name === 'string')) return data;} catch {}
  return [{id: crypto.randomUUID(), name: 'My first film'}];
};


function App() {
  const [conversations,setConversations]=useState(initialConversations);
  const [active,setActive]=useState(()=>localStorage.getItem('deepbench-active')??'');
  const [connection,setConnection]=useState<Connection|null>(null);
  const [serverConnection,setServerConnection]=useState<Connection|null>(null);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [seedAssets,setSeedAssets]=useState<Awaited<ReturnType<typeof loadPierogiAssets>>>();
  const [seedError,setSeedError]=useState('');
  useEffect(()=>{let stopped=false;void loadPierogiAssets().then(assets=>{if(!stopped)setSeedAssets(assets);}).catch(error=>{if(!stopped)setSeedError(String(error));});return()=>{stopped=true;};},[]);
  const providers=useMemo(()=>createProviders(connection),[connection]);
  const adapters=useMemo(()=>({model:providers.model,imageGeneration:serverImageProvider,speech:providers.dubbing.speechProvider,storage:disk}),[providers]);
  const projectId=conversations.some(c=>c.id===active)?active:conversations[0].id;
  useEffect(()=>{localStorage.setItem('deepbench-conversations',JSON.stringify(conversations));},[conversations]);
  useEffect(()=>{localStorage.setItem('deepbench-active',projectId);},[projectId]);
  useEffect(()=>{let stopped=false;void fetch('/api/config').then(r=>r.json()).then(config=>{if(!stopped&&config.configured){const value={baseURL:`${location.origin}/api/openai/v1`,model:config.model,token:'',speechURL:`${location.origin}/api/speech`,useResponsesApi:config.useResponsesApi??true};setConnection(value);setServerConnection(value);}});return()=>{stopped=true;};},[]);
  useEffect(()=>{if(!settingsOpen)return;const previous=document.activeElement as HTMLElement|null;const dialog=document.querySelector<HTMLElement>('[aria-label="Connection settings"]');const items=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button,input,select,textarea')??[]);items()[0]?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setSettingsOpen(false);}if(event.key==='Tab'){const all=items();if(event.shiftKey&&document.activeElement===all[0]){event.preventDefault();all.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===all.at(-1)){event.preventDefault();all[0]?.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[settingsOpen]);
  const settings=settingsOpen?<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Connection settings"><button className="close-modal" aria-label="Close dialog" onClick={()=>setSettingsOpen(false)}>×</button><Settings current={connection} serverConnection={serverConnection} onSave={value=>{setConnection(value);setSettingsOpen(false);}}/></section></div>:undefined;
  if(new URLSearchParams(location.search).get('mode')!=='timeline' && !seedAssets) return <div role={seedError?'alert':'status'}>{seedError||'Loading Pierogi logo…'}</div>;
  if(new URLSearchParams(location.search).get('mode')!=='timeline') return <Studio onImported={session=>{setConversations(items=>[...items,{id:session.projectId,name:'Imported film'}]);setActive(session.projectId);}} conversations={conversations} onSelectProject={setActive} onNewProject={()=>{const id=crypto.randomUUID();setConversations(items=>[...items,{id,name:`Film ${items.length+1}`}]);setActive(id);}} assets={seedAssets} brand={pierogiBrand} projectId={projectId} initialBrief="Create an editable animated ad from the user's brief." adapters={{...adapters,componentLibrary}} libraryWorkspaceId="local-brand" formats={[{id:'story',width:1080,height:1920},{id:'feed',width:1080,height:1350}]} />;
  return <StudioView projectId={projectId} loadSession={loadSession} providers={providers} conversations={conversations} onSelectProject={setActive} onNewProject={()=>{const id=crypto.randomUUID();setConversations(items=>[...items,{id,name:`Film ${items.length+1}`}]);setActive(id);}} connectionLabel={connection===serverConnection&&connection?'OpenAI connected':connection?'Connected model':'Demo mode'} demo={!connection} imageGeneration={!!serverConnection} onSettings={()=>setSettingsOpen(true)} settings={settings}/>;
}
function Settings({current, serverConnection, onSave}: {serverConnection: Connection | null; current: Connection | null; onSave(value: Connection | null): void}) {
  const [form, setForm] = useState<Connection>(current ?? {baseURL: 'http://localhost:1234/v1', model: '', token: '', speechURL: ''});
  const [error, setError] = useState('');
  return <form className="settings" onSubmit={event => {event.preventDefault(); try {checkedURL(form.baseURL); if (form.speechURL) checkedURL(form.speechURL); if (!form.model.trim()) throw new Error('Enter a model ID.'); onSave(form);} catch (error) {setError(String(error));}}}><span className="eyebrow">MAKE IT YOURS</span><h2>Connect your model</h2><p>{serverConnection ? `OpenAI is configured on the local server (${serverConnection.model}). Image generation and AI voiceover are ready.` : "Add OPENAI_API_KEY to the root .env file and restart pnpm dev to enable OpenAI chat, scene images, and voiceover."}</p>{serverConnection && <button type="button" onClick={() => onSave(serverConnection)}>Use server OpenAI</button>}<p>Use an OpenAI-compatible model gateway with tool calling and structured output. Your gateway must allow this browser origin.</p>{error && <p role="alert">{error}</p>}<label>Gateway base URL<input required value={form.baseURL} onChange={event => setForm({...form, baseURL: event.target.value})} /></label><label>Model ID<input required value={form.model} onChange={event => setForm({...form, model: event.target.value})} /></label><label>Gateway session token (optional)<input type="password" autoComplete="off" value={form.token} onChange={event => setForm({...form, token: event.target.value})} /></label><label>Speech endpoint (optional)<input placeholder="https://your-gateway.example/speech" value={form.speechURL} onChange={event => setForm({...form, speechURL: event.target.value})} /></label><p className="muted">Connection details stay in memory. Use a gateway session token, not a shared provider secret. Speech endpoints receive JSON and return an audio file; see the playground README.</p><div className="settings-actions"><button className="primary">Use gateway</button><button type="button" onClick={() => onSave(null)}>Use demo mode</button></div></form>;
}


createRoot(document.getElementById('root')!).render(<App />);
