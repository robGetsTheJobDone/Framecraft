import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium,expect} from '@playwright/test';
const root=process.env.STUDIO_TEST_ROOT??fileURLToPath(new URL('../packages/studio-playground/',import.meta.url));
const require=createRequire(root+'/package.json');
const vite=await import(pathToFileURL(require.resolve('vite')).href);
const server=await vite.createServer({root,configFile:false,resolve:{alias:process.env.STUDIO_TEST_ROOT?[]:[{find:/^@deepbench\/studio$/,replacement:fileURLToPath(new URL('../packages/studio/portable/index.js',import.meta.url))},{find:'@deepbench/studio/styles.css',replacement:fileURLToPath(new URL('../packages/studio/portable/styles.css',import.meta.url))}]},logLevel:'error',server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen();let browser,page;const errors=[];
try {
 browser=await chromium.launch();page=await browser.newPage({viewport:{width:1440,height:1200}});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/scenes-test.html`);
 await page.waitForFunction(()=>window.sceneTest,{timeout:60000});
 const before=await page.evaluate(()=>window.sceneTest.capture(20));
 assert.deepEqual(before.background,[255,0,0,255]);assert.deepEqual(before.localClock,[0,255,255,255]);assert.deepEqual(before.authoredDuration,[255,255,255,255]);
 await page.getByRole('button',{name:'First scene',exact:true}).click();
 await page.getByLabel('Scene start',{exact:true}).fill('3');
 await page.getByRole('button',{name:'Apply scene changes',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>(await window.sceneTest.session.sceneState()).composition.scenes.find(s=>s.id==='first').startFrame)).toBe(30);
 assert.deepEqual(await page.evaluate(()=>window.sceneTest.capture(30)),before,'Move preserves local animation and authored duration');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>(await window.sceneTest.session.sceneState()).composition.scenes.find(s=>s.id==='first').startFrame)).toBe(20);
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>(await window.sceneTest.session.sceneState()).composition.scenes.find(s=>s.id==='first').startFrame)).toBe(30);
 // Publish through the UI, including a transitive shared helper, then pin the package.
 await page.getByText('Save or upgrade a project component',{exact:true}).click();
 await page.getByLabel('Project component',{exact:true}).selectOption('card');
 await page.getByLabel('Library component name',{exact:true}).fill('Shared card');
 await page.getByLabel('Library component ID',{exact:true}).fill('shared-card');
 await page.getByRole('button',{name:'Save to brand library',exact:true}).click();
 await page.getByText('Saved Shared card 1.0.0 to the library.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Search library',exact:true}).click();
 await page.getByRole('button',{name:/Shared card.*1.0.0/}).click();
 await page.getByRole('button',{name:'Insert saved version',exact:true}).click();
 await page.getByText('Added Shared card 1.0.0.',{exact:true}).waitFor();
 // The insertion event starts an asynchronous iframe rebuild. Check the actual
 // live Player rather than mistaking a temporary blank iframe for a rendered frame.
 const preview=page.frameLocator('.preview-area iframe[title="Ad composition"]');
 await expect(preview.getByRole('button',{name:'Play video',exact:true})).toBeVisible();
 await expect.poll(()=>preview.locator('.__remotion-player').evaluate(element=>Array.from(element.querySelectorAll('div')).some(node=>node.style.backgroundColor==='rgb(255, 0, 0)')).catch(()=>false),{timeout:30000}).toBe(true);
 await preview.getByRole('button',{name:'Play video',exact:true}).click();
 await expect.poll(()=>preview.locator('.__remotion-player').evaluate(element=>Array.from(element.querySelectorAll('div')).some(node=>node.style.backgroundColor==='rgb(0, 255, 255)'&&parseFloat(node.style.left)>0)).catch(()=>false),{timeout:30000}).toBe(true);
 await preview.getByRole('button',{name:'Pause video',exact:true}).click();
 const result=await page.evaluate(async()=>{
  const {session,importAdZip,MemoryFileSystem}=window.sceneTest;
  const before=await session.sceneState();const pins=await session.library.readPins();
  const zip=await session.downloadZip();const restored=await importAdZip(zip,{projectId:'restored-scenes',formats:[{id:'test',width:120,height:90}],adapters:{model:{},storage:new MemoryFileSystem()}});
  const after=await restored.sceneState();
  const input=(await restored.renderInputs())[0];
  const video=await restored.export({type:'webm'});
  return{scenes:after.composition.scenes.length,same:JSON.stringify(before.composition)===JSON.stringify(after.composition)&&JSON.stringify(before.modules)===JSON.stringify(after.modules),pins:pins.length,portable:!!input.modules,bytes:video.size};
 });
 assert.equal(result.scenes,3);assert.equal(result.same,true);assert.equal(result.pins,1);assert.equal(result.portable,true);assert.ok(result.bytes>100);
 await page.screenshot({path:'/tmp/framecraft-scenes-success.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Packaged scene editor: real frame clocks, timing UI, undo/redo, shared library save/insert, offline ZIP restoration and WebM export passed.',result);
}catch(error){console.error('Page errors:',errors);if(page){console.error((await page.locator('body').innerText()).slice(-6000));await page.screenshot({path:'/tmp/framecraft-scenes-failure.png',fullPage:true});}throw error;}finally{await browser?.close();await server.close();}
