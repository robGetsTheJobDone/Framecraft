import {Player} from '@remotion/player';
import {createElement, type ComponentType, type CSSProperties} from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';

export {StudioComposition, createStudioComposition, prepareStudioComposition, clipVolumeAtTime} from './studio.js';
export type {StudioCompositionProps} from './studio.js';

export type BrowserComposition<Props extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  component: ComponentType<Props>;
  inputProps: Props;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

export function validateComposition(composition: Pick<BrowserComposition, 'id' | 'width' | 'height' | 'fps' | 'durationInFrames'>): void {
  if (!/^[a-zA-Z0-9-]+$/.test(composition.id)) {
    throw new Error('Composition id must contain only letters, numbers, and hyphens.');
  }
  for (const key of ['width', 'height', 'durationInFrames'] as const) {
    if (!Number.isSafeInteger(composition[key]) || composition[key] <= 0) {
      throw new Error(`${key} must be a positive safe integer.`);
    }
  }
  if (!Number.isFinite(composition.fps) || composition.fps <= 0) {
    throw new Error('fps must be a positive finite number.');
  }
}

/** Preview the same component and inputs used for browser export. */
export function BrowserRemotionPlayer<Props extends Record<string, unknown>>({
  composition,
  style,
  className,
  loop = false,
}: {
  composition: BrowserComposition<Props>;
  style?: CSSProperties;
  className?: string;
  loop?: boolean;
}) {
  validateComposition(composition);
  return <Player
    component={composition.component}
    inputProps={composition.inputProps}
    durationInFrames={composition.durationInFrames}
    compositionWidth={composition.width}
    compositionHeight={composition.height}
    fps={composition.fps}
    controls
    loop={loop}
    style={style ?? {width: '100%'}}
    {...(className === undefined ? {} : {className})}
  />;
}

export type BrowserExportOptions = {
  /** Defaults to MP4/H.264. WebM uses VP8. */
  format?: 'mp4' | 'webm';
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  licenseKey?: string;
};

/** Check actual codec support, then render to a Blob without a Node renderer. */
export async function exportComposition<Props extends Record<string, unknown>>(
  composition: BrowserComposition<Props>,
  options: BrowserExportOptions = {},
): Promise<Blob> {
  validateComposition(composition);
  options.signal?.throwIfAborted();
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Browser export requires a browser document in a secure context.');
  }
  const {canRenderMediaOnWeb, renderMediaOnWeb} = await import('@remotion/web-renderer');
  const container = options.format ?? 'mp4';
  const videoCodec = container === 'mp4' ? 'h264' : 'vp8';
  const support = await canRenderMediaOnWeb({
    width: composition.width,
    height: composition.height,
    container,
    videoCodec,
  });
  if (!support.canRender) {
    throw new Error(`Browser cannot export this composition: ${support.issues.map((issue) => issue.message).join('; ')}`);
  }
  options.signal?.throwIfAborted();
  const result = await renderMediaOnWeb({
    composition: {
      id: composition.id,
      component: () => createElement(composition.component, composition.inputProps),
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      durationInFrames: composition.durationInFrames,
    },
    container,
    videoCodec,
    ...(options.signal ? {signal: options.signal} : {}),
    ...(options.licenseKey ? {licenseKey: options.licenseKey} : {}),
    ...(options.onProgress ? {onProgress: ({progress}: {progress: number}) => options.onProgress?.(progress)} : {}),
  });
  return result.getBlob();
}

export type TitleCardProps = {title: string; background: string};

export function TitleCard({title, background}: TitleCardProps) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1], {extrapolateRight: 'clamp'});
  return <AbsoluteFill style={{backgroundColor: background, justifyContent: 'center', alignItems: 'center'}}>
    <div style={{color: '#ffffff', fontFamily: 'sans-serif', fontSize: 72, opacity}}>{title}</div>
  </AbsoluteFill>;
}

export const titleCardComposition: BrowserComposition<TitleCardProps> = {
  id: 'TitleCard',
  component: TitleCard,
  inputProps: {title: 'Made in your browser', background: '#152033'},
  width: 1280,
  height: 720,
  fps: 30,
  durationInFrames: 90,
};
