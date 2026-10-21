import {exportComposition} from '@deepbench/browser-remotion';
import type {StudioSession} from './index.js';
export interface ReviewFrame {timeSeconds: number; dataUrl: string}
/** Captures actual rendered video frames, never screenshots of source code. */
export async function captureReviewFrames(session: StudioSession, signal: AbortSignal): Promise<ReviewFrame[]> {
  const prepared = await session.preparePreview();
  let url: string | undefined;
  const video = document.createElement('video');
  const wait = (event: 'loadeddata' | 'seeked', action: () => void) => new Promise<void>((resolve, reject) => {
    const cleanup = () => {clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener('error', fail); signal.removeEventListener('abort', fail);};
    const done = () => {cleanup(); resolve();};
    const fail = () => {cleanup(); reject(new Error('Frame capture failed or was cancelled'));};
    const timer = setTimeout(fail, 30000);
    video.addEventListener(event, done, {once: true}); video.addEventListener('error', fail, {once: true}); signal.addEventListener('abort', fail, {once: true});
    if (signal.aborted) fail(); else action();
  });
  try {
    const blob = await exportComposition(prepared.composition, {format: 'webm', signal});
    url = URL.createObjectURL(blob); video.muted = true;
    await wait('loadeddata', () => {video.src = url!; video.load();});
    const project = prepared.composition.inputProps.project;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1024 / Math.max(project.width, project.height));
    canvas.width = Math.round(project.width * scale); canvas.height = Math.round(project.height * scale);
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
    const times = [...new Set([0, project.durationSeconds / 2, Math.max(0, project.durationSeconds - 1 / project.fps), ...project.tracks.flatMap(t => t.clips.filter(c => c.kind === 'image' || c.kind === 'video' || c.kind === 'text').map(c => c.startSeconds + c.durationSeconds / 2))])].sort((a,b) => a-b).slice(0, 12);
    const frames: ReviewFrame[] = [];
    for (const time of times) {
      signal.throwIfAborted();
      if (Math.abs(video.currentTime - time) > .001) await wait('seeked', () => {video.currentTime = time;});
      context.drawImage(video, 0, 0, canvas.width, canvas.height); frames.push({timeSeconds: time, dataUrl: canvas.toDataURL('image/png')});
    }
    return frames;
  } finally {video.removeAttribute('src'); video.load(); if (url) URL.revokeObjectURL(url); prepared.dispose();}
}
