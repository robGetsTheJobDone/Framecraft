import {useEffect, useMemo, useRef, useState} from 'react';
import {createAdSession, createLangChainScriptProvider, type AdSession, type AdSessionOptions, type StudioEvent} from '@deepbench/browser-studio';
import {mountAd, type AdRenderInput} from '@deepbench/browser-ad-renderer';
import type {AgentProgress} from './agent-progress.js';
import {StudioView, type StudioViewProps} from './StudioView.js';
export {createAdSession, importAdBundle, adDesignSkills, pierogiBrandSkill, defaultSkills} from '@deepbench/browser-studio';
export type {AdSession, AdSessionOptions, StudioAdapters, StudioSkill, StudioEvent, AgentConfig} from '@deepbench/browser-studio';
export {StudioView} from './StudioView.js';
export type {StudioViewProps} from './StudioView.js';

type ConversationControls = Pick<StudioViewProps, 'conversations' | 'onSelectProject' | 'onNewProject'>;
export type StudioProps = AdSessionOptions & ConversationControls & {
  onExport?(result: {blob: Blob; format: string; mediaType: string}): void | Promise<void>;
  onEvent?(event: StudioEvent): void;
  onReady?(session: AdSession): void;
  onImported?(session: AdSession): void;
};
export function Studio(props: StudioProps) {
  const [session, setSession] = useState<AdSession>();
  const [error, setError] = useState('');
  const latest = useRef(props); latest.current = props;
  useEffect(() => {
    let stopped = false; let current: AdSession | undefined;
    setSession(undefined); setError('');
    void createAdSession(latest.current).then(value => {current = value;if (!stopped){setSession(value);latest.current.onReady?.(value);}}).catch(error => {if(!stopped)setError(String(error));});
    return () => {stopped=true;current?.cancel();};
  }, [props.projectId, props.adapters.model, props.adapters.storage, props.adapters.imageGeneration, props.adapters.speech, props.adapters.componentLibrary, props.libraryWorkspaceId]);
  if (error) return <div className="deepbench-studio" role="alert">{error}</div>;
  if (!session) return <div className="deepbench-studio" role="status">Opening studio…</div>;
  return <AdStudio key={session.projectId} session={session} onImportZip={async file=>{const restored=await session.importZip(file);setSession(restored);props.onImported?.(restored);props.onReady?.(restored);}} onExport={props.onExport} onEvent={props.onEvent} conversations={props.conversations?.some(item=>item.id===session.projectId)?props.conversations:[...(props.conversations??[]),{id:session.projectId,name:'Imported session'}]} onSelectProject={props.onSelectProject} onNewProject={props.onNewProject} />;
}
export function AdStudio({session,onExport,onEvent,onImportZip,...conversationControls}: ConversationControls & {session: AdSession; onExport?: StudioProps['onExport']; onEvent?: StudioProps['onEvent'];onImportZip?:(file:File)=>Promise<void>}) {
  const [progress,setProgress]=useState<AgentProgress[]>([]);
  useEffect(()=>setProgress([]),[session]);
  const [activity,setActivity] = useState('');
  const [revision,setRevision] = useState(0);
  const [interrupted,setInterrupted]=useState<Array<{runId:string;prompt:string}>>([]);
  useEffect(()=>{let stopped=false;void session.listRuns().then(runs=>{if(!stopped)setInterrupted(runs.filter(run=>run.checkpoint&&['running','error','cancelled'].includes(run.status)));}).catch(()=>{});return()=>{stopped=true;};},[session,revision]);
  const [format,setFormat] = useState(session.formats[0].id);
  const [input,setInput] = useState<AdRenderInput>();
  const [error,setError] = useState('');
  const observer = useRef(onEvent);observer.current=onEvent;
  useEffect(()=>session.subscribe(event=>{observer.current?.(event);
    if(event.type!=='preview'&&event.type!=='export')setProgress(entries=>{
      if(event.type==='planning'&&event.round===1&&!event.message)entries=[];
      const id=event.streamId??crypto.randomUUID();
      if(event.type==='message'){
        const previous=entries.find(entry=>entry.id===id);
        const next={id,label:'Designer',text:(previous?.text??'')+(event.message??'')};
        return previous?entries.map(entry=>entry.id===id?next:entry):[...entries,next].slice(-100);
      }
      return [...entries,{id,label:event.type+(event.round?' · round '+event.round:''),text:event.message}].slice(-100);
    });if(event.type!=='export')setActivity(previous=>event.type==='preview'?(session.busy?previous:''):event.type==='complete'||event.type==='cancelled'||event.type==='error'?'':`${event.type}${event.round?` · round ${event.round}`:''}${event.message?` · ${event.message}`:''}`);if(event.type==='preview'||event.type==='complete')setRevision(n=>n+1);}),[session]);
  useEffect(()=>{let stopped=false;void session.renderInputs().then(inputs=>{if(!stopped)setInput(inputs.find(i=>i.format.id===format));}).catch(error=>{if(!stopped)setError(String(error));});return()=>{stopped=true;};},[session,format,revision]);
  // File-editor source edits also refresh the compiled preview.
  useEffect(()=>{let stopped=false;let last='';let timer:ReturnType<typeof setTimeout>;const check=async()=>{try{const files=await session.workspace.list('/',{recursive:true});const stats=files.filter(file=>file.type==='file'&&(file.path==='/project.json'||/\.[cm]?[jt]sx?$/.test(file.path)));const sig=stats.map(stat=>`${stat.path}:${stat.modifiedAt}:${stat.size}`).join(':');if(last&&last!==sig)setRevision(n=>n+1);last=sig;}catch(error){if(!stopped)setError(String(error));}finally{if(!stopped)timer=setTimeout(check,2500);}};void check();return()=>{stopped=true;clearTimeout(timer);};},[session]);
  const providers=useMemo(()=>({model:session.adapters.model,dubbing:{scriptProvider:createLangChainScriptProvider(session.adapters.model),speechProvider:session.adapters.speech??{synthesize:async()=>{throw new Error('Provide a speech adapter to generate approved voiceover.');}}}}),[session]);
  const loadSession=useMemo(()=>async()=>session,[session]);
  return <><StudioView {...conversationControls} sceneSession={session} projectRevision={revision} downloadSessionZip={()=>session.downloadZip()} importSessionZip={onImportZip} projectId={session.projectId} loadSession={loadSession} providers={providers} connectionLabel="React + Remotion agent" imageGeneration={!!session.adapters.imageGeneration} activity={activity} progress={progress} send={async(prompt,signal,options)=>(await session.send(prompt,{signal,review:options.review,libraryPublish:options.libraryPublish})).message} exportVideo={async({format:videoFormat,signal,onProgress})=>{const unsubscribe=session.subscribe(event=>{if(event.type==='export'&&typeof event.progress==='number')onProgress(event.progress);});try{return await session.export({type:videoFormat,format,signal});}finally{unsubscribe();setActivity('');}}} onExport={onExport} renderPreview={<div><label>Format <select aria-label="Ad format" value={format} onChange={event=>setFormat(event.target.value)}>{session.formats.map(f=><option key={f.id} value={f.id}>{f.id}</option>)}</select></label>{error&&<p role="alert">{error}</p>}{input&&<SourcePreview input={input} wasmURL={session.wasmURL}/>}</div>} />
  <div className="deepbench-studio history-controls">{interrupted.map(run=><button key={run.runId} disabled={session.busy} title={run.prompt} onClick={()=>void session.resume(run.runId).then(()=>setRevision(n=>n+1)).catch(e=>setError(String(e)))}>Resume interrupted run · {run.runId.slice(0,8)}</button>)}<button disabled={session.busy} onClick={()=>void session.undo().then(()=>setRevision(n=>n+1)).catch(e=>setError(String(e)))}>Undo</button><button disabled={session.busy} onClick={()=>void session.redo().then(()=>setRevision(n=>n+1)).catch(e=>setError(String(e)))}>Redo</button><button onClick={()=>session.cancel()}>Cancel run</button></div></>;
}
function SourcePreview({input,wasmURL}:{input:AdRenderInput;wasmURL?:string}) {
  const ref=useRef<HTMLDivElement>(null);const [error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();let mounted:Awaited<ReturnType<typeof mountAd>>|undefined;setError('');void mountAd(ref.current!,input,{signal:controller.signal,wasmURL}).then(async value=>{mounted=value;if(controller.signal.aborted)value.dispose();else await value.result;}).catch(e=>{if(!controller.signal.aborted)setError(String(e));});return()=>{controller.abort();mounted?.dispose();};},[input,wasmURL]);
  return <div>{error&&<p role="alert">{error}</p>}<div ref={ref}/></div>;
}

export {renderAd, compileAd, compileSceneModules, mountAd} from '@deepbench/browser-ad-renderer';
export type {AdRenderInput, AdFrame, AdFormat} from '@deepbench/browser-ad-renderer';
export {restoreAdSession, CheckpointConflictError, UncertainToolCallError, prepareContextFiles} from '@deepbench/browser-studio';
export type {CheckpointAdapter, ProductContextOptions} from '@deepbench/browser-studio';

export {createZipFileAdapter, importAdZip, snapshotToZip, zipToSnapshot} from '@deepbench/browser-studio';

export type {SceneOperation, SceneEdit, ComponentLibraryAdapter, ComponentRelease, LibraryPin, LibrarySummary, LibraryQuery, LibraryPreview, PrepareComponentRelease} from '@deepbench/browser-studio';
export {createMemoryComponentLibrary, createFileSystemComponentLibrary, prepareComponentRelease, validateComponentRelease} from '@deepbench/browser-studio';
export type {SceneComposition, SceneComponent, SceneInstance, ComponentInput, JsonValue} from '@deepbench/studio-project';
