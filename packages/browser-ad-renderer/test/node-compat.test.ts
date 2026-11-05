import {describe,it,expect} from 'vitest';
import {createNodeCompatibility} from '../src/node-compat.js';
import {createReadOnlyFileSystem} from '../src/node-filesystem.js';
import {resolveNodeBuiltin,needsNodeCompatibility,needsNodeFilesystem} from '../src/node-builtins.js';
const files=[{path:'/data/message.txt',data:Buffer.from('Bonjour 世界').toString('base64')},{path:'/data/nested/value.bin',data:'AAH/'}];
describe('sandbox Node compatibility',()=>{
 it('provides binary buffers, events, POSIX paths, util and strict assertions',async()=>{
  const runtime=createNodeCompatibility();const {Buffer:B}=runtime.require('node:buffer');
  expect(B.from('hello').toString('base64')).toBe('aGVsbG8=');expect(B.from([0,255]).readUInt16BE(0)).toBe(255);
  expect(runtime.Buffer).toBe(B);expect(runtime.require('buffer')).toBe(runtime.require('node:buffer'));
  const events=runtime.require('events');const emitter=new events.EventEmitter();let value=0;
  emitter.once('change',(n:number)=>value=n);emitter.emit('change',4);emitter.emit('change',9);expect(value).toBe(4);
  const path=runtime.require('path');expect(path.resolve('data','../assets/a.png')).toBe('/assets/a.png');expect(path.relative('/assets','/data/a')).toBe('../data/a');expect(path.posix).toBe(path);
  const util=runtime.require('util');expect(util.format('%s: %d','value',7)).toBe('value: 7');
  expect(await util.promisify((x:number,cb:Function)=>cb(null,x*2))(3)).toBe(6);
  const assert=runtime.require('assert/strict');assert.deepEqual({a:[1]},{a:[1]});expect(()=>assert.equal('1',1)).toThrow();
 });
 it('limits process to a browser environment and schedules nextTick arguments',async()=>{
  const runtime=createNodeCompatibility();const p=runtime.require('process');
  expect(p).toBe(runtime.process);expect(p.cwd()).toBe('/');expect(p.env).toEqual({NODE_ENV:'production'});expect(p.platform).toBe('browser');
  expect(()=>p.chdir('/tmp')).toThrow('unavailable');expect(()=>p.exit()).toThrow('unavailable');
  const calls:string[]=[];p.nextTick((arg:string)=>calls.push(arg),'tick');calls.push('sync');await Promise.resolve();expect(calls).toEqual(['sync','tick']);
  expect(()=>runtime.require('node:child_process')).toThrow('Unsupported Node module');
 });
 it('normalizes only known CDN builtins and detects compatibility without loading it for ordinary scenes',()=>{
  expect(resolveNodeBuiltin('/node/fs/promises.mjs')).toBe('node:fs/promises');expect(resolveNodeBuiltin('https://esm.sh/node/buffer.mjs')).toBe('node:buffer');
  for(const id of ['node:net','https://evil.example/node/fs.mjs','/node/fs.mjs?x','path/win32'])expect(resolveNodeBuiltin(id)).toBeUndefined();
  expect(needsNodeCompatibility('const a = React.createElement("div");')).toBe(false);
  expect(needsNodeCompatibility('require("node:fs")')).toBe(true);expect(needsNodeCompatibility('Buffer.from("a")')).toBe(true);
  expect(needsNodeFilesystem('import fs from "/node/fs.mjs"')).toBe(true);
 });
});
describe('read-only render filesystem snapshot',()=>{
 it('reads equivalent bytes through sync, callback and promise APIs with isolated copies',async()=>{
  const snapshot=structuredClone(files);const fs=createReadOnlyFileSystem(snapshot);
  expect(fs.readFileSync('/data/message.txt','utf8')).toBe('Bonjour 世界');
  expect(await fs.promises.readFile(new URL('file:///data/message.txt'),{encoding:'utf8'})).toBe('Bonjour 世界');
  const callback=await new Promise((resolve,reject)=>fs.readFile('data/message.txt','utf8',(err:unknown,data:string)=>err?reject(err):resolve(data)));
  expect(callback).toBe('Bonjour 世界');
  const bytes=fs.readFileSync('/data/nested/value.bin');bytes.fill(0);snapshot[1].data='';
  expect([...await fs.promises.readFile('/data/nested/value.bin')]).toEqual([0,1,255]);
 });
 it('provides directory entries, file stats and Node-style missing/directory errors',async()=>{
  const fs=createReadOnlyFileSystem(files);expect(fs.readdirSync('/data')).toEqual(['message.txt','nested']);
  const entries=await fs.promises.readdir('/data',{withFileTypes:true});expect(entries[0].isFile()).toBe(true);expect(entries[1].isDirectory()).toBe(true);
  expect(fs.statSync('/data/nested/value.bin').size).toBe(3);expect(fs.statSync('/data').isDirectory()).toBe(true);
  expect(fs.statSync('/missing',{throwIfNoEntry:false})).toBeUndefined();expect(fs.existsSync('/missing')).toBe(false);
  await expect(fs.promises.readFile('/missing')).rejects.toMatchObject({code:'ENOENT'});
  expect(()=>fs.readFileSync('/data')).toThrow('EISDIR');expect(()=>fs.readdirSync('/data/message.txt')).toThrow('ENOTDIR');
  expect(()=>fs.statSync('/data/message.txt/child')).toThrow('ENOTDIR');
 });
 it('rejects writes, escaping paths, host files and unsupported operations',async()=>{
  const fs=createReadOnlyFileSystem(files);
  expect(()=>fs.readFileSync('../../etc/passwd')).toThrow('EACCES');expect(()=>fs.readFileSync('/etc/passwd')).toThrow('ENOENT');
  expect(()=>fs.readFileSync('C:\\file')).toThrow('EINVAL');expect(()=>fs.readFileSync(new URL('file://host/data/message.txt'))).toThrow('EINVAL');
  expect(()=>fs.writeFileSync('/data/message.txt','bad')).toThrow('EROFS');
  await expect(fs.promises.unlink('/data/message.txt')).rejects.toMatchObject({code:'EROFS'});
  await new Promise<void>(resolve=>fs.writeFile('/data/new.txt','bad',(err:any)=>{expect(err.code).toBe('EROFS');resolve();}));
  expect(()=>fs.accessSync('/data/message.txt',fs.constants.W_OK)).toThrow('EROFS');
  expect(()=>fs.watch('/data')).toThrow('ERR_NOT_IMPLEMENTED');expect(()=>fs.readFileSync('/data/message.txt',{flag:'r+'})).toThrow('EROFS');
  expect(fs.readFileSync('/data/message.txt','utf8')).toBe('Bonjour 世界');
 });
 it('checks abort signals and rejects malformed or conflicting snapshots',async()=>{
  const fs=createReadOnlyFileSystem(files);const controller=new AbortController();controller.abort();
  await expect(fs.promises.readFile('/data/message.txt',{signal:controller.signal})).rejects.toThrow();
  for(const snapshot of [[{path:'/../secret',data:''}],[{path:'/a',data:'!bad'}],[{path:'/a',data:''},{path:'/a/b',data:''}],[...files,files[0]]])expect(()=>createReadOnlyFileSystem(snapshot)).toThrow();
 });
});
