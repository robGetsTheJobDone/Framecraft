import { describe, expect, it } from 'vitest';
import { createHash } from '../build/sha256.js';

describe('browser SHA-256 implementation', () => {
  it('matches standard digest vectors and supports incremental binary updates', () => {
    expect(createHash('sha256').digest('hex')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(createHash('sha256').update(new Uint8Array([97])).update(new Uint8Array([98, 99])).digest('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('fails explicitly for unsupported algorithms and encodings', () => {
    expect(() => createHash('md5')).toThrow('Unsupported browser digest');
    expect(() => createHash('sha256').digest('base64')).toThrow('Unsupported digest encoding');
  });
});

it('browser globals provide real scheduling and binary codecs', async () => {
  const originalProcess = globalThis.process;
  const { process, Buffer, global } = await import('../build/globals.js');
  expect(global).toBe(globalThis);
  expect(globalThis.process).toBe(originalProcess);
  expect(Buffer.from(new Uint8Array([0, 127, 255])).toString('base64')).toBe('AH//');
  expect([...Buffer.from('AH//', 'base64')]).toEqual([0, 127, 255]);
  const steps: string[] = [];
  const tick = new Promise<void>((resolve) => process.nextTick(() => { steps.push('tick'); resolve(); }));
  steps.push('sync');
  await tick;
  expect(steps).toEqual(['sync', 'tick']);
});
