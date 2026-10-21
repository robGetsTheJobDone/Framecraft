import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

// Exercise the actual portable package after a second, production consumer build.
const root = resolve(import.meta.dirname, '..');
const dir = await mkdtemp(resolve(tmpdir(), 'framecraft-zip-'));
// Source mode is useful while another agent is rebuilding the public package.
// The default always verifies the real portable artifact after consumer bundling.
const entry=process.env.ZIP_SMOKE_SOURCE==='1'?'./packages/browser-studio/src/index.ts':'./packages/studio/portable/index.js';
let browser, server;
try {
 await build({stdin: {contents: `export {createAdSession,createZipFileAdapter,snapshotToZip,zipToSnapshot} from '${entry}'; export {MemoryFileSystem} from './packages/browser-filesystem/dist/index.js';`, resolveDir: root}, outfile: resolve(dir, 'test.js'), bundle: true, minify: true, keepNames:false, format: 'esm', platform: 'browser', target: 'es2022', loader: {'.ttf': 'file'}, define: {'process.env.NODE_ENV': '"production"'}});
 server = createServer(async (req, res) => {
  if (req.url === '/test.js') {res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(resolve(dir, 'test.js')));}
  else res.end('<!doctype html><title>ZIP production regression</title>');
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 browser = await chromium.launch();
 const page = await browser.newPage();
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const logo = await readFile(resolve(root, 'packages/studio-playground/src/assets/pierogi-logo.png'));
 assert.ok(logo.length > 160000, 'Real logo must exercise compression worker threshold');
 const result = await page.evaluate(async logoBase64 => {
  const {createAdSession,createZipFileAdapter,snapshotToZip,zipToSnapshot,MemoryFileSystem} = await import('/test.js');
  const checkpoints = createZipFileAdapter();
  const session = await createAdSession({projectId:'zip-regression',adapters:{model:{},storage:new MemoryFileSystem(),checkpoints}});
  const logo = Uint8Array.from(atob(logoBase64), c => c.charCodeAt(0));
  await session.addAssets([{metadata:{id:'pierogi',kind:'image',mimeType:'image/png'},data:logo}]);
  // fflate only dispatches decompression to a worker for >=512 KiB entries
  // whose compressed size is <=80% of the original. A PNG alone misses this.
  const large = new Uint8Array(768 * 1024).fill(65);
  await session.workspace.writeFile('/large.bin', large);
  // Recovery files embed base64 audio in their candidate, then checkpoint capture
  // base64-encodes the JSON again. The old repeated-group validation regexp
  // overflows V8's stack on this size before ZIP compression even starts.
  const recovery=JSON.stringify({schemaVersion:1,runId:'recovered',candidate:[{path:'/assets/music.wav',data:'AAAA'.repeat(14*1024*1024/4)}],cursor:{phase:'designing',messages:[]}});
  await session.workspace.writeFile('/runs/recovered/checkpoints/state.json',new TextEncoder().encode(recovery),{createParents:true});
  await session.save();
  const checkpoint = await checkpoints.read(session.projectId);
  const NativeWorker = window.Worker;
  let workers = 0;
  window.Worker = class extends NativeWorker {constructor(...args) {super(...args); workers++;}};
  try {
   const archive = await Promise.race([snapshotToZip(checkpoint.snapshot), new Promise((_,reject)=>setTimeout(()=>reject(new Error('Compression timed out')),30000))]);
   const compressionWorkers = workers;
   const restored = await Promise.race([zipToSnapshot(archive), new Promise((_,reject)=>setTimeout(()=>reject(new Error('Decompression timed out')),30000))]);
   const files = JSON.parse(await restored.snapshot.text()).files;
   const originalFiles = JSON.parse(await checkpoint.snapshot.text()).files;
   const identical = originalFiles.length === files.length && originalFiles.every(original => files.some(file => file.path === original.path && file.data === original.data));
   const recovered=files.find(file=>file.path==='/runs/recovered/checkpoints/state.json');
   return {compressionWorkers,decompressionWorkers:workers-compressionWorkers,identical,recoveryIdentical:atob(recovered.data)===recovery,projectId:restored.projectId,logoBytes:logo.length,largeBytes:large.length,recoveryBytes:recovery.length,checkpointBytes:checkpoint.snapshot.size};
  } finally {window.Worker = NativeWorker;}
 }, logo.toString('base64'));
 assert.ok(result.compressionWorkers >= 3, 'Compression must use actual workers for all large entries');
 assert.ok(result.decompressionWorkers >= 2, 'Decompression must use workers for both large compressible entries');
 assert.equal(result.identical, true, 'Every checkpoint file must roundtrip byte for byte');
 assert.equal(result.recoveryIdentical,true,'Large nested recovery JSON must roundtrip exactly');
 assert.ok(result.recoveryBytes>=14*1024*1024,'Recovery fixture must cover the failing user file size');
 assert.equal(result.projectId, 'zip-regression');
 assert.deepEqual(errors, []);
 console.log('Production ZIP worker regression passed:', result);
} finally {
 await browser?.close();
 if (server) await new Promise(resolve => server.close(resolve));
 await rm(dir, {recursive:true,force:true});
}
