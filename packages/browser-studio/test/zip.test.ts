import {it,expect} from 'vitest';
import {zipSync,strToU8,unzipSync} from 'fflate';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createAdSession,importAdZip,restoreAdSession} from '../src/ad-session.js';
import {createZipFileAdapter,zipToSnapshot} from '../src/zip.js';
import {CheckpointConflictError} from '../src/checkpoints.js';
const model={} as BaseChatModel;
it('roundtrips raw binary assets/context through a real ZIP into an isolated conversation',async()=>{
 const storage=new MemoryFileSystem();
 const session=await createAdSession({projectId:'original',adapters:{model,storage},context:{files:{'Product.tsx':'export const product="Booking";'}}});
 await session.addAssets([{metadata:{id:'image',kind:'image',mimeType:'image/png'},data:new Uint8Array([0,1,128,255])}]);
 const zip=await session.downloadZip();
 expect(Array.from(new Uint8Array(await zip.slice(0,2).arrayBuffer()))).toEqual([80,75]);
 const entries=unzipSync(new Uint8Array(await zip.arrayBuffer()));
 expect(entries['workspace/assets/image']).toEqual(new Uint8Array([0,1,128,255]));
 const imported=await importAdZip(zip,{projectId:'copy',adapters:{model,storage}});
 expect(await imported.workspace.read('/context/product/Product.tsx')).toContain('Booking');
 expect(await imported.workspace.readFile('/assets/image')).toEqual(new Uint8Array([0,1,128,255]));
 await expect(imported.workspace.write('/context/product/Product.tsx','bad')).rejects.toThrow('read-only');
 await expect(importAdZip(zip,{projectId:'original',adapters:{model,storage}})).rejects.toThrow('empty');
 expect((await session.store.load()).assets).toHaveLength(1);
});
it('stages adapter checkpoints without downloads, exports/imports ZIP and enforces versions',async()=>{
 const adapter=createZipFileAdapter();
 const session=await createAdSession({projectId:'portable',adapters:{model,storage:new MemoryFileSystem(),checkpoints:adapter}});
 await session.save();const first=await adapter.read('portable');
 await session.save();
 await expect(adapter.save('portable',first!.snapshot,{expectedVersion:first!.version})).rejects.toBeInstanceOf(CheckpointConflictError);
 const fresh=createZipFileAdapter();expect(await fresh.importZip(await adapter.exportZip('portable'))).toBe('portable');
 const restored=await restoreAdSession({projectId:'portable',adapters:{model,storage:new MemoryFileSystem(),checkpoints:fresh}});
 expect(await restored.workspace.read('/Ad.tsx')).toBe(await session.workspace.read('/Ad.tsx'));
});
it('rejects traversal and unrelated ZIPs before restoring anything',async()=>{
 const bad=zipSync({'../escape':strToU8('oops')});
 await expect(zipToSnapshot(new Blob([new Uint8Array(bad)]))).rejects.toThrow('Invalid');
 await expect(zipToSnapshot(new Blob([new Uint8Array(zipSync({'other.txt':strToU8('x')}))]))).rejects.toThrow();
});
