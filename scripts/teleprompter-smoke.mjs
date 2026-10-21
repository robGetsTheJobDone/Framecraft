import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../packages/studio-playground/',import.meta.url));
const require=createRequire(new URL('../packages/studio-playground/package.json',import.meta.url));
const vite=await import(pathToFileURL(require.resolve('vite')).href);
const server=await vite.createServer({root,logLevel:'error',server:{hmr:false,host:'127.0.0.1',port:5182,strictPort:true}});await server.listen();
const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try{
 const page=await browser.newPage({permissions:['microphone'],viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{window.micStreams=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.micStreams.push(stream);return stream;};});
 await page.goto('http://127.0.0.1:5182/embed-test.html?teleprompter=1');
 await page.getByRole('button',{name:/! Read these lines/}).click();
 await page.getByRole('button',{name:'Open teleprompter',exact:true}).click();
 assert.equal(await page.getByText('Hello there.',{exact:true}).count(),1);
 await page.getByRole('button',{name:'Record line',exact:true}).click();
 await page.getByRole('button',{name:'Stop recording',exact:true}).waitFor();await page.waitForTimeout(400);
 await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await page.getByLabel('Recorded line playback').waitFor();
 await page.getByRole('button',{name:'Retake line',exact:true}).click();
 await page.getByRole('button',{name:'Stop recording',exact:true}).waitFor();await page.waitForTimeout(400);
 await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await page.getByRole('button',{name:'Next line',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('audio[aria-label="Recorded line playback"]') && ![...document.querySelectorAll('button')].find(b=>b.textContent==='Next line').disabled);
 await page.getByRole('button',{name:'Next line',exact:true}).click();
 await page.getByRole('button',{name:'Record line',exact:true}).click();await page.getByRole('button',{name:'Stop recording',exact:true}).waitFor();await page.waitForTimeout(400);await page.getByRole('button',{name:'Stop recording',exact:true}).click();
 await page.getByRole('button',{name:'Add recordings to timeline',exact:true}).click();
 await page.getByRole('dialog',{name:'Voiceover teleprompter'}).waitFor({state:'hidden'});
 const result=await page.evaluate(async()=>{
  const project=await window.testSession.store.load();const track=project.tracks.find(t=>t.id==='voiceover');
  return {clips:track.clips,pending:project.tracks.flatMap(t=>t.clips).filter(c=>c.kind==='voiceover').length,scripts:project.dubbingScripts,stopped:window.micStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))};
 });
 assert.equal(result.clips.length,2);assert.equal(result.pending,0);assert.equal(result.stopped,true);assert.equal(result.clips[0].startSeconds,0);assert.equal(result.clips[1].startSeconds,result.clips[0].durationSeconds);assert.equal(result.scripts[0].segments[1].text,'Welcome to our studio.');
 // Real decode/export, no speech-provider calls.
 const exported=await page.evaluate(async()=>{const blob=await window.testSession.export({type:'mp4'});const context=new AudioContext();const audio=await context.decodeAudioData(await blob.arrayBuffer());await context.close();return {bytes:blob.size,duration:audio.duration};});
 assert.ok(exported.bytes>100);assert.ok(exported.duration>0);
 const guards=await page.evaluate(async()=>{
  const session=window.testSession;const project=await session.store.load();const asset=project.assets.find(a=>a.kind==='audio');const blob=await session.resolveAsset(asset);
  const {clipId}=await session.requestVoiceover({title:'Too short',script:'Test',language:'en',startSeconds:0,durationSeconds:.01});
  const pending=(await session.store.load()).tracks.flatMap(t=>t.clips).find(c=>c.id===clipId);
  const before=JSON.stringify(await session.store.load());const errors=[];
  for(const expected of [JSON.stringify(pending),'stale'])try{await session.applyVoiceoverRecordings(clipId,expected,[{text:'Test',blob}]);}catch(error){errors.push(String(error));}
  return {errors,unchanged:JSON.stringify(await session.store.load())===before};
 });
 assert.ok(guards.errors[0].includes('exceed'));assert.ok(guards.errors[1].includes('changed'));assert.equal(guards.unchanged,true);
 assert.deepEqual(errors,[]);
 console.log('Teleprompter: microphone recording, retake, two lines, stopped tracks, sequential audio timeline and MP4 audio decode passed.');
}finally{await browser.close();await server.close();}
