import {useEffect, useState} from 'react';
import type {AdSession, LibraryPin} from '@deepbench/browser-studio';
import type {ComponentInput, JsonValue, SceneComponent, SceneInstance, StudioProject} from '@deepbench/studio-project';

type SceneState = Awaited<ReturnType<AdSession['sceneState']>>;
type Operations = Parameters<AdSession['editScenes']>[0]['operations'];

/** Scene controls always mutate the same manifest consumed by preview and export. */
export function SceneEditor({session, project, revision, busy, onChanged}: {
  session: AdSession; project: StudioProject; revision?: number; busy: boolean; onChanged(): void;
}) {
  const [state,setState] = useState<SceneState>();
  const [pins,setPins]=useState<LibraryPin[]>([]);
  const [selected,setSelected] = useState<string>();
  const [working,setWorking] = useState(false);
  const [error,setError] = useState('');
  useEffect(()=>{let live=true;void Promise.all([session.sceneState(),session.library?.readPins()??Promise.resolve([])]).then(([value,libraryPins])=>{if(live){setState(value);setPins(libraryPins);}}).catch(error=>{if(live)setError(String(error));});return()=>{live=false;};},[session,revision,project]);
  const refresh=async()=>{setState(await session.sceneState());onChanged();};
  const run=async(fn:()=>Promise<unknown>)=>{if(working||busy)return;setWorking(true);setError('');try{await fn();await refresh();return true;}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setWorking(false);}};
  const apply=(operations:Operations)=>run(()=>session.editScenes({baseRevision:state!.revision,operations}));
  const composition=state?.composition;
  const scene=composition?.scenes.find(item=>item.id===selected);
  const component=composition?.components.find(item=>item.id===scene?.componentId);
  const disabled=busy||working||!state;
  const add=()=>{
    const id=crypto.randomUUID(), componentId=crypto.randomUUID();
    const frames=Math.max(1,Math.round(project.durationSeconds*project.fps));
    const newScene:SceneInstance={id,name:'New scene',componentId,startFrame:0,durationInFrames:frames,sourceStartFrame:0,layer:Math.max(-1,...(composition?.scenes.map(item=>item.layer)??[]))+1,props:{text:'Your next scene',color:'#ffffff'}};
    const newComponent:SceneComponent={id:componentId,entry:`/scenes/${componentId}.tsx`,authoredDurationInFrames:frames,inputs:{text:{type:'text',label:'Headline',required:true},color:{type:'color',label:'Text color',required:true}},defaults:{text:'Your next scene',color:'#ffffff'}};
    void apply([{type:'addComponent',component:newComponent,source:`import React from 'react';\nimport {AbsoluteFill} from 'remotion';\nexport default function Scene({text,color}) { return <AbsoluteFill style={{background:'#10141e',color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:64,fontFamily:'sans-serif'}}>{text}</AbsoluteFill>; }\n`},{type:'addScene',scene:newScene}]).then(ok=>{if(ok)setSelected(id);});
  };
  return <section className="scene-editor panel" aria-label="Scene editor">
    <div className="panel-heading"><div><h2>Scenes</h2><small>{composition?'Timing and settings are shared with preview and export.':'This composition is edited through code or the assistant.'}</small></div>
      {composition?<button disabled={disabled} onClick={add}>＋ Add scene</button>:<button disabled={disabled} onClick={()=>void run(()=>session.convertToScenes())}>Enable scene editing</button>}
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    {working&&<p role="status">Validating scene changes…</p>}
    {!composition?<p className="muted">Keep the current composition as one scene. Its visuals stay intact; you can then add scenes and edit their arrangement.</p>:<div className="scene-editor-body">
      <div className="scene-list"><div className="scene-ruler"><span>0s</span><span>{project.durationSeconds}s</span></div>
        {[...composition.scenes].sort((a,b)=>b.layer-a.layer).map(item=><div className="scene-row" key={item.id}>
          <button className={selected===item.id?'scene-name selected':'scene-name'} aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}>{item.name??item.id}</button>
          <div className="scene-lane"><button aria-label={`Select scene ${item.name??item.id}`} className="scene-block" style={{left:`${item.startFrame/(project.durationSeconds*project.fps)*100}%`,width:`${item.durationInFrames/(project.durationSeconds*project.fps)*100}%`}} onClick={()=>setSelected(item.id)}>{(item.startFrame/project.fps).toFixed(2)}–{((item.startFrame+item.durationInFrames)/project.fps).toFixed(2)}s</button></div>
        </div>)}
        {!composition.scenes.length&&<p>No scenes yet. Add a scene or ask the assistant to build one.</p>}
      </div>
      {scene&&component?<SceneInspector key={`${state.revision}:${scene.id}`} scene={scene} component={component} project={project} disabled={disabled} usages={composition.scenes.filter(item=>item.componentId===component.id).length} pin={pins.find(pin=>pin.localComponentId===component.id)}
        onSave={patch=>void apply([{type:'updateScene',id:scene.id,patch}])}
        onDuplicate={()=>{const id=crypto.randomUUID();void apply([{type:'addScene',scene:{...structuredClone(scene),id,name:`${scene.name??'Scene'} copy`,layer:Math.max(...composition.scenes.map(item=>item.layer))+1}}]).then(ok=>{if(ok)setSelected(id);});}}
        onFork={()=>void apply([{type:'forkScene',id:scene.id,componentId:crypto.randomUUID(),entry:`${component.entry.slice(0,component.entry.lastIndexOf('/'))}/${crypto.randomUUID()}.tsx`}])}
        onRemove={()=>void apply([{type:'removeScene',id:scene.id}]).then(ok=>{if(ok)setSelected(undefined);})}/>:<p className="muted">Select a scene to change its timing, layer, or exposed settings. Higher layers appear above lower layers.</p>}
    </div>}
  </section>;
}

function SceneInspector({scene,component,project,disabled,usages,pin,onSave,onDuplicate,onFork,onRemove}: {
  scene:SceneInstance;component:SceneComponent;project:StudioProject;disabled:boolean;usages:number;pin?:LibraryPin;
  onSave(patch:Partial<SceneInstance>):void;onDuplicate():void;onFork():void;onRemove():void;
}) {
  const [draft,setDraft]=useState(structuredClone(scene));
  const value=(name:string)=>draft.props[name]??component.defaults?.[name];
  const prop=(name:string,next:JsonValue)=>setDraft(old=>({...old,props:{...old.props,[name]:next}}));
  const control=(name:string,input:ComponentInput)=>{
    const label=input.label??name;const current=value(name);
    if(input.type==='boolean')return <label key={name}><input type="checkbox" checked={current===true} onChange={event=>prop(name,event.target.checked)}/>{label}</label>;
    if(input.type==='enum'||input.type==='asset')return <label key={name}>{label}<select aria-label={label} value={typeof current==='string'?current:''} required={input.required} onChange={event=>prop(name,event.target.value)}><option value="">Select…</option>{input.type==='asset'?project.assets.filter(asset=>asset.kind==='image').map(asset=><option key={asset.id} value={asset.id}>{asset.name??asset.id}</option>):input.options?.map(option=><option key={option} value={option}>{option}</option>)}</select></label>;
    return <label key={name}>{label}<input aria-label={label} type={input.type==='number'?'number':'text'} value={typeof current==='string'||typeof current==='number'?current:input.type==='color'?'#ffffff':''} min={input.min} max={input.max} step={input.type==='number'?'any':undefined} required={input.required} onChange={event=>prop(name,input.type==='number'?Number(event.target.value):event.target.value)}/></label>;
  };
  return <form className="scene-inspector" onSubmit={event=>{event.preventDefault();onSave({name:draft.name,startFrame:draft.startFrame,durationInFrames:draft.durationInFrames,sourceStartFrame:draft.sourceStartFrame,layer:draft.layer,props:draft.props});}}>
    <fieldset disabled={disabled}><legend>Scene settings</legend>
      <label>Name<input aria-label="Scene name" value={draft.name??''} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
      <label>Start (seconds)<input aria-label="Scene start" type="number" min="0" step={1/project.fps} value={draft.startFrame/project.fps} onChange={event=>setDraft({...draft,startFrame:Math.round(Number(event.target.value)*project.fps)})}/></label>
      <label>Visible duration (seconds)<input aria-label="Scene duration" type="number" min={1/project.fps} step={1/project.fps} value={draft.durationInFrames/project.fps} onChange={event=>setDraft({...draft,durationInFrames:Math.round(Number(event.target.value)*project.fps)})}/></label>
      <label>Content offset (seconds)<input aria-label="Scene content offset" type="number" min="0" step={1/project.fps} value={draft.sourceStartFrame/project.fps} onChange={event=>setDraft({...draft,sourceStartFrame:Math.round(Number(event.target.value)*project.fps)})}/></label>
      <label>Layer<input aria-label="Scene layer" type="number" step="1" value={draft.layer} onChange={event=>setDraft({...draft,layer:Number(event.target.value)})}/></label>
      <small>Trimming preserves animation speed. Audio stays at its existing timeline position.</small>
      {Object.entries(component.inputs??{}).map(([name,input])=>control(name,input))}
      <p className="muted">This component is used by {usages} scene{usages===1?'':'s'}. Settings here affect this instance.</p>
      <small>Source: {component.entry}{pin?` · Library: ${pin.componentId} ${pin.version}`:''}</small>
      <div className="scene-actions"><button type="submit" className="primary">Apply scene changes</button><button type="button" onClick={onDuplicate}>Duplicate scene</button><button type="button" disabled={usages<2} onClick={onFork}>Make component independent</button><button type="button" onClick={onRemove}>Remove scene</button></div>
    </fieldset>
  </form>;
}
