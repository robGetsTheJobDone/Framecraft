import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
// These nodePaths resolve the fixture's imports using the packages' own dependencies.
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ['tests/browser/fixture.tsx'],
  nodePaths: ['packages/browser-remotion/node_modules', 'packages/browser-deepagents/node_modules'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  write: false,
});
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/bundle.js' ? bundle.outputFiles[0].contents
    : '<!doctype html><html><head><meta charset="utf-8"><title>DeepBench browser smoke</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => {
    errors.push(error.message);
    console.error('Browser runtime error:', error.stack);
    void page.evaluate(message => { window.smokeError = message; }, error.stack).catch(() => {});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await page.reload();
    await page.waitForFunction(() => window.smokeResult || window.smokeError, undefined, { timeout: 120_000 });
    const { result, error } = await page.evaluate(() => ({ result: window.smokeResult, error: window.smokeError }));
    assert.equal(error, undefined, error);
    assert.equal(result.persisted, pass === 1, 'IndexedDB must persist across reload');
    assert.equal(result.lastMessage, 'Composition ready');
    assert.equal(result.title, 'Browser agent video');
    assert.ok(result.bytes > 100, 'Export should contain encoded video');
    assert.deepEqual(result.header, [0x1a, 0x45, 0xdf, 0xa3], 'WebM EBML header');
    assert.match(result.type, /^video\/webm/);
    await page.getByText('Browser agent video', { exact: true }).waitFor({ state: 'attached' });
    console.log(`Browser pass ${pass + 1}: agent → IndexedDB → Remotion preview/export (${result.bytes} bytes), persisted=${result.persisted}`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
