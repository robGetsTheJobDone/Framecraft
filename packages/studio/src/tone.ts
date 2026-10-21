import {encodeWav} from '@deepbench/studio-audio';
export function tone(seconds: number, music = false): Blob {
  const rate = 24000;
  const data = Float32Array.from({length: Math.round(seconds * rate)}, (_, i) => {
    const t = i / rate;
    const note = music ? [220, 277.18, 329.63, 277.18][Math.floor(t * 2) % 4] : 440;
    const envelope = Math.min(1, t * 20, (seconds - t) * 20);
    return Math.sin(t * 2 * Math.PI * note) * 0.13 * envelope;
  });
  return encodeWav({numberOfChannels: 1, length: data.length, sampleRate: rate, getChannelData: () => data});
}
