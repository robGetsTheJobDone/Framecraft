import type {BrowserFileSystem} from '@deepbench/browser-filesystem';
import {captureFiles, validateFiles, writeFiles, type WorkspaceFiles} from './checkpoints.js';
import {isProjectModule} from './scene-session.js';

const journalPath='/.scene-transaction.json';
const activeTransactions=new Set<string>();
const localLocks=new Map<string,Promise<unknown>>();
async function withProjectLock<T>(key:string,action:()=>Promise<T>):Promise<T>{
  const locks=globalThis.navigator?.locks;if(locks)return locks.request(`framecraft-project-${key}`,{mode:'exclusive'},action);
  const previous=localLocks.get(key)??Promise.resolve();const next=previous.catch(()=>{}).then(action);localLocks.set(key,next);try{return await next;}finally{if(localLocks.get(key)===next)localLocks.delete(key);}
}
export const isRevisionFile=(path:string)=>path==='/project.json'||path==='/Ad.tsx'||path==='/plan.json'||path==='/component-library-lock.json'||isProjectModule(path)||path.startsWith('/assets/')||path.startsWith('/music/');
export async function revisionFiles(fs:BrowserFileSystem) {return captureFiles(fs,isRevisionFile);}
export function withProjectRevisionLock<T>(lockKey:string,action:()=>Promise<T>){return withProjectLock(lockKey,action);}
export function readRevisionSnapshot(fs:BrowserFileSystem,lockKey='default'){return withProjectLock(lockKey,()=>revisionFiles(fs));}
export async function revisionHash(files:WorkspaceFiles) {
  const bytes=new TextEncoder().encode(JSON.stringify([...files].sort((a,b)=>a.path.localeCompare(b.path))));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
const missing=(e:unknown)=>e instanceof Error&&'code'in e&&e.code==='ENOENT';
async function replace(fs:BrowserFileSystem,files:WorkspaceFiles) {
  // Dependencies first; project manifest last. Readers in this session are locked during commit.
  const manifest=files.filter(f=>f.path==='/project.json');
  await writeFiles(fs,files.filter(f=>f.path!=='/project.json'));
  await writeFiles(fs,manifest);
  const keep=new Set(files.map(f=>f.path));
  for(const old of await revisionFiles(fs))if(!keep.has(old.path))await fs.remove(old.path);
}
async function recoverUnlocked(fs:BrowserFileSystem, ownTransaction?:string) {
  let journal:{version:1;id?:string;before:WorkspaceFiles;history:string};
  try {journal=JSON.parse(new TextDecoder().decode(await fs.readFile(journalPath)));}catch(e){if(missing(e))return;throw e;}
  if(journal.id&&activeTransactions.has(journal.id)&&journal.id!==ownTransaction)throw new Error('A project commit is in progress; wait before reopening this session');
  if(journal.version!==1||typeof journal.history!=='string')throw new Error('Invalid scene transaction recovery journal');
  validateFiles(journal.before);
  if(journal.before.some(f=>!isRevisionFile(f.path)))throw new Error('Invalid scene transaction recovery path');
  await replace(fs,journal.before);await fs.writeFile('/history.json',journal.history);await fs.remove(journalPath);
}
export function recoverSceneTransaction(fs:BrowserFileSystem,lockKey='default'){return withProjectLock(lockKey,()=>recoverUnlocked(fs));}
/** Journaled multi-file transaction: a failed save rolls back; reopening rolls back an interrupted save. */
export async function commitSceneRevision(fs:BrowserFileSystem, before:WorkspaceFiles, after:WorkspaceFiles, previousHistory:string, nextHistory:string,lockKey='default') {
 return withProjectLock(lockKey,async()=>{
  if(await revisionHash(await revisionFiles(fs))!==await revisionHash(before))throw new Error('Project revision changed; reload before applying this edit');
  if(new TextDecoder().decode(await fs.readFile('/history.json'))!==previousHistory)throw new Error('Project history changed; reopen the session before applying this edit');
  const transaction=crypto.randomUUID();
  await fs.writeFile(journalPath,JSON.stringify({version:1,id:transaction,before,history:previousHistory}),{exclusive:true});
  activeTransactions.add(transaction);
  let changed=false;
  try {
    // Recheck after acquiring the workspace journal lock.
    if(await revisionHash(await revisionFiles(fs))!==await revisionHash(before))throw new Error('Project revision changed; reload before applying this edit');
    changed=true;await replace(fs,after);await fs.writeFile('/history.json',nextHistory);await fs.remove(journalPath);
  }catch(error) {
    // Preserve the journal if rollback fails; the next open will recover the previous complete revision.
    if(changed)await recoverUnlocked(fs,transaction);else await fs.remove(journalPath);throw error;
  }finally{activeTransactions.delete(transaction);}
 });
}
