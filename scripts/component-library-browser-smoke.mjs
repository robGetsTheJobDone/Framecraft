// Exercise the actual split/minified browser module shape, then consumer rebundling.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=await mkdtemp(join(tmpdir(),'framecraft-library-browser-'));
const source=`import {prepareComponentRelease,createMemoryComponentLibrary,materializeComponentRelease} from './packages/browser-studio/src/component-library.ts';
try {
  const release=await prepareComponentRelease({componentId:'card',version:'1.0.0',name:'Card',component:{id:'card',entry:'/scenes/Card.tsx',authoredDurationInFrames:30},modules:{'/scenes/Card.tsx':${JSON.stringify("import label from '../shared/label'; export default function Card(){return <div style={{transform:`translateX(${({x:1}).x}px)`}}>It's {label}</div>} ")},'/shared/label.ts':'export default "portable";'},preview:{dataUrl:'data:image/png;base64,AAAA',props:{},width:120,height:90,fps:30,frame:0}});
  const adapter=createMemoryComponentLibrary({workspaceId:'brand'});
  await adapter.publish({workspaceId:'brand',release,idempotencyKey:'save',authorized:true});
  const fetched=await adapter.get({workspaceId:'brand',componentId:'card',version:'1.0.0'});
  const local=await materializeComponentRelease(fetched);
  window.libraryResult={ok:true,moduleCount:Object.keys(local.modules).length,version:local.pin.version,hash:local.pin.hash};
}catch(error){window.libraryResult={ok:false,error:String(error),stack:error.stack};}`;
let browser,server;
try {
  const buildOptions={bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,keepNames:false};
  await build({...buildOptions,stdin:{contents:source,resolveDir:root,sourcefile:'entry.ts',loader:'ts'},outdir:join(output,'package')});
  await build({...buildOptions,entryPoints:{entry:join(output,'package/stdin.js')},outdir:join(output,'consumer')});
  server=createServer(async(request,response)=>{
    try{
      const path=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      if(path==='/'||path==='/consumer.html'){const entry=path==='/'?'/package/stdin.js':'/consumer/entry.js';response.setHeader('Content-Type','text/html');response.end(`<script type="module" src="${entry}"></script>`);return;}
      const file=resolve(output,'.'+path);if(!file.startsWith(output+'/')){response.writeHead(403);response.end();return;}
      response.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':'application/octet-stream');response.end(await readFile(file));
    }catch{response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch();
  for(const path of ['/','/consumer.html']){
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}${path}`);await page.waitForFunction(()=>window.libraryResult);
    const result=await page.evaluate(()=>window.libraryResult);
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.moduleCount,2);assert.equal(result.version,'1.0.0');assert.match(result.hash,/^[a-f0-9]{64}$/);assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Component library split production bundle and consumer rebundle: TSX parser, extraction, publication, fetch and materialization passed.');
}finally{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());await rm(output,{recursive:true,force:true});}
