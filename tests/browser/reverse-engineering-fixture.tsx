import React from 'react';
import {createRoot} from 'react-dom/client';
import {openStudioSession} from '../../packages/browser-studio/src/index';
import {MemoryFileSystem} from '../../packages/browser-filesystem/src/index';
import {StudioView} from '../../packages/studio/src/StudioView';
import '../../packages/studio/src/styles.css';

const session = await openStudioSession({filesystem: new MemoryFileSystem(), conversationId: 'reverse-test'});
const state = {calls: [] as Array<{name: string; frames: number}>, audioBytes: [] as number[], audioFrequencies: [] as number[][], failTranscription: false, delay: false};
const breakdown = (start: number, end: number, evidence: number[]) => ({title: 'Reference study', overview: 'A red field changes to blue.', themes: ['Minimal color story'], palette: ['Red', 'Blue'], typography: ['No lettering observed'], recurringElements: [{name: 'Background', appearance: 'Full-frame color'}], scenes: [{title: 'Color field', startSeconds: start, endSeconds: end, description: 'A flat field fills the canvas.', elements: [{name: 'Background', appearance: 'Flat color', position: 'Full frame', motion: 'A cut changes the color'}], onScreenText: [], animation: 'No motion within the field', transitionIn: 'Cut inferred between sampled frames', transitionOut: 'End of reference', evidenceSeconds: evidence, uncertainties: ['Subsecond cut timing is inferred.']}], recreationNotes: ['Create a color background and switch it at the cut.'], uncertainties: ['No exact transition duration established.']});
const model = {withStructuredOutput: (_: unknown, {name}: {name: string}) => ({invoke: async (messages: any[], {signal}: {signal: AbortSignal}) => {
  const content = messages[1].content;
  state.calls.push({name, frames: Array.isArray(content) ? content.filter((block: any) => block.type === 'image_url').length : 0});
  if (state.delay) await new Promise<void>((resolve, reject) => {const timer = setTimeout(resolve, 30000); signal.addEventListener('abort', () => {clearTimeout(timer); reject(signal.reason);}, {once: true});});
  const context = JSON.parse(Array.isArray(content) ? content[0].text : content);
  return name === 'video_breakdown' ? breakdown(0, context.metadata.durationSeconds, [0, 4, 9].filter(time => time < context.metadata.durationSeconds)) : breakdown(context.timeRange.startSeconds, context.timeRange.endSeconds, [context.timeRange.startSeconds]);
}})} as any;
const transcription = {transcribe: async ({audio}: {audio: Blob}) => {
  state.audioBytes.push(audio.size);
  if (state.failTranscription) throw new Error('Test transcription unavailable');
  const header = new DataView(await audio.arrayBuffer());
  if (header.getUint32(24, true) !== 16000 || header.getUint16(22, true) !== 1) throw new Error('Expected 16kHz mono WAV');
  state.audioFrequencies.push([0.1, 1.5].map(start => {
    let crossings = 0;
    for (let index = Math.floor(start * 16000); index < (start + 0.1) * 16000 && 44 + (index + 1) * 2 < header.byteLength; index++) if (header.getInt16(44 + index * 2, true) <= 0 && header.getInt16(44 + (index + 1) * 2, true) > 0) crossings++;
    return crossings / 0.1;
  }));
  return {text: 'Bonjour. 你好。 مرحبًا.', languages: ['fr', 'zh', 'ar']};
}};
(window as any).reverseTest = {state, session};
const loadSession = async () => session;
createRoot(document.getElementById('root')!).render(<StudioView projectId="reverse-test" loadSession={loadSession} providers={{model, dubbing: {} as any}} reverseEngineering={{model, transcription}} />);
