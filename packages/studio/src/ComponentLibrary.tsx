import {useEffect, useRef, useState} from 'react';
import type {AdSession, ComponentRelease, LibrarySummary, LibraryValue} from '@deepbench/browser-studio';
import type {StudioProject} from '@deepbench/studio-project';

export function ComponentLibrary({session,project,onChanged}: {session:AdSession;project:StudioProject;onChanged():void}) {
  const library=session.library;
  const publishKeys=useRef(new Map<string,string>());
  const [query,setQuery]=useState('');
  const [items,setItems]=useState<LibrarySummary[]>([]);
  const [next,setNext]=useState<number|null>(null);
  const [chosen,setChosen]=useState<ComponentRelease>();
  const [props,setProps]=useState<Record<string,LibraryValue>>({});
  const [projectAssetInputs,setProjectAssetInputs]=useState<string[]>([]);
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [localId,setLocalId]=useState('');
  const [name,setName]=useState('');
  const [componentId,setComponentId]=useState('');
  const [version,setVersion]=useState('1.0.0');
  const [upgradeVersion,setUpgradeVersion]=useState('');
  const run=async(fn:()=>Promise<void>)=>{if(working||session.busy)return;setWorking(true);setError('');setNotice('');try{await fn();onChanged();}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setWorking(false);}};
  const search=async(offset=0)=>{if(!library)return;const result=await library.search({query,offset,limit:10});setItems(previous=>offset?[...previous,...result.items]:result.items);setNext(result.nextOffset);};
  useEffect(()=>{setChosen(undefined);setItems([]);setNext(null);},[session]);
  if(!library)return null;
  const disabled=working||session.busy;
  return <section className="component-library panel" aria-label="Brand component library">
    <div className="panel-heading"><div><h2>Brand components</h2><small>Reusable versions. Existing videos keep their saved version.</small></div></div>
    {error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <form className="component-search" onSubmit={event=>{event.preventDefault();void run(()=>search());}}><label>Find a component<input aria-label="Search brand components" value={query} onChange={event=>setQuery(event.target.value)}/></label><button type="submit" className="primary" disabled={disabled}>Search library</button></form>
    <div className="component-results" role="list" aria-label="Component search results">{!items.length&&<small role="status">Search the library to find reusable components.</small>}{items.map(item=><button type="button" aria-label={`Choose ${item.name} ${item.version}`} disabled={disabled} key={`${item.componentId}:${item.version}`} onClick={()=>void run(async()=>{const release=await library.inspect({componentId:item.componentId,version:item.version});if(!release)throw new Error('Component version is unavailable');setChosen(release);setProjectAssetInputs([]);setProps({...Object.fromEntries(Object.entries(release.component.inputs??{}).filter(([,input])=>input.type==='boolean').map(([key])=>[key,false])),...release.component.defaults});})}>
      {item.preview&&<img src={item.preview.dataUrl} alt={`${item.name} preview`}/>}<strong>{item.name}</strong><small>{item.version} · {item.kind}</small><span>{item.description}</span>
    </button>)}</div>
    {next!==null&&<button type="button" disabled={disabled} onClick={()=>void run(()=>search(next))}>More components</button>}
    {chosen&&<form className="component-insert" aria-label="Insert component" onSubmit={event=>{event.preventDefault();void run(async()=>{await library.insert({componentId:chosen.componentId,version:chosen.version,props,projectAssetInputs});setNotice(`Added ${chosen.name} ${chosen.version}.`);setChosen(undefined);});}}>
      <h3>Insert {chosen.name} · {chosen.version}</h3>
      {Object.entries(chosen.component.inputs??{}).map(([key,input])=><label key={key}>{input.label??key}{input.type==='boolean'?<input type="checkbox" checked={props[key]===true} onChange={event=>setProps({...props,[key]:event.target.checked})}/>:input.type==='asset'||input.type==='enum'?<select required={input.required} value={props[key]?`${input.type==='asset'?(projectAssetInputs.includes(key)?'project:':'library:'):''}${props[key]}`:''} onChange={event=>{const raw=event.target.value;if(input.type==='asset'){setProjectAssetInputs(previous=>[...previous.filter(name=>name!==key),...(raw.startsWith('project:')?[key]:[])]);setProps({...props,[key]:raw.slice(raw.indexOf(':')+1)});}else setProps({...props,[key]:raw});}}><option value="">Choose…</option>{input.type==='asset'?<>{Object.entries(chosen.assets).filter(([,asset])=>asset.kind==='image').map(([id,asset])=><option key={`bundled-${id}`} value={`library:${id}`}>{asset.name??id} (included)</option>)}{project.assets.filter(asset=>asset.kind==='image').map(asset=><option key={asset.id} value={`project:${asset.id}`}>{asset.name??asset.id} (project)</option>)}</>:input.options?.map(value=><option key={value}>{value}</option>)}</select>:<input type={input.type==='number'?'number':'text'} required={input.required} min={input.min} max={input.max} step="any" value={String(props[key]??(input.type==='color'?'#ffffff':''))} onChange={event=>{const next={...props};if(event.target.value==='')delete next[key];else next[key]=input.type==='number'?Number(event.target.value):event.target.value;setProps(next);}}/>}</label>)}
      <button type="submit" disabled={disabled||!project.composition} className="primary">Insert saved version</button>{!project.composition&&<small>Enable scene editing before inserting a library scene.</small>}<button disabled={disabled} type="button" onClick={()=>setChosen(undefined)}>Cancel</button>
    </form>}
    {project.composition&&<details><summary>Save or upgrade a project component</summary>
      <label>Project component<select aria-label="Project component" value={localId} onChange={event=>setLocalId(event.target.value)}><option value="">Choose…</option>{project.composition.components.map(component=><option key={component.id} value={component.id}>{project.composition!.scenes.find(scene=>scene.componentId===component.id)?.name??component.id}</option>)}</select></label>
      {library.capabilities.canPublish&&<form aria-label="Save to brand library" onSubmit={event=>{event.preventDefault();void run(async()=>{const key=JSON.stringify([localId,componentId,version,name]);let idempotencyKey=publishKeys.current.get(key);if(!idempotencyKey){idempotencyKey=crypto.randomUUID();publishKeys.current.set(key,idempotencyKey);}await library.save({localComponentId:localId,componentId,version,name,authorized:true,idempotencyKey});publishKeys.current.delete(key);setNotice(`Saved ${name} ${version} to the library.`);await search();});}}>
        <label>Library name<input aria-label="Library component name" required value={name} onChange={event=>setName(event.target.value)}/></label>
        <label>Library ID<input aria-label="Library component ID" required pattern="[A-Za-z0-9_-]+" value={componentId} onChange={event=>setComponentId(event.target.value)}/></label>
        <label>Version<input aria-label="Library component version" required value={version} onChange={event=>setVersion(event.target.value)}/></label>
        <small>Save publishes this component and its required assets as a reusable version. It does not update other projects.</small>
        <button type="submit" disabled={disabled||!localId} className="primary">Save to brand library</button>
      </form>}
      <form aria-label="Upgrade project component" onSubmit={event=>{event.preventDefault();void run(async()=>{await library.upgrade({localComponentId:localId,version:upgradeVersion});setNotice(`Updated this project's component to ${upgradeVersion}.`);});}}>
        <label>Upgrade to version<input aria-label="Upgrade component version" required value={upgradeVersion} onChange={event=>setUpgradeVersion(event.target.value)}/></label><small>Updates instances of the selected library component in this project only.</small><button type="submit" disabled={disabled||!localId}>Upgrade project component</button>
      </form>
    </details>}
  </section>;
}
