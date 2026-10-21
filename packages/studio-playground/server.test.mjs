import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {openAIHandler} from './server.mjs';

test('server keeps keys private, restricts origins, pins models and returns generated image bytes', async () => {
  const calls = [];
  const handler = openAIHandler({OPENAI_API_KEY: 'server-secret'}, async (url, options) => {
    calls.push({url, options});
    return Response.json(url.endsWith('images/generations') ? {data: [{b64_json: Buffer.from('png-bytes').toString('base64')}]} : {choices: []});
  });
  const server = createServer((req, res) => handler(req, res, () => {res.statusCode = 404; res.end();}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(origin + path, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
  try {
    const config = await (await fetch(origin + '/api/config')).text();
    assert.equal(config.includes('server-secret'), false);
    assert.equal((await post('/api/images/generate', {prompt: 'Forest'}, {Origin: 'https://evil.example'})).status, 403);
    assert.equal(calls.length, 0);
    assert.equal(await (await post('/api/images/generate', {prompt: 'Forest'})).text(), 'png-bytes');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer server-secret');
    await post('/api/openai/v1/chat/completions', {model: 'untrusted', messages: []});
    assert.equal(JSON.parse(calls[1].options.body).model, 'gpt-6-astra');
    assert.equal((await post('/api/images/generate', {prompt: ''})).status, 400);
    assert.equal((await post('/api/unknown', {})).status, 404);
  } finally {await new Promise(resolve => server.close(resolve));}
});

async function withServer(handler, action) {
  const server = createServer((req, res) => handler(req, res, () => {res.statusCode = 404; res.end();}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {await action((path, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}));}
  finally {await new Promise(resolve => server.close(resolve));}
}

test('Astra Responses preserves tools, strips incompatible sampling, and speech uses Realtime', async () => {
  const calls = [];
  let spoken;
  await withServer(openAIHandler({OPENAI_API_KEY: 'secret'}, async (url, options) => {calls.push({url, body: JSON.parse(options.body)}); return Response.json({output: []});}, async request => {spoken = request; return Buffer.from('wav');}), async post => {
    const tool = {type: 'function', name: 'request_voiceover', parameters: {type: 'object'}};
    assert.equal((await post('/api/openai/v1/responses', {model: 'ignored', input: [], tools: [tool], temperature: 1, top_p: 1, reasoning: {effort: 'none'}})).status, 200);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
    assert.equal(calls[0].body.model, 'gpt-6-astra');
    assert.deepEqual(calls[0].body.tools, [tool]);
    assert.equal(calls[0].body.temperature, undefined);
    assert.equal(calls[0].body.top_p, undefined);
    assert.equal(calls[0].body.reasoning.effort, 'low');
    assert.equal(calls[0].body.store, false);
    assert.equal(await (await post('/api/speech', {text: 'Read exactly this.'})).text(), 'wav');
    assert.equal(spoken.model, 'gpt-realtime-2.1'); assert.equal(spoken.text, 'Read exactly this.');
  });
});

test('image fallback runs once for unavailable models and never for moderation, credentials or quota', async () => {
  for (const code of ['model_not_found', 'model_unavailable', 'moderation_blocked', 'invalid_api_key', 'insufficient_quota']) {
    const models = [];
    await withServer(openAIHandler({OPENAI_API_KEY: 'secret'}, async (_, options) => {
      models.push(JSON.parse(options.body).model);
      return models.length === 1 ? Response.json({error: {code}}, {status: 400}) : Response.json({data: [{b64_json: Buffer.from('png').toString('base64')}]});
    }), async post => {
      const result = await post('/api/images/generate', {prompt: 'Forest'});
      if (code.startsWith('model_')) {
        assert.equal(await result.text(), 'png');
        assert.deepEqual(models, ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);
        assert.equal(result.headers.get('x-image-model'), 'gpt-image-2.5-flare');
      } else {assert.equal(result.status, 400); assert.equal(models.length, 1);}
    });
  }
});

test('streams the first provider event before completion and aborts on disconnect', async () => {
  let release; let upstreamSignal;
  const handler=openAIHandler({OPENAI_API_KEY:'secret'},async (_,options)=>{
    assert.equal(JSON.parse(options.body).stream,true);upstreamSignal=options.signal;
    return new Response(new ReadableStream({start(controller){
      controller.enqueue(new TextEncoder().encode('data: {"delta":"Hello"}\n\n'));
      release=()=>{controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));controller.close();};
    }}),{headers:{'Content-Type':'text/event-stream'}});
  });
  await withServer(handler,async post=>{
    const response=await post('/api/openai/v1/responses',{input:[],stream:true});
    assert.match(response.headers.get('content-type'),/text\/event-stream/);
    const reader=response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value),/Hello/);
    release();while(!(await reader.read()).done){}
  });
  await withServer(handler,async post=>{
    const response=await post('/api/openai/v1/responses',{input:[],stream:true});
    const reader=response.body.getReader();await reader.read();await reader.cancel();
    await new Promise(resolve=>{if(upstreamSignal.aborted)resolve();else upstreamSignal.addEventListener('abort',resolve,{once:true});});
    assert.equal(upstreamSignal.aborted,true);
  });
});

test('returns useful provider validation errors with credentials redacted',async()=>{
 await withServer(openAIHandler({OPENAI_API_KEY:'test-secret'},async()=>Response.json({error:{message:"Invalid schema: missing assetId. test-secret sk-example123",code:'invalid_json_schema',param:'text.format.schema'}},{status:400})),async post=>{
   const response=await post('/api/openai/v1/responses',{input:[]});
   assert.equal(response.status,400);
   const body=await response.json();
   assert.match(body.error.message,/missing assetId/);
   assert.equal(body.error.code,'invalid_json_schema');
   assert.equal(body.error.param,'text.format.schema');
   assert.ok(!JSON.stringify(body).includes('test-secret'));
   assert.ok(!JSON.stringify(body).includes('sk-example123'));
 });
});

test('accepts image-bearing model requests above 2 MB while retaining smaller media-route limits',async()=>{
 let calls=0;
 await withServer(openAIHandler({OPENAI_API_KEY:'secret'},async()=>{calls++;return Response.json({output:[]});}),async post=>{
  const large='a'.repeat(3*1024*1024);
  assert.equal((await post('/api/openai/v1/responses',{input:[{role:'user',content:[{type:'input_image',image_url:'data:image/png;base64,'+large}]}]})).status,200);
  const response=await post('/api/images/generate',{prompt:large});
  assert.equal(response.status,413);assert.match((await response.json()).error.message,/2 MB/);
  assert.equal(calls,1);
 });
});
