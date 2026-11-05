import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openProject, writeOutput} from './storage.mjs';
import {startServer} from './server.mjs';

test('disk checkpoints are exclusive, atomic, versioned, and recoverable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'framecraft-storage-'));
  try {
    const project = await openProject(dir, {create: true});
    await assert.rejects(openProject(dir), /locked/);
    const snapshot = JSON.stringify({schemaVersion: 1, projectId: project.projectId, files: []});
    const first = await project.save(snapshot, null);
    await assert.rejects(project.save(snapshot, 'stale'), /conflict/);
    assert.equal(JSON.parse(await readFile(join(dir, '.framecraft/state.json'))).version, first.version);
    await project.close();
    const reopened = await openProject(dir);
    assert.equal(reopened.projectId, project.projectId);
    assert.equal(reopened.read().version, first.version);
    await reopened.save(snapshot, first.version);
    await reopened.close();
    await assert.rejects(openProject(dir, {create: true}), /already exists/);
    await assert.rejects(access(join(dir, '.framecraft/lock')));
    await writeOutput(join(dir, 'video.mp4'), Buffer.from('original'));
    await assert.rejects(writeOutput(join(dir, 'video.mp4'), Buffer.from('replacement')), {code: 'EEXIST'});
    assert.equal(await readFile(join(dir, 'video.mp4'), 'utf8'), 'original');
    await assert.rejects(writeOutput(join(dir, '.framecraft/state.json'), Buffer.from('bad'), {force: true, projectRoot: dir}), /state/);
  } finally {await rm(dir, {recursive: true, force: true});}
});

test('gateway keeps credentials on the server, rejects other origins, and leaves output uncapped', async () => {
  const calls = [];
  const server = await startServer({assets: new Map(), apiKey: 'secret-test-key', model: 'gpt-6-astra', requestFetch: async (url, init) => {
    calls.push({url: String(url), ...init});
    return new Response('data: hello\n\ndata: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
  }});
  const headers = {authorization: `Bearer ${server.token}`, 'content-type': 'application/json'};
  try {
    const post = (path, extra = {}) => fetch(server.origin + path, {method: 'POST', headers: {...headers, ...extra}, body: JSON.stringify({model: 'ignored', temperature: 1, stream: true})});
    assert.equal((await post('/v1/responses', {origin: 'https://untrusted.example'})).status, 403);
    assert.equal((await post('/v1/responses', {authorization: 'Bearer wrong'})).status, 401);
    assert.equal((await post('/v1/files')).status, 404);
    assert.equal((await fetch(server.origin + '/../../etc/passwd')).status, 404);
    assert.equal(calls.length, 0);
    const response = await post('/v1/responses', {origin: server.origin});
    assert.equal(await response.text(), 'data: hello\n\ndata: [DONE]\n\n');
    assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
    assert.equal(calls[0].headers.authorization, 'Bearer secret-test-key');
    assert.equal(calls[0].redirect, 'error');
    const body = JSON.parse(calls[0].body);
    assert.equal(body.model, 'gpt-6-astra');
    assert.equal(body.store, false);
    assert.equal(body.temperature, undefined);
    for (const cap of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) assert.equal(body[cap], undefined);
    await post('/v1/chat/completions');
    assert.equal(calls[1].url, 'https://api.openai.com/v1/chat/completions');
  } finally {await server.close();}
});

test('gateway returns meaningful upstream failures with keys redacted', async () => {
  const server = await startServer({assets: new Map(), apiKey: 'private-key', model: 'test', requestFetch: async () => new Response('Invalid credential private-key', {status: 401})});
  try {
    const response = await fetch(server.origin + '/v1/responses', {method: 'POST', headers: {authorization: `Bearer ${server.token}`}, body: '{}'});
    assert.equal(response.status, 401);
    const body = await response.text();
    assert.match(body, /Invalid credential \[redacted\]/);
    assert.ok(!body.includes('private-key'));
  } finally {await server.close();}
  await assert.rejects(startServer({assets: new Map(), baseURL: 'http://remote.example/v1'}), /HTTPS/);
});
