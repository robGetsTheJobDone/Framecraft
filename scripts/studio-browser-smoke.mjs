import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({absWorkingDir: root, entryPoints: ['tests/browser/studio-fixture.tsx'], nodePaths: ['packages/browser-remotion/node_modules'], bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'}, write: false});
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/bundle.js' ? bundle.outputFiles[0].contents : '<!doctype html><html><head><meta charset="utf-8"><title>Studio integration</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
let page;
try {
  browser = await chromium.launch();
  page = await browser.newPage();
  page.on('pageerror', error => {
    console.error(error.stack);
    void page.evaluate(message => { window.studioError = message; }, error.stack).catch(() => {});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.studioReady || window.studioError, undefined, {timeout: 120_000});
  assert.equal(await page.evaluate(() => window.studioError), undefined);
  await page.getByLabel('Source video', {exact: true}).selectOption('source-clip');
  await page.getByLabel('Voiceover brief').fill('Introduce our video.');
  await page.getByRole('button', {name: 'Draft script', exact: true}).click();
  await page.getByLabel('Segment 1 script', {exact: true}).fill('User-reviewed voiceover.');
  assert.equal(await page.getByRole('button', {name: 'Generate speech', exact: true}).isDisabled(), true);
  await page.getByRole('button', {name: 'Approve script', exact: true}).click();
  await page.getByRole('button', {name: 'Generate speech', exact: true}).click();
  await page.getByLabel('Original video audio').selectOption('mute');
  await page.getByRole('button', {name: 'Add voiceover to timeline', exact: true}).click();
  await page.getByText('Voiceover saved to your project.', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Preview studio', exact: true}).click();
  await page.getByText('Preview ready', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Export studio video', exact: true}).click();
  await page.waitForFunction(() => window.studioResult || window.studioError, undefined, {timeout: 120_000});
  const {result, error} = await page.evaluate(() => ({result: window.studioResult, error: window.studioError}));
  assert.equal(error, undefined, error);
  assert.equal(result.script, 'User-reviewed voiceover.');
  assert.equal(result.scripts, 1);
  assert.equal(result.otherAssets, 0);
  assert.ok(result.revisions >= 4);
  assert.ok(result.bytes > 1000);
  assert.ok(result.audioPeak > 0.05, 'Video must contain audible mixed audio');
  assert.ok(result.audioDuration >= 0.95 && result.audioDuration <= 1.1);
  await page.reload();
  await page.waitForFunction(() => window.studioReady || window.studioError, undefined, {timeout: 30_000});
  assert.equal(await page.evaluate(() => window.studioError), undefined);
  assert.equal(await page.evaluate(() => window.studioReady.savedScripts), 1);
  console.log('Studio Chromium workflow passed: draft → edit → approve → synthesize → apply → mixed preview → video with audio → reload', result);
} catch (error) {
  console.error(await page?.locator('body').innerText());
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
