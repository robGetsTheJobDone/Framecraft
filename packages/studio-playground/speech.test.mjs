import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {synthesizeSpeech} from './speech.mjs';
class Socket extends EventEmitter {
  static instance;
  sent = []; closed = false;
  constructor(url, options) {super(); this.url = url; this.options = options; Socket.instance = this;}
  send(raw) {this.sent.push(JSON.parse(raw));}
  close() {this.closed = true;}
  terminate() {this.closed = true;}
  event(value) {this.emit('message', Buffer.from(JSON.stringify(value)));}
}
test('Realtime script audio is assembled into valid PCM WAV only after completion', async () => {
  const pending = synthesizeSpeech({key: 'secret', model: 'gpt-realtime-2.1', text: 'The approved script.', signal: new AbortController().signal}, Socket);
  const socket = Socket.instance;
  assert.match(socket.url, /model=gpt-realtime-2.1/);
  socket.event({type: 'session.created'});
  assert.equal(socket.sent[0].session.audio.output.format.rate, 24000);
  socket.event({type: 'session.updated'});
  assert.equal(socket.sent[1].item.content[0].text, 'The approved script.');
  assert.equal(socket.sent[2].type, 'response.create');
  socket.event({type: 'response.output_audio.delta', delta: Buffer.from([1, 0, 2, 0]).toString('base64')});
  socket.event({type: 'response.done', response: {status: 'completed'}});
  const wav = await pending;
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 24000); assert.equal(wav.readUInt32LE(40), 4);
  assert.deepEqual(wav.subarray(44), Buffer.from([1, 0, 2, 0])); assert.equal(socket.closed, true);
});
test('cancelled and incomplete speech never publishes partial audio', async () => {
  for (const type of ['cancel', 'close', 'error', 'incomplete']) {
    const controller = new AbortController();
    const pending = synthesizeSpeech({key: 'secret', model: 'gpt-realtime-2.1', text: 'Script', signal: controller.signal}, Socket);
    if (type === 'cancel') controller.abort();
    else if (type === 'close') Socket.instance.emit('close');
    else if (type === 'error') Socket.instance.event({type: 'error'});
    else Socket.instance.event({type: 'response.done', response: {status: 'incomplete'}});
    await assert.rejects(pending);
    assert.equal(Socket.instance.closed, true);
  }
});
