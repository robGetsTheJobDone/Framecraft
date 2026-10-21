import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const bundle = await build({
  absWorkingDir: packageRoot,
  stdin: {
    contents: `
      import {createRoot} from 'react-dom/client';
      import {BrowserRemotionPlayer, titleCardComposition, exportComposition} from './src/index.tsx';
      const composition = {...titleCardComposition, width: 320, height: 180, durationInFrames: 3};
      createRoot(document.getElementById('root')).render(<BrowserRemotionPlayer composition={composition} />);
      exportComposition(composition, {format: 'webm'}).then(async blob => {
        window.result = {bytes: blob.size, type: blob.type, header: [...new Uint8Array(await blob.arrayBuffer()).slice(0, 4)]};
      }).catch(error => window.failure = error.stack);
    `,
    resolveDir: packageRoot,
    loader: 'tsx',
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"production"'},
  write: false,
});
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/bundle.js' ? bundle.outputFiles[0].contents : '<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.result || window.failure, undefined, {timeout: 120_000});
  const {result, failure} = await page.evaluate(() => ({result: window.result, failure: window.failure}));
  assert.equal(failure, undefined, failure);
  assert.ok(result.bytes > 100);
  assert.match(result.type, /^video\/webm/);
  assert.deepEqual(result.header, [0x1a, 0x45, 0xdf, 0xa3], 'WebM EBML header');
  await page.getByText('Made in your browser', {exact: true}).waitFor({state: 'attached'});
  assert.deepEqual(errors, []);
  console.log('Chromium preview and WebM export passed:', result);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
