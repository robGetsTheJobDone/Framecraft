import {extractComponentModules} from './component-library.js';
import {normalizePath, type BrowserFileSystem} from '@deepbench/browser-filesystem';
import {isModulePath, assertValidProject, type StudioProject, type SceneComponent, type SceneInstance} from '@deepbench/studio-project';

export type SceneOperation =
  | {type:'addComponent'; component:SceneComponent; source:string}
  | {type:'writeModule'; path:string; source:string}
  | {type:'removeModule'; path:string}
  | {type:'addScene'; scene:SceneInstance}
  | {type:'updateScene'; id:string; patch:Partial<Omit<SceneInstance,'id'>>}
  | {type:'removeScene'; id:string}
  | {type:'updateComponent'; id:string; patch:Partial<Omit<SceneComponent,'id'>>}
  | {type:'removeComponent'; id:string}
  | {type:'forkScene'; id:string; componentId:string; entry:string};
export interface SceneEdit {baseRevision:string; operations:SceneOperation[]}
const reserved = /^\/(?:context|skills|runs|exports|revisions|assets|music)(?:\/|$)/;
export function isProjectModule(path:string) {return /\.(?:tsx?|jsx?)$/.test(path) && !reserved.test(path) && path !== '/Ad.tsx';}
export function validateModulePath(path:string) {
  if(normalizePath(path)!==path||!isModulePath(path)||!isProjectModule(path))throw new Error(`Invalid project module path: ${path}`);
}
export async function readProjectModules(fs:BrowserFileSystem) {
  const modules:Record<string,string>={};
  for(const file of await fs.list('/',{recursive:true})) if(file.type==='file'&&isProjectModule(file.path)) modules[file.path]=new TextDecoder().decode(await fs.readFile(file.path));
  return modules;
}
export async function applySceneOperations(original:StudioProject, originalModules:Record<string,string>, operations:SceneOperation[], externalImports:ReadonlySet<string>=new Set()) {
  const project=structuredClone(original);const modules={...originalModules};
  project.schemaVersion=2;
  project.composition ??= {version:1,components:[],scenes:[]};
  const composition=project.composition;
  if(!operations.length||operations.length>100)throw new Error('Provide between 1 and 100 scene operations');
  const component=(id:string)=>{const item=composition.components.find(c=>c.id===id);if(!item)throw new Error(`Unknown component: ${id}`);return item;};
  const scene=(id:string)=>{const item=composition.scenes.find(s=>s.id===id);if(!item)throw new Error(`Unknown scene: ${id}`);return item;};
  for(const operation of operations) {
    switch(operation.type) {
      case 'addComponent': {
        if(composition.components.some(c=>c.id===operation.component.id))throw new Error(`Duplicate component: ${operation.component.id}`);
        validateModulePath(operation.component.entry);
        if(Object.hasOwn(modules,operation.component.entry))throw new Error(`Module already exists: ${operation.component.entry}`);
        composition.components.push(structuredClone(operation.component));modules[operation.component.entry]=operation.source;break;
      }
      case 'writeModule':validateModulePath(operation.path);modules[operation.path]=operation.source;break;
      case 'removeModule':validateModulePath(operation.path);delete modules[operation.path];break;
      case 'addScene':if(composition.scenes.some(s=>s.id===operation.scene.id))throw new Error(`Duplicate scene: ${operation.scene.id}`);composition.scenes.push(structuredClone(operation.scene));break;
      case 'updateScene':Object.assign(scene(operation.id),structuredClone(operation.patch),{id:operation.id});break;
      case 'removeScene':scene(operation.id);composition.scenes=composition.scenes.filter(s=>s.id!==operation.id);break;
      case 'updateComponent':Object.assign(component(operation.id),structuredClone(operation.patch),{id:operation.id});break;
      case 'removeComponent':component(operation.id);composition.components=composition.components.filter(c=>c.id!==operation.id);break;
      case 'forkScene': {
        const target=scene(operation.id);const old=component(target.componentId);
        if(composition.components.some(c=>c.id===operation.componentId))throw new Error('Fork component ID already exists');
        validateModulePath(operation.entry);if(Object.hasOwn(modules,operation.entry))throw new Error('Fork module path already exists');
        const closure=await extractComponentModules(old.entry,modules,externalImports);const prefix=`/components/forks/${operation.componentId}`;
        for(const [path,source]of Object.entries(closure)){const next=prefix+path;if(Object.hasOwn(modules,next))throw new Error('Fork dependency path already exists');modules[next]=source;}
        const from=operation.entry.split('/').slice(1,-1);const to=(prefix+old.entry).split('/').slice(1);while(from.length&&to.length&&from[0]===to[0]){from.shift();to.shift();}
        const relative=(from.length?'../'.repeat(from.length):'./')+to.join('/');
        const fork={...structuredClone(old),id:operation.componentId,entry:operation.entry};
        composition.components.push(fork);modules[operation.entry]=`export {default} from ${JSON.stringify(relative)};`;target.componentId=fork.id;break;
      }
      default:throw new Error('Unknown scene operation');
    }
  }
  assertValidProject(project);
  for(const entry of composition.components) if(!Object.hasOwn(modules,entry.entry))throw new Error(`Missing component module: ${entry.entry}`);
  return {project,modules};
}

import {z} from 'zod';
const values=z.record(z.string(),z.json());
const inputSchema=z.object({type:z.enum(['text','number','boolean','color','enum','asset']),label:z.string().optional(),required:z.boolean().optional(),options:z.array(z.string()).optional(),min:z.number().optional(),max:z.number().optional()});
const componentSchema=z.object({id:z.string().min(1),entry:z.string().min(1),authoredDurationInFrames:z.number().int().positive(),inputs:z.record(z.string(),inputSchema).optional(),defaults:values.optional(),assetBindings:z.record(z.string(),z.string()).optional()});
const sceneSchema=z.object({id:z.string().min(1),name:z.string().optional(),componentId:z.string().min(1),startFrame:z.number().int().nonnegative(),durationInFrames:z.number().int().positive(),sourceStartFrame:z.number().int().nonnegative(),layer:z.number().int(),props:values});
export const sceneOperationsSchema=z.array(z.discriminatedUnion('type',[
  z.object({type:z.literal('addComponent'),component:componentSchema,source:z.string().min(1)}),
  z.object({type:z.literal('writeModule'),path:z.string(),source:z.string().min(1)}),
  z.object({type:z.literal('removeModule'),path:z.string()}),
  z.object({type:z.literal('addScene'),scene:sceneSchema}),
  z.object({type:z.literal('updateScene'),id:z.string(),patch:sceneSchema.omit({id:true}).partial()}),
  z.object({type:z.literal('removeScene'),id:z.string()}),
  z.object({type:z.literal('updateComponent'),id:z.string(),patch:componentSchema.omit({id:true}).partial()}),
  z.object({type:z.literal('removeComponent'),id:z.string()}),
  z.object({type:z.literal('forkScene'),id:z.string(),componentId:z.string(),entry:z.string()}),
])).min(1).max(100);
