// Build and serve a production-package regression page. No model calls.
// Open the printed URL; the page reports assertions and performs a real CDN install.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['scripts/packages-browser-entry.ts'],bundle:true,write:false,platform:'browser',format:'esm',minify:true,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'}});
const wasm=await readFile('packages/studio/portable/esbuild.wasm');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':req.url==='/esbuild.wasm'?'application/wasm':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].contents:req.url==='/esbuild.wasm'?wasm:'<!doctype html><meta charset="utf-8"><title>Framecraft packages</title><h1>Framecraft package regression</h1><pre id="status">Running package checks…</pre><div id="preview" style="width:320px"></div><script type="module" src="/bundle.js"></script>');});
await new Promise(resolve=>server.listen(Number(process.env.PORT??5201),'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
console.log(`Package check: ${url}`);
if(process.argv.includes('--check')){
 const {chromium}=await import('@playwright/test');let browser;
 try {
  browser=await chromium.launch({args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(()=>/ALL PACKAGE CHECKS PASSED|FAIL /.test(document.querySelector('#status').textContent),{},{timeout:180000});
  const status=await page.locator('#status').innerText();console.log(status);
  await page.screenshot({path:'/tmp/framecraft-packages-check.png',fullPage:true});
  if(status.includes('FAIL ')||errors.length)throw new Error([status,...errors].join('\n'));
 } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
