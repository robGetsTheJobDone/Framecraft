import {decodeMediaAudio, encodeWav} from '@deepbench/studio-audio';
import {Input, BlobSource, ALL_FORMATS, CanvasSink} from 'mediabunny';
import {referenceSampleTimes, resolveReferenceTrim, reverseEngineeringLimits, type ReferenceMetadata, type PreparedVideoReference, type ReferenceAudioChunk, type ReverseEngineeringOptions} from './reverse-engineering.js';

function validateVideoFile(file: File) {
  if (!file.size || file.size > reverseEngineeringLimits.fileBytes) throw new Error('Choose a non-empty video up to 100 MB.');
  if (!/\.(mp4|m4v|webm|mov)$/i.test(file.name) && !file.type.startsWith('video/')) throw new Error('Choose an MP4 or another supported video file.');
}

/** Read the same video-track clock used for sampling, rather than the audio/container duration. */
export async function inspectVideoReference(file: File, {signal}: {signal?: AbortSignal} = {}): Promise<ReferenceMetadata> {
  signal?.throwIfAborted(); validateVideoFile(file);
  const input = new Input({source: new BlobSource(file), formats: ALL_FORMATS});
  const cancel = () => input.dispose(); signal?.addEventListener('abort', cancel, {once: true});
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video || !await video.canDecode()) throw new Error('This browser cannot decode the video. Try an H.264 MP4 in Chrome.');
    const durationSeconds = (await video.computeDuration()) - (await video.getFirstTimestamp());
    referenceSampleTimes(durationSeconds); signal?.throwIfAborted();
    return {name: file.name, durationSeconds, width: video.displayWidth, height: video.displayHeight, sampleIntervalSeconds: 1};
  } catch (error) {signal?.throwIfAborted(); throw error;}
  finally {signal?.removeEventListener('abort', cancel); input.dispose();}
}

/** Sample the local file with bounded image sizes. Decoders are disposed on success, failure, and cancellation. */
export async function prepareVideoReference(file: File, options: Pick<ReverseEngineeringOptions, 'signal' | 'onProgress' | 'trim'> = {}): Promise<PreparedVideoReference> {
  const {signal, onProgress} = options;
  const trim = options.trim ? {...options.trim} : undefined;
  signal?.throwIfAborted();
  validateVideoFile(file);
  const input = new Input({source: new BlobSource(file), formats: ALL_FORMATS});
  const cancel = () => input.dispose();
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video || !await video.canDecode()) throw new Error('This browser cannot decode the video. Try an H.264 MP4 in Chrome.');
    const start = await video.getFirstTimestamp();
    const sourceDuration = (await video.computeDuration()) - start;
    const selection = resolveReferenceTrim(sourceDuration, trim);
    const durationSeconds = selection.endSeconds - selection.startSeconds;
    const times = referenceSampleTimes(durationSeconds);
    const scale = Math.min(1, reverseEngineeringLimits.frameSide / Math.max(video.displayWidth, video.displayHeight));
    const sink = new CanvasSink(video, {width: Math.max(1, Math.round(video.displayWidth * scale)), height: Math.max(1, Math.round(video.displayHeight * scale)), fit: 'contain', poolSize: 1});
    const frames: PreparedVideoReference['frames'] = [];
    for await (const frame of sink.canvasesAtTimestamps(times.map(time => time + start + selection.startSeconds))) {
      signal?.throwIfAborted();
      if (!frame) throw new Error(`No video frame could be decoded at ${times[frames.length]}s.`);
      const canvas = frame.canvas as HTMLCanvasElement;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
      frames.push({timeSeconds: times[frames.length], dataUrl});
      onProgress?.({stage: 'extracting', completed: frames.length, total: times.length, message: `Captured ${frames.length} of ${times.length} frames`});
    }
    signal?.throwIfAborted();
    const audio = await input.getPrimaryAudioTrack();
    let preparedAudio: PreparedVideoReference['audio'] = {status: 'no-audio', chunks: [], message: 'The video has no audio track.'};
    if (audio) {
      try {
        onProgress?.({stage: 'extracting', completed: times.length, total: times.length, message: 'Extracting audio for transcription'});
        const offset = (await audio.getFirstTimestamp()) - start - selection.startSeconds;
        const buffer = await decodeMediaAudio(file, {sampleRate: 16000});
        signal?.throwIfAborted();
        const chunks = splitReferenceAudio(buffer, offset, durationSeconds);
        preparedAudio = {status: 'ready', chunks};
      } catch (error) {
        signal?.throwIfAborted();
        preparedAudio = {status: 'unavailable', chunks: [], message: `Audio could not be decoded; visual analysis only. ${error instanceof Error ? error.message : String(error)}`};
      }
    }
    return {metadata: {name: file.name, durationSeconds, width: video.displayWidth, height: video.displayHeight, sampleIntervalSeconds: 1, source: {...selection, durationSeconds: sourceDuration}}, frames, audio: preparedAudio};
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {signal?.removeEventListener('abort', cancel); input.dispose();}
}

/** Prefer quiet boundaries near 20s, downmix to mono, and retain source-relative chunk ranges. */
export function splitReferenceAudio(buffer: AudioBuffer, offset: number, videoDuration: number): ReferenceAudioChunk[] {
  const rate = buffer.sampleRate;
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < mono.length; index++) mono[index] += data[index] / buffer.numberOfChannels;
  }
  const first = Math.max(0, Math.ceil(-offset * rate));
  const last = Math.min(mono.length, Math.ceil((videoDuration - offset) * rate));
  // Lossy decoding/resampling can overshoot full scale even for a valid source file.
  let peak = 1;
  for (let index = first; index < last; index++) peak = Math.max(peak, Math.abs(mono[index]));
  if (peak > 1) for (let index = first; index < last; index++) mono[index] /= peak;
  const chunks: ReferenceAudioChunk[] = [];
  for (let start = first; start < last;) {
    let end = Math.min(last, start + 20 * rate);
    if (end < last) {
      const boundary = end;
      let quietest = Infinity;
      const window = Math.round(rate * 0.05);
      for (let candidate = boundary - 2 * rate; candidate + window <= boundary; candidate += window) {
        let energy = 0;
        for (let index = candidate; index < candidate + window; index++) energy += mono[index] ** 2;
        if (energy < quietest) {quietest = energy; end = candidate + window;}
      }
    }
    const data = mono.subarray(start, end);
    chunks.push({startSeconds: Math.max(0, offset + start / rate), endSeconds: Math.min(videoDuration, offset + end / rate), blob: encodeWav({numberOfChannels: 1, length: data.length, sampleRate: rate, getChannelData: () => data})});
    start = end;
  }
  return chunks;
}
