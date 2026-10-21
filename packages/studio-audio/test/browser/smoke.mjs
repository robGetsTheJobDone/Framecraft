import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const bundle = await build({
  absWorkingDir: root,
  stdin: { contents: `import * as audio from './packages/studio-audio/src/index.ts'; import {createStudioProject} from './packages/studio-project/src/index.ts'; window.studioAudio = {...audio, createStudioProject};`, resolveDir: root },
  bundle: true, platform: 'browser', format: 'iife', write: false,
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const { createStudioProject, encodeWav, mixProjectAudio, decodeMediaAudio } = window.studioAudio;
    const samples = new Float32Array(48000);
    // Distinct source halves demonstrate the offset is honored.
    samples.fill(0.1, 0, 24000); samples.fill(0.8, 24000);
    const wav = encodeWav({ numberOfChannels: 1, length: samples.length, sampleRate: 48000, getChannelData: () => samples });
    const project = createStudioProject({ durationSeconds: 1 });
    project.assets.push({ id: 'tone', kind: 'audio', path: 'assets/tone.wav', mimeType: 'audio/wav', durationSeconds: 1 });
    project.tracks[2].gain = 0.5;
    project.tracks[2].clips.push({ id: 'tone-clip', kind: 'audio', assetId: 'tone', startSeconds: 0.25, sourceStartSeconds: 0.5, durationSeconds: 0.5, gain: 0.5, fadeInSeconds: 0.1, fadeOutSeconds: 0.1 });
    const mix = await mixProjectAudio(project, { resolveAsset: () => wav, numberOfChannels: 1 });
    const output = mix.buffer.getChannelData(0);
    const decoded = await decodeMediaAudio(mix.blob);
    project.tracks[2].clips.push({ ...project.tracks[2].clips[0], id: 'overlap' });
    const overlap = await mixProjectAudio(project, { resolveAsset: () => wav, numberOfChannels: 1 });
    return { overlapMiddle: overlap.buffer.getChannelData(0)[24000], length: output.length, before: output[6000], attack: output[14400], middle: output[24000], release: output[33600], after: output[40000], peak: mix.peak, channels: decoded.numberOfChannels, duration: decoded.duration, size: mix.blob.size };
  });
  assert.equal(result.length, 48000);
  assert.equal(result.before, 0); assert.equal(result.after, 0);
  assert.ok(Math.abs(result.middle - 0.2) < 0.001, JSON.stringify(result));
  assert.ok(Math.abs(result.attack - 0.1) < 0.001, JSON.stringify(result));
  assert.ok(Math.abs(result.release - 0.1) < 0.001, JSON.stringify(result));
  assert.ok(Math.abs(result.peak - 0.2) < 0.001);
  assert.ok(Math.abs(result.overlapMiddle - 0.4) < 0.001, JSON.stringify(result));
  assert.equal(result.channels, 1); assert.equal(result.duration, 1); assert.equal(result.size, 96044);
  console.log('Chromium audio smoke passed: WAV decode → source trim → placement/gain/fades → offline mix → WAV re-decode.');
} finally { await browser.close(); }
