import {Audio, Video} from '@remotion/media';
import {AbsoluteFill, Img, Sequence, useCurrentFrame} from 'remotion';
import {assertValidProject, type StudioProject, type StudioClip, type StudioTrack, type StudioAsset} from '@deepbench/studio-project';
import type {BrowserComposition} from './index.js';

export type StudioCompositionProps = {project: StudioProject; assetUrls: Record<string, string>};

/** Audio envelope shared by preview and video export; timeline timing is quantized to frames. */
export function clipVolumeAtTime(clip: Extract<StudioClip, {kind: 'audio' | 'video'}>, track: StudioTrack, localSeconds: number): number {
  if (track.muted || clip.muted || localSeconds < 0 || localSeconds >= clip.durationSeconds) return 0;
  const fadeIn = clip.fadeInSeconds ?? 0;
  const fadeOut = clip.fadeOutSeconds ?? 0;
  const envelope = Math.min(1, fadeIn ? localSeconds / fadeIn : 1, fadeOut ? (clip.durationSeconds - localSeconds) / fadeOut : 1);
  return Math.max(0, envelope) * (clip.gain ?? 1) * (track.gain ?? 1);
}

function TimelineClip({clip, track, assetUrls, fps}: {clip: StudioClip; track: StudioTrack; assetUrls: Record<string, string>; fps: number}) {
  const frame = useCurrentFrame();
  if (clip.kind === 'voiceover') return null;
  if (clip.kind === 'text') return <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', color: 'white', fontFamily: 'sans-serif', fontSize: 64, textAlign: 'center'}}>{clip.text}</AbsoluteFill>;
  const src = assetUrls[clip.assetId];
  if (!Object.hasOwn(assetUrls, clip.assetId) || typeof src !== 'string' || !src) throw new Error(`Missing URL for studio asset ${clip.assetId}`);
  if (clip.kind === 'image') return <Img src={src} style={{width: '100%', height: '100%', objectFit: clip.objectFit ?? 'cover'}} />;
  const props = {src, trimBefore: Math.round(clip.sourceStartSeconds * fps), volume: clipVolumeAtTime(clip, track, frame / fps), muted: Boolean(track.muted || clip.muted)};
  return clip.kind === 'audio' ? <Audio {...props} /> : <Video {...props} style={{width: '100%', height: '100%'}} objectFit="contain" />;
}

/** Later visual tracks composite over earlier tracks. Audio mute does not hide video. */
export function StudioComposition({project, assetUrls}: StudioCompositionProps) {
  return <AbsoluteFill style={{backgroundColor: '#10141e'}}>
    {project.tracks.flatMap(track => track.clips.map(clip => <Sequence
      key={clip.id}
      from={Math.round(clip.startSeconds * project.fps)}
      durationInFrames={Math.max(1, Math.round((clip.startSeconds + clip.durationSeconds) * project.fps) - Math.round(clip.startSeconds * project.fps))}
      layout={clip.kind === 'audio' ? 'none' : 'absolute-fill'}
    ><TimelineClip clip={clip} track={track} assetUrls={assetUrls} fps={project.fps} /></Sequence>))}
  </AbsoluteFill>;
}

export function createStudioComposition(project: StudioProject, assetUrls: Record<string, string>): BrowserComposition<StudioCompositionProps> {
  assertValidProject(project);
  for (const track of project.tracks) for (const clip of track.clips) {
    if (clip.kind !== 'text' && clip.kind !== 'voiceover' && (!Object.hasOwn(assetUrls, clip.assetId) || typeof assetUrls[clip.assetId] !== 'string' || !assetUrls[clip.assetId])) throw new Error(`Missing URL for studio asset ${clip.assetId}`);
  }
  return {id: 'StudioProject', component: StudioComposition, inputProps: {project: structuredClone(project), assetUrls: {...assetUrls}}, width: project.width, height: project.height, fps: project.fps, durationInFrames: Math.ceil(project.durationSeconds * project.fps)};
}

/** Resolve persistent media into temporary URLs. Dispose only after preview/render releases them. */
export async function prepareStudioComposition(project: StudioProject, resolveAsset: (asset: StudioAsset) => Promise<Blob>): Promise<{composition: BrowserComposition<StudioCompositionProps>; dispose(): void}> {
  assertValidProject(project);
  const snapshot = structuredClone(project);
  const urls: Record<string, string> = Object.create(null);
  const dispose = () => { for (const url of Object.values(urls)) URL.revokeObjectURL(url); };
  try {
    const referenced = new Set(snapshot.tracks.flatMap(track => track.clips.flatMap(clip => clip.kind === 'text' || clip.kind === 'voiceover' ? [] : [clip.assetId])));
    for (const asset of snapshot.assets) if (referenced.has(asset.id)) urls[asset.id] = URL.createObjectURL(await resolveAsset(asset));
    return {composition: createStudioComposition(snapshot, urls), dispose};
  } catch (error) { dispose(); throw error; }
}
