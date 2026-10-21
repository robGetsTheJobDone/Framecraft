import type {BrowserFileSystem} from '@deepbench/browser-filesystem';
import {createBrowserAgent, type BrowserAgentOptions} from '@deepbench/browser-deepagents';
import {createProjectStore, assertValidProject, type SeedOptions, type StudioAsset, type StudioProject} from '@deepbench/studio-project';
import {mixProjectAudio, decodeMediaAudio, encodeWav, type MixProjectAudioOptions} from '@deepbench/studio-audio';
import {DubbingWizard, type DubbingWizardOptions, type ScriptProvider, type SpeechProvider} from '@deepbench/studio-dubbing';
import {prepareStudioComposition, exportComposition, type BrowserExportOptions} from '@deepbench/browser-remotion';
import {tool} from '@langchain/core/tools';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {z} from 'zod';

/** Browser recordings may decode slightly above full scale (e.g. Opus overshoot). */
export async function prepareVoiceoverRecording(blob:Blob){
  const audio=await decodeMediaAudio(blob);let peak=1;
  for(let channel=0;channel<audio.numberOfChannels;channel++)for(const sample of audio.getChannelData(channel)){
    if(!Number.isFinite(sample))throw new Error('Recording contains invalid audio samples.');
    peak=Math.max(peak,Math.abs(sample));
  }
  if(peak>1)for(let channel=0;channel<audio.numberOfChannels;channel++){
    const samples=audio.getChannelData(channel);for(let index=0;index<samples.length;index++)samples[index]/=peak*1.000001;
  }
  return {blob:encodeWav(audio),durationSeconds:audio.duration};
}

export const STUDIO_AGENT_PROMPT = `You help create and edit a video studio project for this conversation.
Read /AGENTS.md and /brief.md. Use get_studio_project and save_studio_project to edit the timeline with validated revisions.
All clip times are seconds. Source offsets trim media; audio gain is linear in project JSON. Use set_audio_clip for volume in dB and fadeInSeconds/fadeOutSeconds; null preserves a setting. Fades cannot overlap. Volume/fade edits do not require music regeneration. Track/clip mute only silences audio and never hides video.
Use generate_scene_image when original scene imagery is requested and the tool is available. Plan coherent prompts and sequential scene timing; extend project duration first if needed. Images use image tracks, assetId, startSeconds, durationSeconds, and optional objectFit (cover or contain). Text tracks overlay scenes; edit starter titles to fit the brief. Preserve existing assets. Use separate voiceover and music tracks. Use mix_studio_audio when a standalone WAV mix is requested.
Use request_voiceover to write a script and place a pending voiceover request on the timeline. The user clicks its exclamation mark to read/edit the script and record their own voice line by line in the teleprompter. Never claim a pending request is audible. Microphone recording is user-controlled; never synthesize speech for these requests. Do not claim speech generation or export succeeded without a tool result.
Only this conversation's files are available. Do not store provider secrets in files.`;

export interface ImageGenerationProvider {
  generate(request: {prompt: string; signal?: AbortSignal}): Promise<{blob: Blob; width: number; height: number}>;
}
const sceneSchema = z.object({prompt: z.string().trim().min(1).max(16000), name: z.string().min(1).max(200), startSeconds: z.number().finite().nonnegative(), durationSeconds: z.number().finite().positive()});

export const audioClipSettingsSchema = z.object({
 clipId:z.string().min(1),
 volumeDb:z.number().finite().min(-60).max(36).nullable(),
 fadeInSeconds:z.number().finite().nonnegative().nullable(),
 fadeOutSeconds:z.number().finite().nonnegative().nullable(),
 muted:z.boolean().nullable(),
});
export const audioClipSettingsDescription = 'Adjust an existing audio/video timeline clip without regenerating music or changing visuals. volumeDb is relative gain (-60 to +36 dB, 0 is unchanged source level); fade durations are seconds, cannot overlap or exceed duration. Null leaves a setting unchanged. Use muted for silence.';
/** Open once per active conversation; share this store between UI and agent operations. */
export async function openStudioSession(options: {filesystem: BrowserFileSystem; conversationId: string; seed?: SeedOptions; imageProvider?: ImageGenerationProvider}) {
  const store = createProjectStore(options.filesystem, options.conversationId);
  await store.seed(options.seed);
  const resolveAsset = async (asset: StudioAsset): Promise<Blob> => {
    // Validate before resolving a user/agent-controlled path into the scoped filesystem.
    store.resolveAssetPath(asset);
    const bytes = await store.filesystem.readFile(`/${asset.path}`);
    return new Blob([new Uint8Array(bytes)], {type: asset.mimeType});
  };
  const mixAudio = async (mixOptions: Omit<MixProjectAudioOptions, 'resolveAsset'> = {}) => {
    const result = await mixProjectAudio(await store.load(), {...mixOptions, resolveAsset});
    const path = `/exports/mix-${crypto.randomUUID()}.wav`;
    await store.filesystem.writeFile(path, new Uint8Array(await result.blob.arrayBuffer()), {createParents: true, exclusive: true});
    return {...result, path};
  };
  const prepare = async (project: StudioProject) => {
    const snapshot = structuredClone(project);
    const audible = snapshot.tracks.some(track => !track.muted && track.gain !== 0 && track.clips.some(clip => (clip.kind === 'audio' || clip.kind === 'video') && !clip.muted && clip.gain !== 0));
    if (!audible) return {...await prepareStudioComposition(snapshot, resolveAsset), normalizationGain: 1, peak: 0};
    // Preview and video export share the sample-accurate normalized mix, avoiding
    // independent per-frame audio fades/gain and different clipping behavior.
    const mix = await mixProjectAudio(snapshot, {resolveAsset});
    const mixId = `mix-${crypto.randomUUID()}`;
    const mixAsset: StudioAsset = {id: mixId, kind: 'audio', path: `assets/${mixId}`, mimeType: 'audio/wav', durationSeconds: snapshot.durationSeconds};
    snapshot.assets.push(mixAsset);
    snapshot.tracks = snapshot.tracks.filter(track => track.kind !== 'audio').map(track => track.kind === 'video' ? {...track, muted: true} : track);
    snapshot.tracks.push({id: mixId, kind: 'audio', name: 'Preview mix', clips: [{id: mixId, kind: 'audio', assetId: mixId, startSeconds: 0, sourceStartSeconds: 0, durationSeconds: snapshot.durationSeconds}]});
    return {...await prepareStudioComposition(snapshot, asset => asset.id === mixId ? Promise.resolve(mix.blob) : resolveAsset(asset)), normalizationGain: mix.normalizationGain, peak: mix.peak};
  };
  const exportVideo = async (exportOptions: BrowserExportOptions = {}) => {
    exportOptions.signal?.throwIfAborted();
    const prepared = await prepare(await store.load());
    try {
      const blob = await exportComposition(prepared.composition, exportOptions);
      const path = `/exports/video-${crypto.randomUUID()}.${exportOptions.format ?? 'mp4'}`;
      await store.filesystem.writeFile(path, new Uint8Array(await blob.arrayBuffer()), {createParents: true, exclusive: true});
      return {blob, path, peak: prepared.peak, normalizationGain: prepared.normalizationGain};
    } finally { prepared.dispose(); }
  };
  const generateSceneImage = async (request: z.infer<typeof sceneSchema>, signal?: AbortSignal) => {
    const input = sceneSchema.parse(request);
    if (!options.imageProvider) throw new Error('Image generation is not configured by this host.');
    const checkTiming = (project: StudioProject) => {
      if (input.startSeconds + input.durationSeconds > project.durationSeconds) throw new Error('Scene exceeds project duration. Extend the timeline first.');
    };
    checkTiming(await store.load());
    signal?.throwIfAborted();
    const result = await options.imageProvider.generate({prompt: input.prompt, signal});
    signal?.throwIfAborted();
    if (!result.blob.size || !result.blob.type.startsWith('image/')) throw new Error('Provider returned no image.');
    let asset!: StudioAsset;
    const clipId = crypto.randomUUID();
    await store.update(async project => {
      checkTiming(project);
      asset = await store.writeAsset({id: crypto.randomUUID(), kind: 'image', name: input.name, mimeType: result.blob.type, width: result.width, height: result.height}, result.blob);
      project.assets.push(asset);
      let track = project.tracks.find(t => t.kind === 'image');
      if (!track) {
        track = {id: crypto.randomUUID(), kind: 'image', name: 'Scenes', clips: []};
        const titles = project.tracks.findIndex(t => t.kind === 'text');
        project.tracks.splice(titles < 0 ? project.tracks.length : titles, 0, track);
      }
      track.clips.push({id: clipId, kind: 'image', assetId: asset.id, startSeconds: input.startSeconds, durationSeconds: input.durationSeconds, objectFit: 'cover'});
    });
    return {asset, clipId};
  };
  const requestVoiceover = async (input: {title: string; script: string; language: string; startSeconds: number; durationSeconds: number}) => {
    const clip = {id: crypto.randomUUID(), kind: 'voiceover' as const, ...input};
    await store.update(project => {
      let track = project.tracks.find(t => t.kind === 'voiceover');
      if (!track) {track = {id: crypto.randomUUID(), kind: 'voiceover', name: 'Voiceover requests', clips: []}; project.tracks.push(track);}
      track.clips.push(clip);
    });
    return {clipId: clip.id, status: 'awaiting_user_review'};
  };
  /** Host-only action: the agent can request speech, but cannot approve it. */
  const approveVoiceover = async (clipId: string, script: string, provider: SpeechProvider, signal: AbortSignal) => {
    if (!script.trim() || script.length > 4096) throw new Error('Provide a script of 1–4096 characters.');
    const project = await store.load();
    const clip = project.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (clip?.kind !== 'voiceover') throw new Error('Voiceover request no longer exists.');
    const fingerprint = JSON.stringify(clip);
    signal.throwIfAborted();
    const result = await provider.synthesize({text: script, language: clip.language, targetDurationSeconds: clip.durationSeconds, signal});
    signal.throwIfAborted();
    if (!result.blob.size || !result.blob.type.startsWith('audio/') || !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0) throw new Error('Speech provider returned invalid audio.');
    if (result.durationSeconds > clip.durationSeconds) throw new Error('Speech is longer than the requested slot. Shorten the script or extend the clip duration, then try again.');
    await store.update(async current => {
      const track = current.tracks.find(t => t.clips.some(c => c.id === clipId));
      const pending = track?.clips.find(c => c.id === clipId);
      if (JSON.stringify(pending) !== fingerprint) throw new Error('Voiceover request changed. Review it again before generating.');
      if (clip.startSeconds + result.durationSeconds > current.durationSeconds) throw new Error('Project duration changed. Review the voiceover timing.');
      const asset = await store.writeAsset({id: crypto.randomUUID(), kind: 'audio', name: clip.title, mimeType: result.blob.type, durationSeconds: result.durationSeconds}, result.blob);
      current.assets.push(asset);
      let audioTrack = current.tracks.find(t => t.id === 'voiceover' && t.kind === 'audio');
      if (!audioTrack) {audioTrack = {id: crypto.randomUUID(), kind: 'audio', name: 'Voiceover', clips: []}; current.tracks.push(audioTrack);}
      audioTrack.clips.push({id: clipId, kind: 'audio', assetId: asset.id, startSeconds: clip.startSeconds, durationSeconds: result.durationSeconds, sourceStartSeconds: 0});
      track!.clips = track!.clips.filter(c => c.id !== clipId);
      current.dubbingScripts.push({id: crypto.randomUUID(), title: clip.title, language: clip.language, segments: [{id: clipId, text: script, startSeconds: clip.startSeconds, durationSeconds: result.durationSeconds, audioAssetId: asset.id}]});
    });
  };
  const applyVoiceoverRecordings = async (clipId:string, expectedClip:string, takes:Array<{text:string;blob:Blob}>) => {
    if(!takes.length || takes.length>100)throw new Error('Record between 1 and 100 lines.');
    const decoded:Array<{text:string;blob:Blob;durationSeconds:number}>=[];
    for(const take of takes){
      if(!take.text.trim()||!take.blob.size)throw new Error('Each line needs text and a recording.');
      const audio=await prepareVoiceoverRecording(take.blob);
      decoded.push({text:take.text,...audio});
    }
    await store.update(async project=>{
      const requestTrack=project.tracks.find(track=>track.clips.some(clip=>clip.id===clipId));
      const request=requestTrack?.clips.find(clip=>clip.id===clipId);
      if(request?.kind!=='voiceover'||JSON.stringify(request)!==expectedClip)throw new Error('Voiceover request changed. Reopen the teleprompter before applying recordings.');
      const duration=decoded.reduce((sum,take)=>sum+take.durationSeconds,0);
      if(duration>request.durationSeconds||request.startSeconds+duration>project.durationSeconds)throw new Error('Recordings exceed the voiceover slot. Retake shorter lines or extend the slot.');
      let track=project.tracks.find(track=>track.id==='voiceover'&&track.kind==='audio');
      if(!track){track={id:crypto.randomUUID(),kind:'audio',name:'Voiceover',clips:[]};project.tracks.push(track);}
      let start=request.startSeconds;const segments=[];
      for(const [index,take] of decoded.entries()){
        const id=crypto.randomUUID();
        const asset=await store.writeAsset({id,kind:'audio',name:`${request.title} · line ${index+1}`,mimeType:'audio/wav',durationSeconds:take.durationSeconds},take.blob);
        project.assets.push(asset);
        track.clips.push({id,kind:'audio',assetId:id,startSeconds:start,sourceStartSeconds:0,durationSeconds:take.durationSeconds});
        segments.push({id,text:take.text,startSeconds:start,durationSeconds:take.durationSeconds,audioAssetId:id});start+=take.durationSeconds;
      }
      requestTrack!.clips=requestTrack!.clips.filter(clip=>clip.id!==clipId);
      project.dubbingScripts.push({id:crypto.randomUUID(),title:request.title,language:request.language,segments});
    });
  };
  const setAudioClip = async (input:z.infer<typeof audioClipSettingsSchema>) => {
    const settings=audioClipSettingsSchema.parse(input);
    await store.update(project=>{
      const clip=project.tracks.flatMap(track=>track.clips).find(clip=>clip.id===settings.clipId);
      if(!clip || (clip.kind!=='audio' && clip.kind!=='video'))throw new Error('Select an existing audio or video clip.');
      if(settings.volumeDb!==null)clip.gain=10**(settings.volumeDb/20);
      if(settings.fadeInSeconds!==null)clip.fadeInSeconds=settings.fadeInSeconds;
      if(settings.fadeOutSeconds!==null)clip.fadeOutSeconds=settings.fadeOutSeconds;
      if(settings.muted!==null)clip.muted=settings.muted;
    });
    return {updated:true,clipId:settings.clipId};
  };
  const tools = [
    tool(async input=>JSON.stringify(await setAudioClip(input)),{name:'set_audio_clip',description:audioClipSettingsDescription,schema:audioClipSettingsSchema}),
    tool(async input => JSON.stringify(await requestVoiceover(input)), {name: 'request_voiceover', description: 'Place a pending voiceover clip on the timeline with a script for user review. It displays an exclamation mark; the user opens a teleprompter to record each line themselves. No audio is generated by this tool. Write a concise script that fits the duration.', schema: z.object({title: z.string().trim().min(1), script: z.string().trim().min(1).max(4096), language: z.string().trim().min(1), startSeconds: z.number().finite().nonnegative(), durationSeconds: z.number().finite().positive()})}),
    ...(options.imageProvider ? [tool(async (request, config) => JSON.stringify(await generateSceneImage(request, config.signal)), {name: 'generate_scene_image', description: 'Generate an image from a detailed visual prompt and add it as a timed scene. Makes a paid image API call. Read the project first; scene must fit its duration. Returns the saved asset and clip ID. Do not repeat successful calls.', schema: sceneSchema})] : []),
    tool(async () => { const project = await store.load(); return JSON.stringify({project, expectedProjectJson: JSON.stringify(project)}); }, {name: 'get_studio_project', description: 'Read the validated current timeline and expectedProjectJson token for safe subsequent saving.', schema: z.object({})}),
    tool(async ({projectJson, expectedProjectJson}) => {
      const project: unknown = JSON.parse(projectJson);
      assertValidProject(project);
      const revision = await store.save(project, {expectedProjectJson});
      return JSON.stringify({saved: true, revision});
    }, {name: 'save_studio_project', description: 'Validate and save edited project JSON with a revision. Pass the expectedProjectJson from get_studio_project; stale saves are rejected. Retain existing assets.', schema: z.object({projectJson: z.string(), expectedProjectJson: z.string()})}),
    tool(async () => {
      const result = await mixAudio();
      return JSON.stringify({path: result.path, bytes: result.blob.size, peak: result.peak, normalizationGain: result.normalizationGain});
    }, {name: 'mix_studio_audio', description: 'Render all audible timeline audio/video clips into a WAV file under /exports. Requires browser-decodable source audio.', schema: z.object({})}),
    tool(async ({format}) => {
      const result = await exportVideo({format});
      return JSON.stringify({path: result.path, bytes: result.blob.size, normalizationGain: result.normalizationGain});
    }, {name: 'export_studio_video', description: 'Render this timeline to a video in the browser with its normalized audio mix and save under /exports.', schema: z.object({format: z.enum(['mp4', 'webm'])})}),
  ];
  return {
    store,
    filesystem: store.filesystem,
    tools,
    resolveAsset,
    mixAudio,
    exportVideo,
    generateSceneImage,
    requestVoiceover,
    setAudioClip,
    approveVoiceover,
    applyVoiceoverRecordings,
    /** Store immutable media, then register it in a project revision. A failed save can leave an unused file. */
    async importAsset(metadata: Omit<StudioAsset, 'path'>, data: Blob | Uint8Array): Promise<StudioAsset> {
      let imported: StudioAsset | undefined;
      await store.update(async project => {
        if (project.assets.some(asset => asset.id === metadata.id)) throw new Error(`Asset ${metadata.id} already exists`);
        imported = await store.writeAsset(metadata, data);
        project.assets.push(imported);
      });
      return imported!;
    },
    async preparePreview() { return prepare(await store.load()); },
    createAgent(agentOptions: Omit<BrowserAgentOptions, 'filesystem'>) {
      return createBrowserAgent({...agentOptions, filesystem: store.filesystem, systemPrompt: agentOptions.systemPrompt ?? STUDIO_AGENT_PROMPT, tools: [...tools, ...(agentOptions.tools ?? [])]});
    },
    createDubbingWizard(wizardOptions: DubbingWizardOptions) { return new DubbingWizard(wizardOptions); },
  };
}
export type StudioSession = Awaited<ReturnType<typeof openStudioSession>>;

const scriptSchema = z.object({segments: z.array(z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  text: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
})).min(1)});

/** A real LangChain structured-output adapter. Supply a brief/transcript; metadata alone is not video understanding. */
export function createLangChainScriptProvider(model: BaseChatModel): ScriptProvider {
  const writer = model.withStructuredOutput(scriptSchema, {name: 'dubbing_script'});
  return {
    async draft({prompt, language, source, signal}) {
      const result = await writer.invoke([
        {role: 'system', content: 'Write a voiceover script from the user brief or transcript. Return ordered non-overlapping timed segments, entirely inside the supplied video clip timeline. Timing is absolute project seconds. Use concise text that fits each segment. You have metadata, not video frames: do not claim to have watched the video. Use safe unique segment IDs.'},
        {role: 'user', content: JSON.stringify({brief: prompt, language, source})},
      ], {signal});
      return scriptSchema.parse(result).segments;
    },
  };
}

export type {StudioProject};

export {createAdSession, importAdBundle, importAdZip, restoreAdSession} from './ad-session.js';
export type {AdSession, AdSessionOptions, StudioAdapters, StudioEvent, AgentConfig, VisualReview} from './ad-session.js';
export {adDesignSkills, pierogiBrandSkill} from './ad-skills.js';
export {defaultSkills, createSkillRegistry} from './skills.js';
export type {StudioSkill, AgentRole} from './skills.js';
export type {ProductContextOptions} from './context-files.js';
export {prepareContextFiles} from './context-files.js';

export {CheckpointConflictError, UncertainToolCallError} from './checkpoints.js';
export type {CheckpointAdapter} from './checkpoints.js';

export {createZipFileAdapter, snapshotToZip, zipToSnapshot} from './zip.js';

export type {SceneOperation, SceneEdit} from './scene-session.js';
export * from './component-library.js';

export {validateFeedback,feedbackLimits} from './feedback.js';
export type {FeedbackAttachment} from './feedback.js';
