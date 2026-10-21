import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {synthesizeSpeech} from './speech.mjs';

// This module runs only in Node. Never import it from src/.
export function openAIHandler(env, requestFetch = fetch, speech = synthesizeSpeech) {
  const key = env.OPENAI_API_KEY;
  const model = env.OPENAI_MODEL || 'gpt-6-astra';
  const imageModel = env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-sunburst';
  const imageFallbackModel = env.OPENAI_IMAGE_FALLBACK_MODEL || 'gpt-image-2.5-flare';
  const speechModel = env.OPENAI_SPEECH_MODEL || 'gpt-realtime-2.1';
  return async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/')) return next();
    const json = (status, value) => {res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value));};
    res.setHeader('Cache-Control', 'no-store');
    const host = req.headers.host;
    if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return json(403, {error: 'Local server only'});
    if (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) return json(403, {error: 'Cross-origin request rejected'});
    if (path === '/api/config' && req.method === 'GET') return json(200, {configured: Boolean(key), model, imageModel, imageFallbackModel, speechModel, useResponsesApi: true});
    const routes = {'/api/openai/v1/responses': 'responses', '/api/openai/v1/chat/completions': 'chat/completions', '/api/images/generate': 'images/generations', '/api/speech': 'audio/speech'};
    if (!routes[path]) return json(404, {error: 'Unknown API route'});
    if (req.method !== 'POST') return json(405, {error: 'POST required'});
    if (!key) return json(503, {error: 'Set OPENAI_API_KEY in the root .env and restart pnpm dev.'});
    if (!req.headers['content-type']?.startsWith('application/json')) return json(415, {error: 'JSON required'});
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300000);
    const disconnected = () => {if (!res.writableEnded) controller.abort();};
    res.on('close', disconnected);
    try {
      const limitMB = path.startsWith('/api/openai/') ? 32 : 2;
      const chunks = []; let bytes = 0;
      const tooLarge = () => json(413, {error: {message: `Request exceeds the local ${limitMB} MB limit`, code:'request_too_large'}});
      if (Number(req.headers['content-length']) > limitMB * 1024 * 1024) {req.resume(); return tooLarge();}
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > limitMB * 1024 * 1024) {chunks.length = 0; continue;}
        chunks.push(chunk);
      }
      if (bytes > limitMB * 1024 * 1024) return tooLarge();
      let input;
      try {input = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {return json(400, {error: 'Invalid JSON'});}
      if (!input || typeof input !== 'object' || Array.isArray(input)) return json(400, {error: 'Expected object'});
      let body;
      if (path.endsWith('/responses')) {
        if (!Array.isArray(input.input) && typeof input.input !== 'string') return json(400, {error: 'Input required'});
        body = {...input, model, stream: input.stream === true, store: false};
        if (/^gpt-6/.test(model)) {
          body.reasoning = {...body.reasoning, effort: body.reasoning?.effort && !['none', 'minimal'].includes(body.reasoning.effort) ? body.reasoning.effort : 'low'};
          for (const field of ['temperature', 'top_p', 'top_logprobs']) delete body[field];
          body.include = [...new Set([...(body.include ?? []).filter(item => item !== 'message.output_text.logprobs'), 'reasoning.encrypted_content'])];
        }
      } else if (path.endsWith('/chat/completions')) {
        if (!Array.isArray(input.messages)) return json(400, {error: 'Messages required'});
        body = {...input, model, stream: input.stream === true};
      } else if (path === '/api/images/generate') {
        if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 16000) return json(400, {error: 'Provide an image prompt of 1–16000 characters'});
        body = {model: imageModel, prompt: input.prompt, n: 1, size: '1536x1024', output_format: 'png'};
      } else {
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4096) return json(400, {error: 'Speech text must contain 1–4096 characters'});
        const wav = await speech({key, model: speechModel, text: input.text, voice: input.voice || 'marin', signal: controller.signal});
        res.setHeader('Content-Type', 'audio/wav'); res.end(wav); return;
      }
      const send = modelBody => requestFetch(`https://api.openai.com/v1/${routes[path]}`, {method: 'POST', signal: controller.signal, headers: {'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json'}, body: JSON.stringify(modelBody)});
      let upstream = await send(body);
      let usedImageModel = imageModel;
      if (path === '/api/images/generate' && !upstream.ok && imageFallbackModel !== imageModel) {
        const error = await upstream.clone().json().catch(() => ({}));
        const code = error.error?.code;
        // Only retry explicit model availability failures. Never retry moderation, quota,
        // authorization, or ambiguous network failures that may have been billed.
        if (code === 'model_not_found' || code === 'model_not_available' || code === 'model_unavailable') {
          usedImageModel = imageFallbackModel;
          upstream = await send({...body, model: imageFallbackModel});
        }
      }
      if (!upstream.ok) {
        const detail = await upstream.json().catch(() => ({}));
        const clean = value => typeof value === 'string' ? value.split(key).join('[redacted]').replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,2000) : undefined;
        return json(upstream.status,{error:{message:clean(detail.error?.message) || `OpenAI returned ${upstream.status}.`,type:'upstream_error',code:clean(detail.error?.code),param:clean(detail.error?.param)}});
      }
      if (body.stream) {
        if (!upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Expected event stream');
        res.setHeader('Content-Type','text/event-stream; charset=utf-8');
        res.setHeader('X-Accel-Buffering','no');
        res.flushHeaders();
        await pipeline(Readable.fromWeb(upstream.body),res,{signal:controller.signal});
      } else if (path === '/api/images/generate') {
        const result = await upstream.json();
        const encoded = result.data?.[0]?.b64_json;
        if (typeof encoded !== 'string' || !encoded) throw new Error('Missing image');
        res.setHeader('X-Image-Model', usedImageModel);
        res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from(encoded, 'base64'));
      } else {
        res.setHeader('Content-Type', path === '/api/speech' ? 'audio/wav' : 'application/json');
        res.end(Buffer.from(await upstream.arrayBuffer()));
      }
    } catch {if (res.headersSent) res.destroy(); else if (!res.destroyed) json(502, {error: 'OpenAI request failed or timed out. Check the connection and try again.'});}
    finally {clearTimeout(timer); res.off('close', disconnected);}
  };
}
