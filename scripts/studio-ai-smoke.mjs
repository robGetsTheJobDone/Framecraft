import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
import {encodeWav} from '../packages/studio-audio/dist/index.js';
const root = fileURLToPath(new URL('../packages/studio-playground/', import.meta.url));
const require = createRequire(new URL('../packages/studio-playground/package.json', import.meta.url));
const vite = await import(pathToFileURL(require.resolve('vite')).href);
const server = await vite.createServer({root, logLevel: 'error', server: {host: '127.0.0.1', port: 5175, strictPort: true}});
await server.listen();
const browser = await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try {
  const page = await browser.newPage({permissions:['microphone'], viewport: {width: 1440, height: 1000}});
  page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let png;
  let chatCalls = 0, speechCalls = 0, imageCalls = 0;
  await page.route('**/api/config', route => route.fulfill({json: {configured: true, model: 'gpt-6-astra', imageModel: 'test-image', useResponsesApi: true}}));
  await page.route('**/api/openai/v1/responses', async route => {
    const request = route.request().postDataJSON();
    assert.equal(request.model, 'gpt-6-astra');
    assert.ok(Array.isArray(request.input));
    const output = chatCalls++ === 0 ? [
      {id: 'fc_image', call_id: 'image-call', type: 'function_call', status: 'completed', name: 'generate_scene_image', arguments: JSON.stringify({name: 'Forest scene', prompt: 'A green forest', startSeconds: 0, durationSeconds: 8})},
      {id: 'fc_voice', call_id: 'voice-call', type: 'function_call', status: 'completed', name: 'request_voiceover', arguments: JSON.stringify({title: 'Forest narration', script: 'Welcome to the forest.', language: 'en', startSeconds: 0, durationSeconds: 4})},
    ] : [{id: 'msg_done', type: 'message', role: 'assistant', status: 'completed', content: [{type: 'output_text', text: 'Scene created. Review the voiceover request on the timeline.', annotations: []}]}];
    if (chatCalls > 1) assert.ok(request.input.some(item => item.type === 'function_call_output'));
    const response={id: `resp_${chatCalls}`, object:'response',created_at:1,status:'completed',model:'gpt-6-astra',output,usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
    if(request.stream){
      const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}}];
      output.forEach((item,index)=>{
        events.push({type:'response.output_item.added',output_index:index,item});
        if(item.type==='message')events.push({type:'response.output_text.delta',item_id:item.id,output_index:index,content_index:0,delta:item.content[0].text});
      });
      events.push({type:'response.completed',response});
      await route.fulfill({contentType:'text/event-stream',body:events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n'});
    }else await route.fulfill({json:response});
  });
  await page.route('**/api/images/generate', route => {imageCalls++; return route.fulfill({contentType: 'image/png', body: png});});
  const samples = new Float32Array(24000);
  const wav = encodeWav({numberOfChannels: 1, length: samples.length, sampleRate: 24000, getChannelData: () => samples});
  await page.route('**/api/speech', async route => {speechCalls++; assert.equal(route.request().postDataJSON().text, 'A peaceful forest awaits.'); await route.fulfill({contentType: 'audio/wav', body: Buffer.from(await wav.arrayBuffer())});});
  await page.goto('http://127.0.0.1:5175/?mode=timeline');
  png = Buffer.from(await page.evaluate(() => {const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; const context = canvas.getContext('2d'); context.fillStyle = 'green'; context.fillRect(0, 0, 32, 32); return canvas.toDataURL().split(',')[1];}), 'base64');
  await page.getByText('OpenAI connected', {exact: true}).waitFor();
  await page.getByLabel('Message assistant').fill('Make a forest scene and request narration.');
  await page.getByRole('button', {name: 'Send ↑', exact: true}).click();
  await page.locator('.clip.voiceover').waitFor({timeout: 60000});
  console.log('Pending voiceover received');
  await page.getByRole('region',{name:'Agent activity'}).getByText('Finished request_voiceover',{exact:true}).waitFor();
  await page.locator('.preview-area img').waitFor({timeout: 15000}).catch(async error => {console.log(await page.locator('body').innerText()); throw error;});
  console.log('Generated scene rendered');
  assert.equal(imageCalls, 1); assert.equal(speechCalls, 0);
  await page.reload();console.log('Reloaded');
  await page.locator('.clip.voiceover').click();
  const dialog = page.getByRole('dialog', {name: 'Voiceover teleprompter'});
  await dialog.waitFor();console.log('Teleprompter dialog open');
  assert.equal(await page.getByLabel('Voiceover script', {exact: true}).inputValue(), 'Welcome to the forest.');
  await page.getByLabel('Voiceover script', {exact: true}).fill('A peaceful forest awaits.');
  await page.getByRole('button',{name:'Open teleprompter',exact:true}).click();console.log('Teleprompter opened');
  await page.getByRole('button',{name:'Record line',exact:true}).click();console.log('Recording requested');
  await page.getByRole('button',{name:'Stop recording',exact:true}).waitFor();await page.waitForTimeout(500);
  await page.getByRole('button',{name:'Stop recording',exact:true}).click();console.log('Stopped recording');
  await page.getByRole('button',{name:'Add recordings to timeline',exact:true}).click();console.log('Recordings applied');
  await page.locator('.clip.audio').waitFor({timeout: 60000});
  console.log('Recorded audio on timeline');
  assert.equal(await page.locator('.clip.voiceover').count(), 0); assert.equal(speechCalls, 0);
  await page.getByRole('button', {name: 'Export video ↗', exact: true}).click();
  await page.getByRole('link', {name: 'Download deepbench.mp4 ↓'}).waitFor({timeout: 120000});
  assert.deepEqual(errors, []);
  console.log('AI studio: agent image -> Remotion preview/export; pending script -> reload/edit/record -> audio passed.');
} finally {await browser.close(); await server.close();}
