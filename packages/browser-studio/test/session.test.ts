import {describe, expect, it} from 'vitest';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage, type BaseMessage} from '@langchain/core/messages';
import {openStudioSession, createLangChainScriptProvider} from '../src/index.js';

class TimelineModel extends BaseChatModel {
  calls = 0;
  constructor() { super({}); }
  _llmType() { return 'offline-studio-edit'; }
  bindTools() { return this; }
  async _generate(messages: BaseMessage[]) {
    const call = this.calls++;
    let message: AIMessage;
    if (call === 0) message = new AIMessage({content: '', tool_calls: [{name: 'get_studio_project', args: {}, id: 'read'}]});
    else if (call === 1) {
      const {project, expectedProjectJson} = JSON.parse(messages.at(-1)!.content as string);
      project.title = 'Agent edited video';
      project.tracks.find((track: {id: string}) => track.id === 'titles').clips.push({id: 'intro', kind: 'text', text: 'Hello studio', startSeconds: 0, durationSeconds: 1});
      message = new AIMessage({content: '', tool_calls: [{name: 'save_studio_project', args: {projectJson: JSON.stringify(project), expectedProjectJson}, id: 'save'}]});
    } else message = new AIMessage('Timeline saved');
    return {generations: [{text: typeof message.content === 'string' ? message.content : '', message}]};
  }
}

describe('studio session', () => {
  it('sets clip dB and fades through the agent tool and rejects invalid edits atomically',async()=>{
    const session=await openStudioSession({filesystem:new MemoryFileSystem(),conversationId:'mix-controls'});
    await session.importAsset({id:'song',kind:'audio',mimeType:'audio/wav',durationSeconds:8},new Uint8Array([1]));
    await session.store.update(project=>{project.tracks.find(t=>t.id==='music')!.clips.push({id:'song',kind:'audio',assetId:'song',startSeconds:0,durationSeconds:8,sourceStartSeconds:0});});
    const tool=session.tools.find(t=>t.name==='set_audio_clip')!;
    await tool.invoke({clipId:'song',volumeDb:-12,fadeInSeconds:.5,fadeOutSeconds:1,muted:null});
    const before=await session.store.load();
    expect(before.tracks.find(t=>t.id==='music')!.clips[0]).toMatchObject({gain:10**(-12/20),fadeInSeconds:.5,fadeOutSeconds:1});
    await expect(tool.invoke({clipId:'song',volumeDb:null,fadeInSeconds:8,fadeOutSeconds:null,muted:null})).rejects.toThrow();
    expect(await session.store.load()).toEqual(before);
    await session.setAudioClip({clipId:'song',volumeDb:null,fadeInSeconds:null,fadeOutSeconds:null,muted:true});
    expect((await session.store.load()).tracks.find(t=>t.id==='music')!.clips[0]).toMatchObject({muted:true,gain:10**(-12/20)});
  });

  it('seeds once, isolates conversations, and runs a real agent with revisioned timeline tools', async () => {
    const filesystem = new MemoryFileSystem();
    const first = await openStudioSession({filesystem, conversationId: 'first', seed: {title: 'First'}});
    const second = await openStudioSession({filesystem, conversationId: 'second', seed: {title: 'Second'}});
    const agent = first.createAgent({model: new TimelineModel()});
    await agent.invoke({messages: [{role: 'user', content: 'Add a title.'}]});
    expect((await first.store.load()).title).toBe('Agent edited video');
    expect((await first.store.listRevisions()).length).toBe(1);
    expect((await second.store.load()).title).toBe('Second');
    const reopened = await openStudioSession({filesystem, conversationId: 'first', seed: {title: 'Do not overwrite'}});
    expect((await reopened.store.load()).title).toBe('Agent edited video');
    await expect(first.filesystem.readFile('/../../second/project.json')).rejects.toThrow();
  });

  it('retains concurrent media imports and rejects overwrite of immutable assets', async () => {
    const session = await openStudioSession({filesystem: new MemoryFileSystem(), conversationId: 'imports'});
    await Promise.all(['one', 'two'].map(id => session.importAsset({id, kind: 'audio', mimeType: 'audio/wav', durationSeconds: 1}, new Uint8Array([1, 2]))));
    const project = await session.store.load();
    expect(project.assets.map(asset => asset.id).sort()).toEqual(['one', 'two']);
    expect(new Uint8Array(await (await session.resolveAsset(project.assets[0])).arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    await expect(session.importAsset({id: 'one', kind: 'audio', mimeType: 'audio/wav'}, new Uint8Array([3]))).rejects.toThrow('already exists');
  });

  it('rejects stale agent saves after an intervening edit', async () => {
    const session = await openStudioSession({filesystem: new MemoryFileSystem(), conversationId: 'stale'});
    const current = await session.store.load();
    await session.store.update(project => { project.title = 'Human edit'; });
    await expect(session.tools.find(item => item.name === 'save_studio_project')!.invoke({projectJson: JSON.stringify(current), expectedProjectJson: JSON.stringify(current)})).rejects.toThrow();
    expect((await session.store.load()).title).toBe('Human edit');
  });

  it('passes cancellation and structured source metadata to the AI script adapter', async () => {
    const controller = new AbortController();
    const source = {asset: {id: 'v', kind: 'video' as const, path: 'assets/v', mimeType: 'video/webm'}, clipId: 'v', trackId: 'video', startSeconds: 0, durationSeconds: 2, sourceStartSeconds: 0};
    let received: unknown;
    const model = {withStructuredOutput: () => ({invoke: async (messages: unknown, config: unknown) => { received = {messages, config}; return {segments: [{id: 's', text: 'Hello', startSeconds: 0, durationSeconds: 2}]}; }})};
    const provider = createLangChainScriptProvider(model as unknown as BaseChatModel);
    expect(await provider.draft({prompt: 'Introduce the product', language: 'en', source, signal: controller.signal})).toHaveLength(1);
    expect(received).toMatchObject({config: {signal: controller.signal}});
    expect(JSON.stringify(received)).toContain('Introduce the product');
  });
});

describe('agent scenes and voiceover requests', () => {
  it('persists generated image clips for Remotion and rejects invalid timing before generation', async () => {
    let calls = 0;
    const filesystem = new MemoryFileSystem();
    const session = await openStudioSession({filesystem, conversationId: 'images', imageProvider: {generate: async () => {calls++; return {blob: new Blob(['image'], {type: 'image/png'}), width: 100, height: 100};}}});
    await expect(session.generateSceneImage({prompt: 'forest', name: 'Forest', startSeconds: 29, durationSeconds: 5})).rejects.toThrow();
    expect(calls).toBe(0);
    const result = await session.generateSceneImage({prompt: 'forest', name: 'Forest', startSeconds: 0, durationSeconds: 5});
    const reopened = await openStudioSession({filesystem, conversationId: 'images'});
    const preview = await reopened.preparePreview();
    expect(preview.composition.inputProps.project.tracks.flatMap(t => t.clips)).toContainEqual(expect.objectContaining({kind: 'image', assetId: result.asset.id}));
    expect(preview.composition.inputProps.assetUrls[result.asset.id]).toMatch(/^blob:/);
    preview.dispose();
  });
  it('keeps requests silent until host approval and replaces the request with audio', async () => {
    const filesystem = new MemoryFileSystem();
    const session = await openStudioSession({filesystem, conversationId: 'requests'});
    const tool = session.tools.find(t => t.name === 'request_voiceover')!;
    const {clipId} = JSON.parse(await tool.invoke({title: 'Intro', script: 'Welcome.', language: 'en', startSeconds: 2, durationSeconds: 4}) as string);
    expect((await session.store.load()).assets).toHaveLength(0);
    const preview = await session.preparePreview(); preview.dispose();
    const reopened = await openStudioSession({filesystem, conversationId: 'requests'});
    let spoken = '';
    await reopened.approveVoiceover(clipId, 'Welcome to the forest.', {synthesize: async request => {spoken = request.text; return {blob: new Blob(['audio'], {type: 'audio/wav'}), durationSeconds: 3};}}, new AbortController().signal);
    expect(spoken).toBe('Welcome to the forest.');
    const project = await reopened.store.load();
    expect(project.tracks.flatMap(t => t.clips).find(c => c.id === clipId)).toMatchObject({kind: 'audio', startSeconds: 2, durationSeconds: 3});
    expect(project.dubbingScripts[0].segments[0].text).toBe(spoken);
  });
  it('preserves pending requests on speech errors, overflow, cancellation and stale edits', async () => {
    const session = await openStudioSession({filesystem: new MemoryFileSystem(), conversationId: 'errors'});
    const {clipId} = await session.requestVoiceover({title: 'Intro', script: 'Hello.', language: 'en', startSeconds: 0, durationSeconds: 2});
    const audio = {blob: new Blob(['audio'], {type: 'audio/wav'}), durationSeconds: 1};
    await expect(session.approveVoiceover(clipId, 'Hello.', {synthesize: async () => ({...audio, durationSeconds: 3})}, new AbortController().signal)).rejects.toThrow('longer');
    await expect(session.approveVoiceover(clipId, 'Hello.', {synthesize: async () => {await session.store.update(p => {const c = p.tracks.flatMap(t => t.clips).find(c => c.id === clipId)!; c.startSeconds = 1;}); return audio;}}, new AbortController().signal)).rejects.toThrow('changed');
    const controller = new AbortController(); controller.abort();
    await expect(session.approveVoiceover(clipId, 'Hello.', {synthesize: async () => audio}, controller.signal)).rejects.toThrow();
    expect((await session.store.load()).assets).toHaveLength(0);
    expect((await session.store.load()).tracks.flatMap(t => t.clips).find(c => c.id === clipId)?.kind).toBe('voiceover');
  });
});
