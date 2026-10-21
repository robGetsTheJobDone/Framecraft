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
let browser, server;
try {
 await build({stdin: {contents: `export {createAdSession,createZipFileAdapter,snapshotToZip,zipToSnapshot} from './packages/studio/portable/index.js'; export {MemoryFileSystem} from './packages/browser-filesystem/dist/index.js';`, resolveDir: root}, outfile: resolve(dir, 'test.js'), bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', loader: {'.ttf': 'file'}, define: {'process.env.NODE_ENV': '"production"'}});
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
  await session.save();
  const checkpoint = await checkpoints.read(session.projectId);
  const NativeWorker = window.Worker;
  let workers = 0;
  window.Worker = class extends NativeWorker {constructor(...args) {super(...args); workers++;}};
  try {
   const archive = await Promise.race([snapshotToZip(checkpoint.snapshot), new Promise((_,reject)=>setTimeout(()=>reject(new Error('Compression timed out')),15000))]);
   const compressionWorkers = workers;
   const restored = await Promise.race([zipToSnapshot(archive), new Promise((_,reject)=>setTimeout(()=>reject(new Error('Decompression timed out')),15000))]);
   const files = JSON.parse(await restored.snapshot.text()).files;
   const originalFiles = JSON.parse(await checkpoint.snapshot.text()).files;
   const identical = originalFiles.length === files.length && originalFiles.every(original => files.some(file => file.path === original.path && file.data === original.data));
   return {compressionWorkers,decompressionWorkers:workers-compressionWorkers,identical,projectId:restored.projectId,logoBytes:logo.length,largeBytes:large.length};
  } finally {window.Worker = NativeWorker;}
 }, logo.toString('base64'));
 assert.ok(result.compressionWorkers >= 2, 'Compression must use actual workers for both large entries');
 assert.ok(result.decompressionWorkers >= 1, 'Decompression must use an actual worker');
 assert.equal(result.identical, true, 'Every checkpoint file must roundtrip byte for byte');
 assert.equal(result.projectId, 'zip-regression');
 assert.deepEqual(errors, []);
 console.log('Production ZIP worker regression passed:', result);
} finally {
 await browser?.close();
 if (server) await new Promise(resolve => server.close(resolve));
 await rm(dir, {recursive:true,force:true});
}
