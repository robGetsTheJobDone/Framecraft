import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Only this process knows the provider credential. The browser gets a disposable
// local bearer token, and may call only the two model API routes below.
export async function startServer({assets, apiKey, baseURL = 'https://api.openai.com/v1', model, requestFetch = fetch}) {
  const upstream = new URL(baseURL.endsWith('/') ? baseURL : baseURL + '/');
  if (!['https:', 'http:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.search || upstream.hash) throw new Error('OPENAI_BASE_URL must be an HTTP(S) API base URL.');
  if (upstream.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(upstream.hostname)) throw new Error('Remote model endpoints must use HTTPS.');
  const token = randomBytes(32).toString('hex');
  let origin;
  const controllers = new Set();
  const server = createServer(async (req, res) => {
    const fail = (status, message) => {
      if (res.headersSent) {res.destroy(); return;}
      res.writeHead(status, {'content-type': 'application/json'});
      res.end(JSON.stringify({error: {message}}));
    };
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return fail(403, 'Local origin required.');
      const path = new URL(req.url, origin).pathname;
      if (req.method === 'GET') {
        if (path === '/') {
          res.writeHead(200, {'content-type': 'text/html', 'cache-control': 'no-store'});
          return res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="/runtime.js"></script></body></html>');
        }
        // No arbitrary filesystem paths, directory traversal, or project files.
        const asset = assets.get(path);
        if (!asset) return fail(404, 'Not found.');
        res.writeHead(200, {'content-type': asset.type, 'cache-control': 'no-store'});
        return res.end(await readFile(asset.path));
      }
      if (req.method !== 'POST' || !['/v1/responses', '/v1/chat/completions'].includes(path)) return fail(404, 'Not found.');
      if (req.headers.authorization !== `Bearer ${token}`) return fail(401, 'Local authentication required.');
      if (!apiKey) return fail(401, 'Set OPENAI_API_KEY to use AI editing.');
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) return fail(413, 'Model request exceeds 32 MB.');
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return fail(400, 'Invalid model request JSON.'); }
      body.model = model;
      if (path === '/v1/responses') {
        body.store = false;
        // Match the studio gateway's stateless GPT-6 Responses configuration.
        if (/^gpt-6(?:[.-]|$)/.test(model)) {
          body.reasoning = {...body.reasoning, effort: body.reasoning?.effort && !['none', 'minimal'].includes(body.reasoning.effort) ? body.reasoning.effort : 'low'};
          for (const field of ['temperature', 'top_p', 'top_logprobs']) delete body[field];
          body.include = [...new Set([...(body.include ?? []).filter(item => item !== 'message.output_text.logprobs'), 'reasoning.encrypted_content'])];
        }
      }
      const controller = new AbortController(); controllers.add(controller);
      const disconnect = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', disconnect);
      try {
        const response = await requestFetch(new URL(path.slice('/v1/'.length), upstream), {
          method: 'POST', redirect: 'error',
          headers: {'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json'},
          body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]),
        });
        if (!response.ok) {
          const message = (await response.text()).replaceAll(apiKey, '[redacted]').slice(0, 8000);
          return fail(response.status, `Model request failed (${response.status}): ${message}`);
        }
        res.writeHead(response.status, {'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store'});
        if (response.body) await pipeline(Readable.fromWeb(response.body), res);
        else res.end();
      } finally { controllers.delete(controller); res.off('close', disconnect); }
    } catch (error) { fail(502, String(error.message).replaceAll(apiKey || '\0', '[redacted]')); }
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  origin = `http://127.0.0.1:${server.address().port}`;
  return {origin, token, async close() {
    for (const controller of controllers) controller.abort();
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections(); await closed;
  }};
}
