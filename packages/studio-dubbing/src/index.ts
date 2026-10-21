import { assertValidProject, type StudioProject, type StudioAsset, type DubbingSegment } from '@deepbench/studio-project';

/** Providers may call a server, an on-device model, or LangChain; credentials stay outside this package. */
export interface ScriptProvider {
  draft(request: { prompt: string; language: string; source: DubSource; signal: AbortSignal }): Promise<DubbingSegment[]>;
}
export interface SpeechProvider {
  synthesize(request: { text: string; language: string; voice?: string; targetDurationSeconds: number; signal: AbortSignal }): Promise<{ blob: Blob; durationSeconds: number }>;
}
export interface DubSource {
  asset: StudioAsset;
  clipId: string;
  trackId: string;
  startSeconds: number;
  durationSeconds: number;
  sourceStartSeconds: number;
}
export type DubStage = 'empty' | 'source' | 'drafting' | 'editing' | 'approved' | 'synthesizing' | 'ready' | 'applying' | 'applied';
export interface DubState {
  stage: DubStage;
  revision: number;
  language: string;
  source?: DubSource;
  segments: DubbingSegment[];
  error?: string;
}
export interface DubProjectStore {
  load(): Promise<StudioProject>;
  save(project: StudioProject): Promise<unknown>;
  update(mutator: (project: StudioProject) => StudioProject | void | Promise<StudioProject | void>): Promise<StudioProject>;
  writeAsset(asset: Omit<StudioAsset, 'path'>, data: Blob | Uint8Array): Promise<StudioAsset>;
}
export interface DubbingWizardOptions {
  scriptProvider: ScriptProvider;
  speechProvider: SpeechProvider;
  language?: string;
  /** Optional deterministic ID source for tests. Must return unique IDs. */
  createId?: () => string;
}
export interface GeneratedSpeech { segmentId: string; blob: Blob; durationSeconds: number; clipDurationSeconds: number }
interface SpeechResult { segmentId: string; blob: Blob; durationSeconds: number; clipDurationSeconds: number }
const clone = <T>(value: T): T => structuredClone(value);
const abortError = () => new DOMException('Dubbing operation cancelled or superseded', 'AbortError');

/** Stateful, headless wizard. Timings are absolute project seconds, with no implicit time stretching. */
export class DubbingWizard {
  private current: DubState;
  private pending?: AbortController;
  private generated: SpeechResult[] = [];
  private sourceFingerprint?: string;
  private readonly id: () => string;
  constructor(private readonly options: DubbingWizardOptions) {
    this.current = { stage: 'empty', revision: 0, language: options.language ?? 'en', segments: [] };
    this.id = options.createId ?? (() => crypto.randomUUID());
  }
  /** Defensive copy; mutate through the wizard so approval is invalidated correctly. */
  get state(): DubState { return clone(this.current); }
  /** Blobs are immutable; array and metadata are copied so previews cannot alter wizard state. */
  getGeneratedAudio(): GeneratedSpeech[] { return this.generated.map(result => ({ ...result })); }
  private require(...stages: DubStage[]): void {
    if (!stages.includes(this.current.stage)) throw new Error(`Cannot operate in ${this.current.stage}; expected ${stages.join(', ')}`);
  }
  private invalidate(): void {
    this.pending?.abort(); this.pending = undefined;
    this.current.revision++; this.current.error = undefined; this.generated = [];
  }
  selectSource(project: StudioProject, clipId: string): void {
    if (this.current.stage === 'applying') throw new Error('Cannot change source while applying');
    assertValidProject(project);
    const track = project.tracks.find(item => item.clips.some(clip => clip.id === clipId && clip.kind === 'video'));
    const clip = track?.clips.find(item => item.id === clipId);
    if (!track || !clip || clip.kind !== 'video') throw new Error('Select a video clip from the project');
    const asset = project.assets.find(item => item.id === clip.assetId)!;
    this.invalidate();
    this.current.source = clone({ asset, clipId, trackId: track.id, startSeconds: clip.startSeconds, durationSeconds: clip.durationSeconds, sourceStartSeconds: clip.sourceStartSeconds });
    this.sourceFingerprint = JSON.stringify({ clip, asset });
    this.current.segments = []; this.current.stage = 'source';
  }
  private validateSegments(segments: DubbingSegment[]): void {
    const source = this.current.source!;
    if (!Array.isArray(segments) || !segments.length) throw new Error('Provide at least one script segment');
    const ids = new Set<string>(); let previousEnd = source.startSeconds;
    for (const segment of segments) {
      if (!segment || typeof segment.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(segment.id) || ids.has(segment.id)) throw new Error('Script segment IDs must be unique');
      ids.add(segment.id);
      if (typeof segment.text !== 'string' || !segment.text.trim()) throw new Error('Script text must not be empty');
      if (!Number.isFinite(segment.startSeconds) || !Number.isFinite(segment.durationSeconds) || segment.durationSeconds <= 0 || segment.startSeconds < previousEnd - 1e-8 || segment.startSeconds + segment.durationSeconds > source.startSeconds + source.durationSeconds + 1e-8) {
        throw new Error('Segments must be ordered, non-overlapping, and contained in the source clip timeline');
      }
      previousEnd = segment.startSeconds + segment.durationSeconds;
    }
  }
  private begin(stage: DubStage, external?: AbortSignal): { signal: AbortSignal; check(): void; cleanup(): void } {
    const controller = new AbortController(); this.pending = controller;
    const revision = this.current.revision;
    const abort = () => controller.abort();
    external?.addEventListener('abort', abort, { once: true });
    if (external?.aborted) controller.abort();
    this.current.stage = stage; this.current.error = undefined;
    return {
      signal: controller.signal,
      check: () => { if (controller.signal.aborted || this.current.revision !== revision) throw abortError(); },
      cleanup: () => { external?.removeEventListener('abort', abort); if (this.pending === controller) this.pending = undefined; },
    };
  }
  async draft(prompt: string, options: { language?: string; signal?: AbortSignal } = {}): Promise<DubState> {
    this.require('source', 'editing', 'approved', 'ready');
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('A script prompt is required');
    const language = options.language ?? this.current.language;
    if (typeof language !== 'string' || !language.trim()) throw new Error('A language is required');
    this.invalidate();
    this.current.language = language;
    const revision = this.current.revision;
    const operation = this.begin('drafting', options.signal);
    try {
      operation.check();
      const segments = await this.options.scriptProvider.draft({ prompt, language: this.current.language, source: clone(this.current.source!), signal: operation.signal });
      operation.check(); this.validateSegments(segments);
      this.current.segments = segments.map(({ audioAssetId: _, ...segment }) => clone(segment));
      this.current.stage = 'editing'; return this.state;
    } catch (error) {
      if (this.current.revision === revision) { this.current.stage = this.current.segments.length ? 'editing' : 'source'; this.current.error = String(error); }
      throw error;
    } finally { operation.cleanup(); }
  }
  editSegments(segments: DubbingSegment[]): void {
    this.require('source', 'drafting', 'editing', 'approved', 'synthesizing', 'ready');
    this.validateSegments(segments); this.invalidate();
    this.current.segments = segments.map(({ audioAssetId: _, ...segment }) => clone(segment));
    this.current.stage = 'editing';
  }
  approve(): void { this.require('editing'); this.validateSegments(this.current.segments); this.current.stage = 'approved'; }
  /** Cancel immediately invalidates in-flight provider results, even if a provider ignores its signal. */
  cancel(): void {
    this.require('drafting', 'synthesizing');
    const stage = this.current.stage; this.invalidate();
    this.current.stage = stage === 'synthesizing' ? 'approved' : this.current.segments.length ? 'editing' : 'source';
  }
  async synthesize(options: { voice?: string; overflow?: 'reject' | 'trim'; signal?: AbortSignal } = {}): Promise<DubState> {
    this.require('approved');
    const revision = this.current.revision;
    const operation = this.begin('synthesizing', options.signal);
    const results: SpeechResult[] = [];
    try {
      for (const segment of this.current.segments) {
        operation.check();
        const result = await this.options.speechProvider.synthesize({ text: segment.text, language: this.current.language, voice: options.voice, targetDurationSeconds: segment.durationSeconds, signal: operation.signal });
        operation.check();
        if (!(result.blob instanceof Blob) || !result.blob.size || !result.blob.type.startsWith('audio/') || !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0) throw new Error('Speech provider must return nonempty audio Blob and positive duration');
        if (result.durationSeconds > segment.durationSeconds && options.overflow !== 'trim') throw new Error(`Speech exceeds segment ${segment.id}; shorten the script, resynthesize, or explicitly select trim`);
        results.push({ segmentId: segment.id, blob: result.blob, durationSeconds: result.durationSeconds, clipDurationSeconds: Math.min(result.durationSeconds, segment.durationSeconds) });
      }
      this.generated = results; this.current.stage = 'ready'; return this.state;
    } catch (error) {
      if (this.current.revision === revision) { this.generated = []; this.current.stage = 'approved'; this.current.error = String(error); }
      throw error;
    } finally { operation.cleanup(); }
  }
  /** Save assets then one project revision. Failed saves can leave unreferenced assets; retry is safe. */
  async apply(store: DubProjectStore, options: { sourceAudio: 'preserve' | 'mute'; title?: string }): Promise<StudioProject> {
    this.require('ready');
    if (options.sourceAudio !== 'preserve' && options.sourceAudio !== 'mute') throw new Error('Select preserve or mute source audio');
    this.current.stage = 'applying'; this.current.error = undefined;
    try {
      let appliedSegments: DubbingSegment[] = [];
      const saved = await store.update(async project => {
      const source = this.current.source!;
      const sourceClip = project.tracks.find(track => track.id === source.trackId)?.clips.find(clip => clip.id === source.clipId);
      const sourceAsset = project.assets.find(asset => asset.id === source.asset.id);
      if (JSON.stringify({ clip: sourceClip, asset: sourceAsset }) !== this.sourceFingerprint) throw new Error('Source video changed; select it again and review the script');
      const clips = [];
      const segments: DubbingSegment[] = [];
      for (const result of this.generated) {
        const segment = this.current.segments.find(item => item.id === result.segmentId)!;
        const asset = await store.writeAsset({ id: this.id(), kind: 'audio', mimeType: result.blob.type, durationSeconds: result.durationSeconds }, result.blob);
        project.assets.push(asset);
        clips.push({ id: this.id(), kind: 'audio' as const, assetId: asset.id, startSeconds: segment.startSeconds, durationSeconds: result.clipDurationSeconds, sourceStartSeconds: 0, gain: 1 });
        segments.push({ ...segment, audioAssetId: asset.id });
      }
      project.tracks.push({ id: this.id(), kind: 'audio', name: options.title ?? 'Voiceover', clips });
      project.dubbingScripts.push({ id: this.id(), title: options.title ?? 'Voiceover', language: this.current.language, segments });
      if (options.sourceAudio === 'mute' && sourceClip?.kind === 'video') sourceClip.muted = true;
      assertValidProject(project);
      appliedSegments = segments;
      return project;
      });
      this.current.segments = appliedSegments; this.current.stage = 'applied'; return clone(saved);
    } catch (error) { this.current.stage = 'ready'; this.current.error = String(error); throw error; }
  }
}
