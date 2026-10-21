import {describe,it,expect} from 'vitest';
import {build} from 'esbuild';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareContextFiles,mountContextFiles,contextFileManifest,searchContextFiles} from '../src/context-files.js';
import {loadContextFiles} from '../src/node.js';

describe('product context files',()=>{
 it('accepts eager Vite raw maps and excludes sensitive paths',()=>{
  expect({...prepareContextFiles({files:{'/src/App.tsx':'hello','./README.md':'docs','.env.local':'secret','node_modules/foo.ts':'dependency','cert.key':'key'}})}).toEqual({'/context/product/src/App.tsx':'hello','/context/product/README.md':'docs'});
  expect(()=>prepareContextFiles({files:{'../escape':'bad'}})).toThrow('Invalid context path');
  expect(()=>prepareContextFiles({files:{'/a':'x','a':'y'}})).toThrow('Duplicate');
  expect(()=>prepareContextFiles({namespace:'../bad',files:{}})).toThrow('namespace');
  expect(()=>prepareContextFiles({files:{['a'.repeat(513)]:'x'}})).toThrow('Invalid context path');
  expect(()=>prepareContextFiles({files:{'big':'x'.repeat(512*1024+1)}})).toThrow('512 KiB');
 });
 it('mounts pinned readable references and guards writes, directory removal, and normalized paths',async()=>{
  const raw=new MemoryFileSystem();
  const context={files:{'App.tsx':'const Booking = () => null;\nexport default Booking;'}};
  const fs=await mountContextFiles(raw,context);
  expect(new TextDecoder().decode(await fs.readFile('/context/product/App.tsx'))).toContain('Booking');
  await expect(fs.writeFile('/context/product/App.tsx','changed')).rejects.toThrow('read-only');
  await expect(fs.writeFile('/somewhere/../context/product/App.tsx','changed')).rejects.toThrow('read-only');
  await expect(fs.remove('/',{recursive:true})).rejects.toThrow('read-only');
  await expect(fs.mkdir('/context/new')).rejects.toThrow('read-only');
  await fs.writeFile('/Ad.tsx','editable');
  await expect(mountContextFiles(raw,context)).resolves.toBeDefined();
  await expect(mountContextFiles(raw,{files:{'App.tsx':'changed'}})).rejects.toThrow('Context changed');
  await expect(mountContextFiles(raw,{files:{'App.tsx':context.files['App.tsx'],'Other.ts':'new'}})).rejects.toThrow('inventory');
  expect(await contextFileManifest(fs)).toContain('/context/product/App.tsx');
  expect(await searchContextFiles(fs,'booking',1)).toEqual([{path:'/context/product/App.tsx',line:1,text:'const Booking = () => null;'}]);
  await expect(raw.stat('/context/product/Other.ts')).rejects.toMatchObject({code:'ENOENT'});
  await expect(mountContextFiles(raw,{files:{}})).rejects.toThrow('inventory');
  expect(new TextDecoder().decode(await fs.readFile('/context/product/App.tsx'))).toBe(context.files['App.tsx']);
  const restored=await mountContextFiles(raw);
  await expect(restored.remove('/context',{recursive:true})).rejects.toThrow('read-only');
 });
 it('keeps Node-only APIs outside the browser bundle',async()=>{
  const result=await build({entryPoints:['src/context-files.ts'],bundle:true,write:false,platform:'browser',format:'esm',metafile:true});
  expect(Object.keys(result.metafile!.inputs).some(path=>path.endsWith('/node.ts'))).toBe(false);
  expect(result.outputFiles[0].text).not.toContain('node:fs');
 });
 it('loads a bounded Node bundle without following symlinks or importing excluded files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'deepbench-context-'));
  try {
   await mkdir(join(root,'src'));await mkdir(join(root,'node_modules'));
   await writeFile(join(root,'src','App.tsx'),'export const App=()=>null;');
   await writeFile(join(root,'src','App.test.tsx'),'test');
   await writeFile(join(root,'.env'),'never');
   await writeFile(join(root,'node_modules','secret.ts'),'never');
   await writeFile(join(root,'README.md'),'docs');
   await symlink(join(root,'README.md'),join(root,'linked.md'));
   expect({...await loadContextFiles({root,include:['**/*.{tsx,md}'],exclude:['**/*.test.*']})}).toEqual({'README.md':'docs','src/App.tsx':'export const App=()=>null;'});
   await expect(loadContextFiles({root,maxFiles:1})).rejects.toThrow('maxFiles');
   await expect(loadContextFiles({root,maxFileBytes:3})).rejects.toThrow('maxFileBytes');
   await expect(loadContextFiles({root,maxTotalBytes:2})).rejects.toThrow('maxTotalBytes');
   await writeFile(join(root,'binary.txt'),new Uint8Array([0,1,2]));
   await expect(loadContextFiles({root})).rejects.toThrow('binary');
  } finally {await rm(root,{recursive:true,force:true});}
 });
});
