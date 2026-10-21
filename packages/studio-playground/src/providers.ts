import {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage, type BaseMessage} from '@langchain/core/messages';
import {ChatOpenAI} from '@langchain/openai';
import {encodeWav, decodeMediaAudio} from '@deepbench/studio-audio';
import {createLangChainScriptProvider} from '@deepbench/browser-studio';
import type {DubbingWizardOptions} from '@deepbench/studio-dubbing';
import type {StudioProject} from '@deepbench/studio-project';

export interface Connection {baseURL: string; model: string; token: string; speechURL: string; useResponsesApi?: boolean}
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

/** Local deterministic tool-calling demo, explicitly presented as a demo in the UI. */
export class DemoModel extends BaseChatModel {
  constructor() {super({});}
  _llmType() {return 'deepbench-demo';}
  bindTools() {return this;}
  async _generate(messages: BaseMessage[]) {
    const last = messages.at(-1)!;
    const user = [...messages].reverse().find(message => message.type === 'human');
    const request = typeof user?.content === 'string' ? user.content : '';
    let message: AIMessage;
    if (last.type !== 'tool') {
      if (/^(title\s*:|mute music|unmute music)/i.test(request.trim())) message = new AIMessage({content: '', tool_calls: [{id: crypto.randomUUID(), name: 'get_studio_project', args: {}}]});
      else message = new AIMessage('Demo chat supports “title: Your words”, “mute music”, and “unmute music”. Connect a model gateway in Settings for open-ended AI editing.');
    } else {
      let result: {project?: StudioProject; expectedProjectJson?: string; saved?: boolean};
      try { result = JSON.parse(String(last.content)); } catch { result = {}; }
      if (result.project) {
        const project = result.project;
        if (/^title\s*:/i.test(request.trim())) {
          const text = request.replace(/^\s*title\s*:\s*/i, '').trim() || 'Untitled';
          project.title = text;
          const track = project.tracks.find(item => item.kind === 'text');
          if (track) track.clips = [{id: crypto.randomUUID(), kind: 'text', text, startSeconds: 0, durationSeconds: project.durationSeconds}];
        } else {
          const track = project.tracks.find(item => item.id === 'music');
          if (track) track.muted = !/^unmute/i.test(request.trim());
        }
        message = new AIMessage({content: '', tool_calls: [{id: crypto.randomUUID(), name: 'save_studio_project', args: {projectJson: JSON.stringify(project), expectedProjectJson: result.expectedProjectJson}}]});
      } else message = new AIMessage(result.saved ? 'Saved to your timeline. The preview is updating.' : 'The edit could not be saved. Try again after checking the timeline.');
    }
    return {generations: [{text: typeof message.content === 'string' ? message.content : '', message}]};
  }
}

export function createProviders(connection: Connection | null): {model: BaseChatModel; dubbing: DubbingWizardOptions} {
  if (!connection) return {
    model: new DemoModel(),
    dubbing: {
      scriptProvider: {draft: async ({prompt, source, signal}) => {signal.throwIfAborted(); return [{id: 'demo-line', text: prompt.trim(), startSeconds: source.startSeconds, durationSeconds: source.durationSeconds}];}},
      speechProvider: {synthesize: async ({targetDurationSeconds, signal}) => {signal.throwIfAborted(); const durationSeconds = Math.min(targetDurationSeconds, 2); return {blob: tone(durationSeconds), durationSeconds};}},
    },
  };
  const baseURL = checkedURL(connection.baseURL);
  const model = new ChatOpenAI({model: connection.model, apiKey: connection.token || 'local-gateway', configuration: {baseURL, dangerouslyAllowBrowser: true}, useResponsesApi: connection.useResponsesApi ?? false});
  return {model, dubbing: {
    scriptProvider: createLangChainScriptProvider(model),
    speechProvider: {synthesize: async ({signal, ...request}) => {
      if (!connection.speechURL) throw new Error('Set a speech endpoint in Settings before generating a voiceover.');
      const response = await fetch(checkedURL(connection.speechURL), {method: 'POST', signal, headers: {'Content-Type': 'application/json', ...(connection.token ? {Authorization: `Bearer ${connection.token}`} : {})}, body: JSON.stringify(request)});
      if (!response.ok) throw new Error(`Speech endpoint returned ${response.status}`);
      const blob = await response.blob();
      const audio = await decodeMediaAudio(blob);
      signal.throwIfAborted();
      return {blob, durationSeconds: audio.duration};
    }},
  }};
}
export function checkedURL(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS or a localhost endpoint.');
  if (url.username || url.password) throw new Error('Use the token field instead of credentials in the URL.');
  return url.href;
}

/** Same-origin API: the provider secret is held exclusively by the local Node server. */
export const serverImageProvider = {
  async generate({prompt, signal}: {prompt: string; signal?: AbortSignal}) {
    const response = await fetch('/api/images/generate', {method: 'POST', signal, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({prompt})});
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || `Image generation failed (${response.status})`);
    }
    const blob = await response.blob();
    const image = await createImageBitmap(blob);
    try {return {blob, width: image.width, height: image.height};} finally {image.close();}
  },
};
