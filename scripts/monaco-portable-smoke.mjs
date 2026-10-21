import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
const require = createRequire(new URL('../packages/studio-playground/package.json', import.meta.url));
const vite = await import(pathToFileURL(require.resolve('vite')).href);
const server = await vite.createServer({root: fileURLToPath(new URL('../packages/studio-playground/', import.meta.url)), resolve: {alias: [
  {find: /^@deepbench\/studio$/, replacement: fileURLToPath(new URL('../packages/studio/portable/index.js', import.meta.url))},
  {find: '@deepbench/studio/styles.css', replacement: fileURLToPath(new URL('../packages/studio/portable/styles.css', import.meta.url))},
]}, logLevel: 'error', server: {host: '127.0.0.1', port: 5184, strictPort: true, hmr: false}});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {if (/Could not create web worker/.test(message.text())) errors.push(message.text());});
  await page.goto('http://127.0.0.1:5184/embed-test.html');
  await page.getByRole('heading', {name: 'Untitled film', exact: true}).waitFor();
  await page.evaluate(() => window.testSession.workspace.write('/brief.md', 'Packaged editor'));
  await page.getByRole('button', {name: 'Files', exact: true}).click();
  await page.getByRole('heading', {name: '/Ad.tsx', exact: true}).waitFor();
  await page.getByRole('button', {name: '/brief.md', exact: true}).click();
  await page.getByRole('heading', {name: '/brief.md', exact: true}).waitFor();
  await page.getByLabel('File contents').waitFor();
  await page.getByLabel('File contents').focus();
  await page.getByLabel('File contents').press('ControlOrMeta+a');
  await page.keyboard.insertText('Saved with packaged Monaco');
  await page.getByLabel('File contents').press('ControlOrMeta+s');
  await page.waitForFunction(async () => await window.testSession.workspace.read('/brief.md') === 'Saved with packaged Monaco');
  assert.equal(await page.evaluate(() => window.testSession.workspace.read('/brief.md')), 'Saved with packaged Monaco');
  const workerReply = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = globalThis.MonacoEnvironment.getWorker('editorWorkerService', 'editorWorkerService');
    const timeout = setTimeout(() => {worker.terminate(); reject(new Error('Local editor worker did not respond'));}, 10000);
    worker.onerror = event => {clearTimeout(timeout); worker.terminate(); reject(new Error(event.message));};
    worker.onmessage = event => {clearTimeout(timeout); worker.terminate(); resolve(event.data);};
    worker.postMessage('initialize');
    worker.postMessage({vsWorker: 1, type: 0, req: '1', channel: 'default', method: '$initialize', args: [1]});
  }));
  assert.equal(workerReply.seq, '1');
  assert.equal(workerReply.err, undefined);
  assert.deepEqual(errors, []);
  await page.locator('.studio-files-mode').screenshot({path: '/tmp/deepbench-monaco-portable.png'});
  await page.getByRole('button', {name: 'Watch changes', exact: true}).click();
  assert.equal(await page.getByRole('switch', {name: 'Watch file changes'}).isChecked(), false);
  assert.equal(await page.getByLabel('File contents').count(), 0);
  await page.locator('.studio-files-mode').screenshot({path: '/tmp/deepbench-watch-portable.png'});
  console.log('Packaged Monaco: lazy load, keyboard save, local worker RPC, and error-free embedding passed.');
} finally {await browser.close(); await server.close();}
