# Framecraft integration guide

React 19 UI plus a browser-local workspace, TSX compiler, isolated Remotion preview, image assets, audio mixing, voiceover scripts, and a plan → design → render loop with configurable visual review.

## Run and install

Run `pnpm dev`, then open http://localhost:5180/?mode=ad for the source studio. The default URL opens the source studio; `?mode=timeline` opens the legacy timeline playground. Only the playground gateway reads the root `.env`; the package has no server dependency.

Run `pnpm pack:studio` to build `framecraft-studio-0.1.1.tgz`. In another project, run `pnpm add /absolute/path/to/framecraft-studio-0.1.1.tgz`. The artifact contains bundled workspace JavaScript, local declarations, CSS, and esbuild WASM, with no workspace-protocol dependencies. React and React DOM are host peers. Mount client-side using a browser bundler such as Vite; SSR is not supported.

```tsx
import {Studio} from '@framecraft/studio';
import '@framecraft/studio/styles.css';

<Studio
  projectId="campaign-123"
  initialBrief="An eight-second product launch"
  formats={[{id: 'story', width: 1080, height: 1920}]}
  adapters={{model: myLangChainModel, imageGeneration: myImages, speech: mySpeech}}
  review={{maxRounds: 6, minScore: 8.5, keepBestVersion: true}}
  onExport={({blob, format, mediaType}) => saveToMyApp(blob, format, mediaType)}
/>
```

The model must support tool calling, structured output, vision, and cancellation. Hosts supply provider transport through adapters; the package does not read environment variables or embed a shared API key. Keep adapter instances stable across renders. `projectId` isolates conversations in IndexedDB; `adapters.storage` replaces persistence. If the bundler does not copy WASM automatically, import `@framecraft/studio/esbuild.wasm?url` (Vite) and pass it as `wasmURL`.

## Session, roles, and skills

```ts
import {createAdSession, adDesignSkills} from '@framecraft/studio';

const session = await createAdSession({
  projectId: 'campaign-123',
  adapters: {model},
  skills: [...adDesignSkills(), {
    id: 'my-brand', version: '1.0.0',
    roles: ['planner', 'designer', 'reviewer'],
    instructions: 'Use our approved logo. Keep headlines editable.',
    files: {'examples/heading.tsx': headingExample},
  }],
  agents: {
    planner: {instructions: planningInstructions},
    designer: {model: designerModel, instructions: designInstructions},
    reviewer: {model: reviewerModel, instructions: reviewInstructions},
  },
});
session.subscribe(event => console.log(event));
const result = await session.send('Create the launch video');
console.log(result.approved, result.review);
const source = await session.workspace.read('Ad.tsx');
await session.undo();
await session.redo();
const movie = await session.export({format: 'story', type: 'webm'});
const bundle = await session.downloadBundle();
```

Mount `AdStudio` with an existing session, or use `StudioView` for the lower-level timeline UI. `skills` replaces defaults. `adDesignSkills()` supplies adapted reference design/review/image instructions; `pierogiBrandSkill()` is optional. Skills and examples live under `/skills/id/version/`. `session.skills.replace(id, newVersion)` requires immutable versions; runs pin their instructions.

`tools(context)` supplies additional LangChain tools with a candidate session and abort signal. Use its workspace for changes. Names cannot override built-ins. `checks` adds deterministic review failures. The reviewer switch starts on for the first prompt and off for follow-ups; switch it on before any send to request review. The designer cannot bypass enabled review. Headless callers can use `session.send(prompt, {review: true})` or `{review: false}`; omitted defaults to the first-message rule. Render validation and deterministic checks run even with review off. Unreviewed results return `approved: false` and no review score. Follow-ups use a targeted edit plan against the current source and production plan; structural redesigns request a full plan. The reviewer sees actual frames at 10%, 35%, 60%, and 85% in each format; this does not prove every frame or audio quality.

Source exports `Ad({format, width, height, assets})`; React and Remotion imports, Tailwind, and inline styles are supported. Generated images persist as workspace assets and are supplied by ID as local data URLs.

## Current boundaries

- In source mode, `Ad.tsx` owns visuals; the timeline owns audio mixing and pending voiceover scripts. Video footage compositing and automatic conversion of visual timeline edits into TSX are not implemented. The legacy timeline playground (`?mode=timeline`) retains its existing video workflow.
- Failed compilation/rendering preserves working source. Review exhaustion returns `approved: false` and retains the best rendered candidate. Hosts should check approval before publishing.
- `listRuns()` exposes checkpoints. `resume(runId)` continues saved execution state, including completed tool results and review progress. Interrupted provider calls may need reconciliation before recovery can continue. `cancel()` stops the active run.
- Undo/redo cover committed agent revisions; direct file and timeline edits are not separate history entries.
- `downloadBundle()` includes source, assets, skills, conversation, and reviews. `importAdBundle(blob, options)` imports into an empty conversation. Supply adapters again; credentials are not serialized.
- Frame-by-frame export can be slow and memory intensive. Codec availability varies by browser. Chromium tests cover MP4 and WebM; encoding still depends on the codecs available in the user’s browser.
- Generated code runs in an opaque iframe with network denied. Encoding and adapters run in the host. There are no server jobs or Chromium service, but generation still uses the host's provider services.

## Verification

Run `pnpm test`, `pnpm lint`, and `pnpm test:embedded`. The embedded smoke test uses deterministic models and real browser compilation, rendered frames, and MP4/WebM export. It checks CSS isolation, sandbox attributes, and reviewer controls without spending provider credits. Real-model design quality is not tested by these fixtures.

The chat panel streams public assistant text and tool progress into Agent activity. Source mode also shows production-plan and rendered-review summaries. Raw reasoning blocks and tool arguments are not displayed. Activity is scoped to the current browser session; final chat and run records persist.

Video export defaults to MP4 (H.264/AAC). Choose WebM if the browser lacks MP4 encoding support. Export shows percentage progress, supports cancellation, starts a download, and retains a download link.

The designer can delegate music requests to a separate composer using `compose_music` and revise an existing soundtrack using `revise_music`. Supply `music: {model, instructions}` to customize that agent (defaults to the shared model). Twenty-four synth presets use Tone.js and require no downloaded sample library; older scores retain their original synthesis engine. Scores, MIDI, and synthesized WAV are saved under `/music`; the WAV is added to the music track and included in preview/export. Revisions keep old assets and replace the soundtrack clip. Download MIDI from Files, or edit score JSON and ask the agent to revise that score. Visual review inspects frames, not musical quality.

Example prompts: “Compose an upbeat eight-second pluck and bass soundtrack, with a final bell accent”; “Make the bass softer and the pluck less bright, keeping the rhythm.”

Files replaces the studio with a full-height collapsible file tree and code editor, opening `Ad.tsx` by default when available. Watch changes is a separate screen: monitoring is opt-in, manual refresh remains available, and stopping watching stops repeated workspace scans. Unsaved edits block navigation until saved or discarded.

Files uses a locally bundled Monaco editor with syntax highlighting, line numbers, search, undo/redo, and Cmd/Ctrl-S. Revision/history files remain read-only; stale-file conflicts still require an explicit reload. Binary files such as MIDI can be downloaded, and audio/image files retain their previews. Monaco and its worker load without a CDN.

Pending `!` voiceover clips open a microphone teleprompter, not AI speech generation. Edit the script, record each line, listen/retake, then add recordings. Lines are stored as WAV assets and consecutive audio clips within the original request slot. Overlong takes must be rerecorded or the slot extended; they are never silently truncated. Microphone access is requested only on Record; closing stops microphone tracks and discards unapplied takes.

Select an audio or video clip in the timeline to edit **Volume (dB)**, **Fade in (seconds)** and **Fade out (seconds)**, then Apply changes. Volume ranges from -60 to +36 dB relative to the source; 0 dB is unity, and mute provides silence. Fades cannot overlap or exceed the clip duration. Preview, audio export and video export share the same mix.

Agents use `set_audio_clip` with `clipId`, nullable `volumeDb`, `fadeInSeconds`, `fadeOutSeconds` and `muted`; null preserves a setting. For example: “Set the music to -12 dB, fade in over 0.5 seconds, and fade out over the final second.” This edits the mix without regenerating the soundtrack.

## Remote checkpoints and recovery

An optional `adapters.checkpoints` adapter stores a portable session snapshot. The snapshot contains conversation, workspace/assets, skills, history and interrupted-run state. Credentials and model instances are supplied by the host each time; they are not serialized.

```ts
import {createAdSession, restoreAdSession, type CheckpointAdapter} from '@framecraft/studio';

const checkpoints: CheckpointAdapter = {
  async read(projectId) {
    // Retrieve from your authorized backend, S3 or R2 integration.
    // Return null when absent, otherwise {snapshot: Blob, version: string}.
    return backend.read(projectId);
  },
  async save(projectId, snapshot, {expectedVersion, signal}) {
    // Atomically reject if the stored version differs from expectedVersion.
    // null means "create only if absent"; return the new opaque version.
    return backend.save(projectId, snapshot, {expectedVersion, signal});
  },
};
const options = {projectId:'ad-123', adapters:{model, checkpoints}};
let session = await createAdSession(options);
await session.save();

// On another visit/device, hydrate local storage from the remote snapshot.
session = await restoreAdSession(options);
await session.resume(); // Continue the interrupted run, when one is available.
```

The adapter must enforce version comparison at the storage boundary, using a transaction or conditional object write. A read-then-unconditional-write sequence is not safe. This package defines the adapter contract; it does not embed cloud credentials or ship provider SDKs. A snapshot is currently a bounded JSON blob containing base64 assets, not incremental asset synchronization.

With a checkpoint adapter configured, run boundaries save automatically. Call save() after manual timeline/file edits when you want to persist those too. session.restore() replaces local state and returns a fresh session instance; always use its return value.

Recovery resumes saved execution state rather than sending the original prompt again. Completed tool results are retained. If an image/music/custom tool was in flight at interruption and its outcome is unknown, automatic replay is blocked: reconcile its outcome before retrying. Restoring does not guarantee provider-side exactly-once execution.

## Product source context from Node or Vite

The optional Node entry point reads local files without pulling Node APIs into the browser bundle:

```ts
// Node/build script: deliver this serializable map to your browser app.
import {loadContextFiles} from '@framecraft/studio/node';
const productFiles = await loadContextFiles({
  root:'./src',
  include:['**/*.{tsx,ts,css}', '**/README.md'],
  exclude:['**/*.test.*'],
});
```

Or let Vite supply raw source directly:

```ts
const productFiles = import.meta.glob('/src/product/**/*.{tsx,ts,css}', {
  query:'?raw', import:'default', eager:true,
}) as Record<string,string>;

const session = await createAdSession({
  projectId:'ad-123',
  adapters:{model},
  context:{files:productFiles, namespace:'product'},
});
```

References appear under `/context/product/` and are read-only in Files and the agent workspace. Source is reference data, not executable imports or trusted agent instructions. Existing contents are pinned; use a new namespace or project when changing context. Saved snapshots include these files, so the resumed agent sees the same reference material.

Defaults exclude environment/credential/key files, dependency directories and build output; the Node loader skips symlinks and rejects binary/non-UTF-8 input. Limits are 1,000 files, 512 KiB per file and 10 MiB total, with lower limits available in the Node loader. Filename exclusions do not detect secrets embedded inside ordinary source files; choose the input directory intentionally.

## Session ZIP files

The studio header offers **Download ZIP** and **Import ZIP**. Import creates a separate conversation; it never overwrites the open project. A ZIP contains `deepbench.json` and raw `workspace/` files, including source, context, assets, conversation, history and run checkpoints. Imported interrupted runs can be continued with **Resume interrupted run**. Automatic replay restrictions for uncertain operations still apply. The compressed archive and total expanded workspace are each limited to 128 MiB.

Programmatic use:
```ts
const zip = await session.downloadZip(); // Blob; trigger a download in your UI
const restored = await importAdZip(zipFile, {
  ...options, projectId: crypto.randomUUID(),
});
await restored.resume(runId); // only if there is an interrupted run
```

For the persistence-adapter interface:
```ts
const files = createZipFileAdapter();
const session = await createAdSession({
  ...options, adapters: {...options.adapters, checkpoints: files},
});
await session.save();
const zip = await files.exportZip(session.projectId);

// Later: use a fresh adapter, import the user-selected ZIP, then restore.
const uploaded = createZipFileAdapter();
const projectId = await uploaded.importZip(zipFile);
const restored = await restoreAdSession({
  ...options, projectId,
  adapters: {...options.adapters, checkpoints: uploaded},
});
```
This adapter stages snapshots in memory; they become portable/durable when downloaded. It does not automatically download at every checkpoint and does not upload anything to a server. Keep the normal IndexedDB workspace for browser-local durability. Supply model/credentials again when restoring. A host using controlled conversation lists can use `Studio.onImported(session)` to add and select the new conversation; `AdStudio` hosts supply `onImportZip(file)` to replace their session instance.

The published npm package is `@framecraft/studio`. The private source workspace retains its internal `@deepbench/studio` name.
