import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const bundle=await build({absWorkingDir:root,entryPoints:['packages/browser-ad-renderer/test/scene-browser.ts'],bundle:true,write:false,platform:'browser',format:'esm',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
const wasm=await readFile(new URL('../dist/esbuild.wasm',import.meta.url));
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/esbuild.wasm'?'application/wasm':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].contents:req.url==='/esbuild.wasm'?wasm:'<!doctype html><body><script type="module" src="/bundle.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try {
 browser=await chromium.launch();const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.runScenes);
 const result=await page.evaluate(()=>window.runScenes());
 assert.deepEqual(result.snapshot,[0,255,0,255],'render snapshots caller data before asynchronous compilation');
 assert.deepEqual(result.trim,[0,255,0,255],'trim must preserve authored duration and source clock');
 assert.deepEqual(result.move,[0,255,0,255],'moving must preserve source clock');
 assert.deepEqual(result.dependency,[0,0,255,255],'shared helper edits must invalidate compiled graph');
 assert.deepEqual(result.localSeek,[0,255,0,255],'direct seeking must advance local source frame');
 assert.deepEqual(result.nested,[0,255,0,255],'nested sequences retain their own duration and local clock');
 assert.deepEqual(result.alias,[0,255,0,255],'library asset aliases resolve to project assets');
 assert.deepEqual(result.legacyGlobals,[0,255,0,255],'legacy modules retain implicit React and Remotion globals');
 assert.deepEqual(result.memo,[0,255,0,255],'memo/forwardRef scene exports are valid React components');
 assert.ok(result.reviewTimes.includes(3/30)&&result.reviewTimes.includes(4/30),'review samples short scene boundaries');
 assert.ok(result.bytes>100,'production export encodes structured scene graph');
 console.log('Production scene browser checks passed',result);
}finally{await browser?.close();await new Promise(r=>server.close(r));}
