import type {StudioProject, StudioAsset} from '@deepbench/studio-project';
import {prepareComponentRelease,materializeComponentRelease,upgradeComponentRelease,forkLibraryComponent,validateLibraryProps,validateComponentRelease,remapLibraryProps,componentContentHash,type ComponentLibraryAdapter,type ComponentRelease,type LibraryPreview,type LibraryPin,type LibraryValue} from './component-library.js';

export const componentLibraryLockPath='/component-library-lock.json';
export interface SessionLibraryOptions {
  adapter: ComponentLibraryAdapter; workspaceId: string;
  readState(): Promise<{project:StudioProject;modules:Record<string,string>;revision:string}>;
  readFile(path:string):Promise<string>;
  resolveAsset(asset:StudioAsset):Promise<Blob>;
  commit(input:{baseRevision:string;project:StudioProject;modules:Record<string,string>;assets?:Array<{metadata:Omit<StudioAsset,'path'>;data:Uint8Array|Blob}>;extraFiles?:Record<string,string>}):Promise<unknown>;
  renderPreview(release:ComponentRelease,exampleProps?:Record<string,LibraryValue>):Promise<LibraryPreview>;
}
const missing=(e:unknown)=>e instanceof Error&&'code'in e&&e.code==='ENOENT';
function encode(bytes:Uint8Array){let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);}
export function createSessionLibrary(options:SessionLibraryOptions) {
  const {adapter,workspaceId}=options;
  const readPins=async():Promise<LibraryPin[]>=>{try{const lock=JSON.parse(await options.readFile(componentLibraryLockPath));if(lock.schemaVersion!==1||!Array.isArray(lock.pins))throw new Error('Invalid component library lock');return lock.pins;}catch(e){if(missing(e))return [];throw e;}};
  const inspect=async(input:{componentId:string;version:string},signal?:AbortSignal)=>{const release=await adapter.get({workspaceId,componentId:input.componentId,version:input.version},signal);if(!release)throw new Error('Library component version not found');await validateComponentRelease(release);if(release.componentId!==input.componentId||release.version!==input.version)throw new Error('Library provider returned a different component version');return release;};
  const extraFiles=(pins:LibraryPin[])=>({[componentLibraryLockPath]:JSON.stringify({schemaVersion:1,pins})});
  const assetsFor=(assets:Awaited<ReturnType<typeof materializeComponentRelease>>['assets'])=>Object.entries(assets).map(([id,a])=>({metadata:{id,kind:a.kind,mimeType:a.mimeType,name:a.name},data:Uint8Array.from(atob(a.data),c=>c.charCodeAt(0))}));
  const applyAssets=async(project:StudioProject,assets:ReturnType<typeof assetsFor>)=>{for(const {metadata,data}of assets){const existing=project.assets.find(a=>a.id===metadata.id);if(existing){if(existing.kind!==metadata.kind||existing.mimeType!==metadata.mimeType)throw new Error('Library asset metadata collision');const bytes=new Uint8Array(await(await options.resolveAsset(existing)).arrayBuffer());if(bytes.length!==data.length||!bytes.every((b,i)=>b===data[i]))throw new Error('Library asset content collision');continue;}project.assets.push({...metadata,path:`assets/${metadata.id}`});}};
  return {
    capabilities:adapter.capabilities??{canPublish:false},readPins,
    search:(input:Omit<Parameters<ComponentLibraryAdapter['search']>[0],'workspaceId'>={},signal?:AbortSignal)=>adapter.search({...input,workspaceId},signal),
    inspect,
    async save(input:{localComponentId:string;componentId:string;version:string;name:string;description?:string;tags?:string[];kind?:'component'|'scene';authorized:true;idempotencyKey:string;assetIds?:string[];exampleProps?:Record<string,LibraryValue>},signal?:AbortSignal) {
      if(input.authorized!==true)throw new Error('Saving to the library requires explicit user authorization');
      signal?.throwIfAborted();const state=await options.readState();const component=state.project.composition?.components.find(c=>c.id===input.localComponentId);if(!component)throw new Error('Unknown project component');
      const exampleProps=validateLibraryProps(component,input.exampleProps??state.project.composition?.scenes.find(s=>s.componentId===component.id)?.props??{});
      const requested=new Set(input.assetIds??[]);
      for(const id of Object.values(component.assetBindings??{}))requested.add(id);
      for(const [key,schema]of Object.entries(component.inputs??{}))if(schema.type==='asset'&&typeof component.defaults?.[key]==='string')requested.add(component.defaults[key] as string);
      for(const [key,schema]of Object.entries(component.inputs??{}))if(schema.type==='asset'&&typeof exampleProps[key]==='string')requested.add(exampleProps[key] as string);
      const assets:NonNullable<Parameters<typeof prepareComponentRelease>[0]['assets']>={};
      for(const id of requested){signal?.throwIfAborted();const asset=state.project.assets.find(a=>a.id===id);if(!asset)throw new Error(`Missing library asset: ${id}`);assets[id]={kind:asset.kind,mimeType:asset.mimeType,name:asset.name,data:encode(new Uint8Array(await(await options.resolveAsset(asset)).arrayBuffer()))};}
      const release=await prepareComponentRelease({...input,component,modules:state.modules,assets},release=>options.renderPreview(release,exampleProps));
      signal?.throwIfAborted();return adapter.publish({workspaceId,release,authorized:true,idempotencyKey:input.idempotencyKey},signal);
    },
    async insert(input:{componentId:string;version:string;sceneId?:string;startFrame?:number;durationInFrames?:number;layer?:number;props?:Record<string,LibraryValue>;projectAssetInputs?:string[]},signal?:AbortSignal) {
      const release=await inspect(input,signal);const state=await options.readState();const project=structuredClone(state.project);if(!project.composition)throw new Error('Convert the source composition to scenes before inserting library components');
      const result=await materializeComponentRelease(release,{workspaceId});const composition=project.composition;
      const existing=composition.components.find(c=>c.id===result.component.id);if(existing&&await componentContentHash(existing)!==await componentContentHash(result.component))throw new Error('Local library component changed; fork it before inserting this release');
      for(const [path,source]of Object.entries(result.modules))if((existing||Object.hasOwn(state.modules,path))&&state.modules[path]!==source)throw new Error('Library module has local changes; fork or merge explicitly before inserting this release');
      if(!existing)composition.components.push(result.component);
      const props=remapLibraryProps(result.component,input.props??{},result.pin.assetBindings);
      for(const key of input.projectAssetInputs??[]){const value=input.props?.[key];if(result.component.inputs?.[key]?.type!=='asset'||typeof value!=='string'||!project.assets.some(asset=>asset.id===value))throw new Error(`Invalid project asset override: ${key}`);props[key]=value;}
      validateLibraryProps(result.component,props);
      const id=input.sceneId??`scene-${crypto.randomUUID()}`;if(composition.scenes.some(s=>s.id===id))throw new Error('Scene ID already exists');
      const startFrame=input.startFrame??0;const durationInFrames=input.durationInFrames??Math.min(result.component.authoredDurationInFrames,Math.round(project.durationSeconds*project.fps)-startFrame);
      composition.scenes.push({id,name:release.name,componentId:result.component.id,startFrame,durationInFrames,sourceStartFrame:0,layer:input.layer??composition.scenes.length,props});
      const assets=assetsFor(result.assets);await applyAssets(project,assets);const pins=await readPins();if(!pins.some(p=>p.localComponentId===result.pin.localComponentId))pins.push(result.pin);
      signal?.throwIfAborted();const committed=await options.commit({baseRevision:state.revision,project,modules:{...state.modules,...result.modules},assets,extraFiles:extraFiles(pins)});return{sceneId:id,pin:result.pin,committed};
    },
    async upgrade(input:{localComponentId:string;version:string},signal?:AbortSignal) {
      const state=await options.readState();const pins=await readPins();const pin=pins.find(p=>p.localComponentId===input.localComponentId);if(!pin)throw new Error('Component has no library resolution');
      if(pin.workspaceId!==workspaceId)throw new Error('Component belongs to another library workspace; reconnect its original library before upgrading');
      const release=await inspect({componentId:pin.componentId,version:input.version},signal);const project=structuredClone(state.project);const composition=project.composition;if(!composition)throw new Error('Project has no scene composition');
      const componentIndex=composition.components.findIndex(c=>c.id===input.localComponentId);if(componentIndex<0)throw new Error('Unknown project component');
      if(await componentContentHash(composition.components[componentIndex])!==pin.componentHash)throw new Error('Library component has local edits; fork or merge explicitly before upgrade');
      for(const [path,hash]of Object.entries(pin.moduleHashes??{}))if(typeof state.modules[path]!=='string'||await componentContentHash(state.modules[path])!==hash)throw new Error('Library component has local source edits; fork or merge explicitly before upgrade');
      const scenes=composition.scenes.filter(s=>s.componentId===input.localComponentId);const result=await upgradeComponentRelease(pin,release,scenes.map(s=>s.props));
      composition.components[componentIndex]=result.component;scenes.forEach((s,i)=>{s.props=result.props[i];if(s.sourceStartFrame+s.durationInFrames>result.component.authoredDurationInFrames)throw new Error('Updated component is shorter than an existing scene; trim it explicitly first');});
      const assets=assetsFor(result.assets);await applyAssets(project,assets);pins[pins.indexOf(pin)]=result.pin;
      signal?.throwIfAborted();const committed=await options.commit({baseRevision:state.revision,project,modules:{...state.modules,...result.modules},assets,extraFiles:extraFiles(pins)});return{pin:result.pin,affectedSceneIds:scenes.map(s=>s.id),committed};
    },
    async fork(input:{sceneId:string;newComponentId:string},signal?:AbortSignal) {
      const state=await options.readState();const project=structuredClone(state.project);const composition=project.composition;const scene=composition?.scenes.find(s=>s.id===input.sceneId);const component=composition?.components.find(c=>c.id===scene?.componentId);if(!scene||!component||!composition)throw new Error('Unknown scene');if(composition.components.some(c=>c.id===input.newComponentId))throw new Error('Component ID already exists');
      const pins=await readPins();const pin=pins.find(p=>p.localComponentId===component.id);if(!pin)throw new Error('Component has no library resolution');const result=await forkLibraryComponent(component,state.modules,pin,input.newComponentId);composition.components.push(result.component);scene.componentId=result.component.id;pins.push(result.pin);
      signal?.throwIfAborted();return options.commit({baseRevision:state.revision,project,modules:{...state.modules,...result.modules},extraFiles:extraFiles(pins)});
    },
  };
}
