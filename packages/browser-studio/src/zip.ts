import {zip, unzip, strToU8, strFromU8, type Zippable} from 'fflate';
import {normalizePath} from '@deepbench/browser-filesystem';
import {CheckpointConflictError, parseCheckpoint, validateFiles, type CheckpointAdapter, type WorkspaceFiles} from './checkpoints.js';
const limit=128*1024*1024;
const manifestName='deepbench.json';
const safe=(name:string)=>name===manifestName || (name.startsWith('workspace/') && !name.includes('\\') && !/[\x00-\x1f]/.test(name) && normalizePath('/'+name)==='/'+name && !name.endsWith('/'));
const base64=(bytes:Uint8Array)=>{let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);};

/** Ordinary ZIP entries: manifest plus raw workspace files, including run checkpoints. */
export async function snapshotToZip(snapshot:Blob):Promise<Blob>{
 if(snapshot.size>256*1024*1024)throw new Error('Checkpoint exceeds 256 MB');
 const document=JSON.parse(await snapshot.text());
 const files=await parseCheckpoint(snapshot,document.projectId);
 const entries:Zippable=Object.create(null);
 entries[manifestName]=strToU8(JSON.stringify({format:'deepbench-session',version:1,projectId:document.projectId}));
 let total=(entries[manifestName] as Uint8Array).length;
 for(const file of files){
  const name='workspace'+file.path;if(!safe(name))throw new Error('Invalid archive path');
  const bytes=Uint8Array.from(atob(file.data),c=>c.charCodeAt(0));total+=bytes.length;
  if(total>limit)throw new Error('ZIP workspace exceeds 128 MiB');
  entries[name]=bytes;
 }
 const data=await new Promise<Uint8Array>((resolve,reject)=>zip(entries,{level:3},(error,data)=>error?reject(error):resolve(data)));
 return new Blob([new Uint8Array(data)],{type:'application/zip'});
}
export async function zipToSnapshot(archive:Blob):Promise<{projectId:string;snapshot:Blob}>{
 if(!archive.size||archive.size>limit)throw new Error('ZIP must be nonempty and at most 128 MiB');
 let total=0,count=0;const names=new Set<string>();let invalid:Error|undefined;
 // Read the directory through the filter before allocating each decompressed file.
 const bytes=new Uint8Array(await archive.arrayBuffer());
 const data=await new Promise<Record<string,Uint8Array>>((resolve,reject)=>{
  try{unzip(bytes,{filter:file=>{
   total+=file.originalSize;count++;
   if(!safe(file.name)||names.has(file.name)||count>10001||total>limit){invalid=new Error('Invalid, duplicate, or oversized ZIP entries');return false;}
   names.add(file.name);return true;
  }},(error,result)=>error?reject(error):invalid?reject(invalid):resolve(result));}catch(error){reject(error);}
 });
 if(!data[manifestName])throw new Error('Not a DeepBench session ZIP');
 const manifest=JSON.parse(strFromU8(data[manifestName]));
 if(manifest.format!=='deepbench-session'||manifest.version!==1||typeof manifest.projectId!=='string'||!/^[A-Za-z0-9_-]+$/.test(manifest.projectId))throw new Error('Unsupported session ZIP manifest');
 const files:WorkspaceFiles=Object.entries(data).filter(([name])=>name!==manifestName).map(([name,bytes])=>({path:name.slice('workspace'.length),data:base64(bytes)}));
 validateFiles(files);
 if(!files.some(f=>f.path==='/project.json')||!files.some(f=>f.path==='/Ad.tsx'))throw new Error('ZIP is missing project files');
 const snapshot=new Blob([JSON.stringify({schemaVersion:1,projectId:manifest.projectId,files})],{type:'application/json'});
 await parseCheckpoint(snapshot,manifest.projectId);
 return {projectId:manifest.projectId,snapshot};
}

/** In-memory checkpoint adapter. Explicit ZIP export/import is the durable handoff. */
export function createZipFileAdapter(){
 const records=new Map<string,{snapshot:Blob;version:string}>();
 const adapter:CheckpointAdapter={
  async read(id){const record=records.get(id);return record?{...record}:null;},
  async save(id,snapshot,{expectedVersion,signal}){
   signal?.throwIfAborted();
   if((records.get(id)?.version??null)!==expectedVersion)throw new CheckpointConflictError();
   const version=crypto.randomUUID();records.set(id,{snapshot,version});return {version};
  },
 };
 return {...adapter,
  async importZip(file:Blob){const {projectId,snapshot}=await zipToSnapshot(file);if(records.has(projectId))throw new Error('Use a fresh ZIP adapter to import this project');records.set(projectId,{snapshot,version:crypto.randomUUID()});return projectId;},
  async exportZip(projectId:string){const saved=records.get(projectId);if(!saved)throw new Error('Save the session before exporting ZIP');return snapshotToZip(saved.snapshot);},
 };
}
