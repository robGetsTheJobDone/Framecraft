# Framecraft

[![npm version](https://img.shields.io/npm/v/@framecraft/studio)](https://www.npmjs.com/package/@framecraft/studio)

**An embeddable AI video studio for React.**

Turn a brief, brand assets, and product context into editable video ads. Framecraft plans scenes, writes React and Remotion compositions, uses generated images as assets, and reviews rendered frames. Users can refine the result through chat, edit the source, compose music, record voiceover, and export a video.

The workspace, compilation, preview, audio mixing, and video export run in the browser. Your app supplies model connectivity and optional image-generation and persistence adapters.

[GitHub](https://github.com/robGetsTheJobDone/Framecraft) · [Integration guide](https://github.com/robGetsTheJobDone/Framecraft/blob/main/docs/integration.md) · [Publishing guide](https://github.com/robGetsTheJobDone/Framecraft/blob/main/PUBLISHING.md)

## What’s included

- **Editable compositions:** React, Remotion, Tailwind, image assets, multiple aspect ratios, and live preview.
- **Design and review:** configurable planner, designer, and reviewer roles, versioned skills, rendered-frame feedback, and recoverable revisions.
- **Music and voiceover:** a composer agent with 24 sample-free synth presets, editable scores and MIDI, plus a line-by-line recording teleprompter.
- **Timeline mixing:** volume in dB, mute, fades, and the same audio mix in preview and export.
- **An inspectable workspace:** Monaco file editor, asset previews, activity updates, and optional file watching.
- **Portable sessions:** IndexedDB storage, session ZIP download/import, checkpoint adapters, and interrupted-run recovery.
- **Local video export:** MP4 or WebM with progress and cancellation, subject to browser codec support.
- **Terminal workflow:** the `framecraft` CLI creates, edits, inspects, resumes, and exports disk-backed projects through headless Chromium.

## Command line

```sh
npm install -g @framecraft/studio
framecraft setup
framecraft create ./my-ad --brief "An eight-second animated product launch"
framecraft edit ./my-ad "Make the headline larger"
framecraft export ./my-ad --out ./my-ad.mp4
```

Requires Node 22.22+ and Chromium. Set `OPENAI_API_KEY` in your environment for AI commands. Create without `--brief`, inspect, direct edits, ZIP import/export, and video export work without a model key. Credentials stay in Node; projects and recoverable checkpoints live in `./my-ad/.framecraft`. Use `--json` for scripts and coding agents.

See the [CLI guide](https://github.com/robGetsTheJobDone/Framecraft/blob/v0.5.0/docs/cli.md) for deterministic scene edits, model configuration, project portability, and cancellation.

## Install

```sh
npm install @framecraft/studio
```

Use a client-side application with matching React and React DOM versions: **18.3.1 or React 19**. Keep the React version already installed in your app. Use a browser bundler such as Vite. Server-side rendering is not supported. Microphone recording and browser video encoding require HTTPS or localhost and browser support.

### Vite configuration

Keep Framecraft out of dependency prebundling so its local worker and dynamically loaded assets retain their paths:

```ts
// vite.config.ts — merge into your existing configuration.
import {defineConfig} from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@framecraft/studio'],
    include: ['react', 'react-dom', 'react-dom/client',
      'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
});
```

Pass the explicit WASM URL shown below. For other bundlers, configure equivalent worker and asset handling.

## Mount the studio

This Vite example takes a model adapter from your application. The required `model` is a LangChain chat model supporting tool calls, structured output, vision, and cancellation. The package does not include credentials or a hosted AI endpoint.

```tsx
import {Studio, type StudioAdapters} from '@framecraft/studio';
import '@framecraft/studio/styles.css';
import wasmURL from '@framecraft/studio/esbuild.wasm?url';

type VideoEditorProps = {
  projectId: string;
  adapters: StudioAdapters;
};

export function VideoEditor({projectId, adapters}: VideoEditorProps) {
  return (
    <Studio
      projectId={projectId}
      adapters={adapters}
      wasmURL={wasmURL}
      initialBrief="Create a playful eight-second ad for a hair dye brand."
      durationSeconds={8}
      formats={[{id: 'story', width: 1080, height: 1920}]}
      review={{maxRounds: 6, minScore: 8.5, keepBestVersion: true}}
      onExport={({blob, format, mediaType}) => {
        // Optional: upload the exported Blob to your application.
        console.log({bytes: blob.size, format, mediaType});
      }}
    />
  );
}
```

Keep adapter instances stable across renders. Each `projectId` has its own conversation and workspace. `initialBrief` seeds the project; users send their request through the chat to start generation.

Use the `onReady(session)` callback to access the session. `onEvent(event)` receives assistant text, tool activity, review updates, and export progress. Raw reasoning is not exposed.

## Bring your integrations

| Adapter | Purpose |
| --- | --- |
| `model` | Required LangChain chat model for the agent workflow. |
| `imageGeneration` | Generate image assets for use inside compositions. |
| `storage` | Replace the default browser filesystem. |
| `checkpoints` | Save and restore complete session snapshots through your backend. |
| `speech` | Optional speech generation for the separate dubbing workflow. Manual recording does not require it. |
| `render` | Replace the renderer while providing real frames for review. |

Your app owns provider authentication. Shared provider credentials belong on your backend. Framecraft’s browser runtime does not require a rendering server; model and image requests still use the services supplied by your adapters.

## Use the session without the UI

```ts
import {createAdSession, type StudioAdapters} from '@framecraft/studio';
import wasmURL from '@framecraft/studio/esbuild.wasm?url';

export async function createAd(adapters: StudioAdapters) {
  const session = await createAdSession({
    projectId: crypto.randomUUID(),
    adapters,
    wasmURL,
    durationSeconds: 8,
    formats: [{id: 'story', width: 1080, height: 1920}],
  });

  const result = await session.send('Create a colorful hair dye ad.', {
    review: true,
  });
  console.log(result.approved, result.review);

  // Follow-ups edit the existing composition.
  await session.send('Make the final headline red.', {review: false});

  const source = await session.workspace.read('/Ad.tsx');
  const video = await session.export({format: 'story', type: 'mp4'});
  const archive = await session.downloadZip();
  return {session, source, video, archive};
}
```

Mount `<AdStudio session={session} />` to add the UI to an existing session. `session.undo()` and `session.redo()` navigate committed agent revisions; `session.cancel()` stops the active run.

## Skills and review

Default skills cover React composition, Remotion animation, image direction, and visual review. Add brand-specific instructions while keeping those defaults:

```ts
import {adDesignSkills, type StudioSkill} from '@framecraft/studio';

const brandSkill: StudioSkill = {
  id: 'brand',
  version: '1.0.0',
  roles: ['planner', 'designer', 'reviewer'],
  instructions: 'Keep headlines editable. Preserve logo proportions.',
};

const skills = [...adDesignSkills(), brandSkill];
// Pass `skills` to Studio or createAdSession().
```

Supplying `skills` replaces the defaults, so include `adDesignSkills()` when extending them. Each role can also have its own model, instructions, and skills through `agents`.

Review defaults to **on for the first message, off for follow-ups**, with a UI toggle and a per-send override. When enabled, the harness requires review; the designer cannot skip it. Compilation, rendering, and deterministic checks still run with review off. Visual review samples frames; it does not verify every frame or assess musical quality.

## Music, recording, and mixing

Ask the agent to compose a soundtrack or revise its instruments while preserving the notes. Scores, MIDI, and synthesized WAV files remain in the workspace. Music clips play with the composition and are mixed into exports.

Voiceover requests appear as pending **!** clips. Click one to edit the script, record each line, listen, and retake before adding recordings to the timeline. This workflow records the user’s voice.

Select an audio clip to adjust volume and fades, or ask: “Set the music to -12 dB, fade in over half a second, and fade out over the final second.” Mix changes do not require regenerating the soundtrack.

## Save, restore, and resume

**Download ZIP** packages the files, assets, conversation, skills, revisions, and run checkpoints. **Import ZIP** creates a separate conversation. Supply model adapters again after restore; credentials are not serialized.

For backend persistence, implement `CheckpointAdapter.read()` and `.save()` and pass it as `adapters.checkpoints`. Your backend can store snapshots in S3, R2, or another store. Saves must enforce the expected version atomically; provider-specific cloud adapters are not bundled.

Interrupted runs can resume from saved execution state with `session.resume(runId)`. Completed tool results are retained. If an external operation was interrupted with an unknown outcome, recovery stops for reconciliation rather than blindly repeating it.

See the [integration guide](https://github.com/robGetsTheJobDone/Framecraft/blob/main/docs/integration.md) for adapter contracts, ZIP APIs, and recovery behavior.

## Supply product source as context

Pass selected files as read-only context so the agent can understand your product:

```ts
import productSource from './Product.tsx?raw';

const context = {
  files: {'Product.tsx': productSource},
  namespace: 'product',
};
// Pass `context` to Studio or createAdSession().
```

The optional `@framecraft/studio/node` entry point exports `loadContextFiles()` for loading selected files in Node. Files are reference material, not executable plugin imports. Context travels with saved sessions; include only files intended for the agent and archive.

MP4 export uses native AAC when available and lazy-loads Mediabunny’s WASM AAC encoder otherwise. H.264 video encoding still requires browser support; WebM is also available.

## Browser loading

The npm build is minified and preserves dynamic imports. Monaco loads when Files is opened, Tone loads when synthesizing music, and the composition renderer loads on its first use. Optional encoder chunks load as needed. The compiler WASM is shipped locally and loaded when compiling a composition. Mounting the studio starts a preview, so rendering and compilation are needed at that point.

Keep the generated JavaScript chunks, CSS, worker, and WASM available when bundling or deploying the package. Splitting reduces the initial JavaScript load; it does not remove the compiler from the npm download.

## Current limits

- Legacy compositions use `Ad.tsx`. Structured projects use scene modules with timeline-owned arrangement and exposed settings; audio remains on its own timeline. Automatic decomposition of arbitrary legacy source is not supported.
- Undo/redo tracks committed agent revisions, not every manual file or timeline edit.
- Export speed and memory use depend on composition complexity, dimensions, and browser codecs. MP4 is the default; WebM is also available.
- Browser storage is origin-local and subject to quotas. Export a ZIP or configure checkpoints for portable persistence.
- Generated compositions run in an isolated iframe with network denied. Host adapters handle external services.

## Develop locally

From the repository root:

```sh
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5180**. The development playground uses a local gateway configured through `.env`; see its [setup instructions](https://github.com/robGetsTheJobDone/Framecraft/blob/main/packages/studio-playground/README.md).

Run `pnpm pack:studio` to build a standalone npm tarball. The public npm name is `@framecraft/studio`; internal workspace names retain the `@deepbench` scope. The [publishing guide](https://github.com/robGetsTheJobDone/Framecraft/blob/main/PUBLISHING.md) describes releases and trusted publishing.

## Scene components and brand library

Build structured scenes from reusable TSX components, edit their timing/settings without rewriting code, and save pinned component versions through a library adapter. See [the scene and library guide](https://github.com/robGetsTheJobDone/Framecraft/blob/feat/scene-components-brand-library/docs/scenes-and-library.md) for contracts, migration, agent tools, and storage integration.

### Agent-installed browser packages

The designer can discover, test and choose packages with these tools:

- `search_packages`: search npm by name or purpose.
- `list_package_versions`: discover published versions and tags, with pagination.
- `inspect_package`: inspect browser/module exports, types and candidate sources.
- `list_package_files`: discover published files and sizes, filtered and paginated.
- `read_package_file`: read documentation, declaration files or source in bounded chunks.
- `probe_package`: test an exact version and chosen source/entry without changing project files.
- `install_package`: install the agent's selected version, source and entry file.
- `list_packages`: report builtins, policy and installed packages.

Installation downloads ESM from esm.sh or published JavaScript from jsDelivr,
pins the complete resolved module graph,
checks compatibility, and imports it inside the render sandbox before committing.
No package lifecycle scripts run. The host page never imports downloaded code.

```ts
const info = await session.packages.inspect('d3-interpolate');
const choice = {source:'esm.sh-standard' as const};
const probe = await session.packages.probe(info.name, info.version, choice);
if (!probe.ok) throw new Error(probe.message);
await session.packages.install(info.name, info.version, undefined, choice);
console.log(await session.packages.list());
// Scene source can now use: import {interpolateRgb} from 'd3-interpolate';
```

`list_packages` reports built-in runtime versions and direct installed packages.
`inspect_package({name, version: null})` resolves the current version; installation
requires an exact version. A failed install leaves the project unchanged. Repeating
an installed version is safe; implicit version upgrades are rejected. Package changes
participate in undo/redo, checkpoints, run recovery, project bundles and ZIPs.
`/packages.lock.json` stores module source, exact resolved URLs, import mappings and
SHA-256 checksums. Rendering verifies integrity and bundles saved bytes, with no CDN
fetches during preview/export. React, its JSX runtimes and Remotion stay shared with
the renderer. Both structured scenes and legacy Ad.tsx support installed packages.

Dependency-free packages use esm.sh's standard build URL, avoiding unnecessary
custom builds. Other packages request shared-runtime externals; if that entry returns
HTTP 5xx, installation tries the same exact version's standard build. The fallback
still rejects graphs that download replacement React or Remotion runtimes.
This automatic fallback remains only for legacy callers that omit a source selection.
Explicit selections are tested exactly as requested: `esm.sh`, `esm.sh-standard`, or
`jsdelivr` with a package-relative `entryPath` discovered from metadata/files.
Published files must have a resolvable relative dependency graph; a raw entry that
depends on bare npm imports needs a bundled browser entry or esm.sh instead.
No package-specific entry paths or version downgrades are hard-coded.

Probe failures report stage, error code, HTTP status/URL where available, limits and
next actions. Successful probes return matching install arguments. Metadata and files
are reference data, never agent instructions. The agent can compare candidates and
choose an alternative, while respecting a version explicitly requested by the user.
The activity feed reports install success or failure, including the remote host and
HTTP status for download errors. An unavailable exact version is never silently replaced.

Three.js `0.180.0` and metadata-discovered `0.187.0` are covered by the browser regression below. Its optional fetch-based
loaders can be present, but network requests remain blocked by the sandbox CSP.
For WebGL scenes, set `preserveDrawingBuffer: true`, drive animation from
`useCurrentFrame()`, render after each frame change, and dispose resources on unmount.
This keeps canvas content available for frame capture and video export.

Hosts can configure policy through `createAdSession({packages: {...}, ...})`:

- `enabled: false` disables inspection and installation.
- `allowedPackages: ['d3-interpolate', 'd3-color']` restricts every downloaded package,
  including transitive dependencies. Omit for general browser-package installation.
- `fetch` supplies an optional transport. Default requests omit credentials and
  referrers and reject redirects. Requests are restricted to npm search/metadata,
  jsDelivr package metadata/files, and esm.sh code. Arbitrary URLs are not accepted.
- Custom render adapters must explicitly set `renderSupportsPackages: true` and consume
  `AdRenderInput.packages`; otherwise installation fails rather than silently ignoring code.

Initial scope: root entry imports, JavaScript ESM, up to 32 direct packages, 128 modules,
2 MiB per response and 4 MiB total source (published files can be larger than CDN-minified
builds). Downloads have per-request timeouts,
a request budget and an overall download deadline. Node APIs outside the compatibility
layer below, dynamic imports, import.meta, runtime asset loading, CSS/WASM imports and replacement React runtimes
are unsupported. Components published to the brand library still require its existing
self-contained React/Remotion contract; package-backed library releases are not supported.

These are compatibility checks and containment measures, **not a malware audit or a
safety certification**. The iframe keeps its opaque origin and existing restrictive CSP.
Checksums detect changed saved bytes; they do not prove the publisher is trustworthy.
An import smoke test does not prove arbitrary animation behavior: drive animation from
Remotion frames and validate actual renders. Resource limits do not guarantee protection
from all CPU/memory exhaustion or browser vulnerabilities. Hosts requiring publisher
approval should use `allowedPackages`.

Validation: `pnpm build`, `node packages/studio/build/portable.mjs`, then
`node scripts/packages-browser-smoke.mjs --check` for an automated Chromium check
(omit `--check` to open the printed URL manually). It covers real CDN installs,
a visible rotating Three.js cross, deterministic frame seeking, ZIP restore with the
package transport disabled, WebM export, blocked network loaders, and a fixture
package using the shared React JSX runtime/hooks.
This smoke check makes no model calls.

### Browser Node compatibility

Scenes and installed packages can use these builtins without installing them:

| Imports (bare or `node:`) | Support |
| --- | --- |
| `buffer` | Browser Buffer implementation; `Buffer` is also a global |
| `events` | Browser EventEmitter implementation |
| `path`, `path/posix` | POSIX paths rooted at `/` |
| `util` | Browser utilities, including `format`, `inherits`, `promisify`, `callbackify` |
| `assert`, `assert/strict` | Browser assertion implementation |
| `process` | `env.NODE_ENV = 'production'`, `cwd() = '/'`, `nextTick`, browser metadata |
| `fs`, `fs/promises` | Read-only in-memory project snapshot |

The SDK pins Buffer 6.0.3, events 3.3.0, path-browserify 1.0.1, util 0.12.5 and
assert 2.1.0. Compatibility code executes only inside render sandboxes that need it.
esm.sh `/node/*.mjs` imports resolve locally instead of downloading polyfills.
Static `require('node:fs')` and other supported builtin requires also work in packages;
dynamic require and arbitrary CommonJS package requires remain unsupported.

`fs` implements `readFile`, `readdir`, `stat`, `lstat`, `access`, and `realpath` in
sync, callback and promise forms, plus `existsSync` and callback `exists`.
Reads return a copied Buffer unless an encoding is supplied. Directory listings support
`withFileTypes`; stats have file/directory predicates, byte sizes and fixed epoch dates.
Directories are inferred from file paths. Recursive listings and bigint stats are unsupported.

Snapshots include `/project.json`, scene sources, `/assets`, `/music`, and `/data`.
They exclude conversation history, runs, product context, credentials from the host
environment, and the host filesystem. Put auxiliary JSON, text or binary files in `/data`:

```ts
await session.filesystem.writeFile('/data/theme.json', '{"color":"#00ff00"}', {createParents:true});
// Inside a scene or installed package:
// import fs from 'node:fs';
// const theme = JSON.parse(fs.readFileSync('/data/theme.json', 'utf8'));
```

`/data` participates in project revisions, undo/redo, bundles and ZIP restore.
Each render receives a fixed snapshot, so edits affect subsequent renders without
changing frames midway through an export. Snapshots are limited to 2,048 files and
64 MiB of decoded bytes; no snapshot is created unless source/package code references `fs`.
Low-level render callers may provide base64 `{path, data}` entries in `AdRenderInput.filesystem`.

Writes fail with `EROFS`; watchers, streams, file descriptors, subprocesses, sockets,
native modules and Windows path semantics are unsupported. `process` never exposes
host environment variables. This is a defined browser subset of Node, not a Node runtime.

## Reverse engineer a reference video

Open **Library → Reverse engineer video**, drop an MP4, then choose **Analyze video**.
Before analyzing, use **Trim reference** to set the start and end with the sliders
or precise second fields. Scrub the video and use **Set start/end at playhead** for
visual positioning. **Preview selection** plays just that range and stops at its
end; **Reset trim** restores the full recording. Only frames and audio inside the
selection enter the analysis. Report timestamps begin at zero for the selected
clip, while saved reports and exports retain its original source range.
The workflow captures a JPEG at every whole second, transcribes the audio in its
original languages, analyzes groups of eight frames with a two-frame overlap, and
synthesizes one chronological breakdown. Reports describe scenes, recurring elements,
layout, themes, palette, typography, on-screen text, motion, transitions, evidence,
uncertainties, and reconstruction notes.

The built-in limits are 100 MB and five minutes. Frame images are scaled to a maximum
side of 768 pixels; local decoding requires browser support for the source codecs.
Audio is downmixed to 16 kHz mono WAV and divided near quiet boundaries into chunks
of at most 20 seconds. Transcript time ranges refer to those chunks, not individual
words. Language recognition depends on the transcription provider; unsupported or
unclear speech cannot be guaranteed. One-second screenshots cannot establish exact
subsecond transitions or easing, so the report labels those inferences.

Enable the panel's analysis action with an adapter:

```tsx
<Studio
  projectId="my-film"
  adapters={{
    model, // Vision-capable chat model with structured output
    reverseEngineering: {
      // Optional model override for visual analysis:
      model: visionModel,
      transcription: {
        async transcribe({audio, previousText, signal}) {
          // Send this WAV chunk to your server. Return original-language text.
          return myTranscriptionGateway({audio, previousText, signal});
          // Shape: {text: string, languages: string[]} (ISO language codes)
        },
      },
    },
  }}
/>
```

The playground configures these adapters automatically when its local OpenAI gateway
is connected. Its server uses `OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe` and the
existing server-only `OPENAI_API_KEY`. Audio goes to `/api/transcribe`; only sampled
images go to the visual model. The source MP4 stays local. A missing transcription
adapter, absent audio track, or audio decoding failure is explicitly shown as visual-only
analysis. A transcription request failure stops the analysis rather than silently
omitting speech.

Reports and their sampled frames save under `/references/<id>/analysis.json`, so they
travel with session ZIPs and checkpoints. The original MP4 is not retained. You can
reopen saved reports, download Markdown or JSON, or select **Use as creative brief**
to place a recreation-planning request into chat for review before sending.

The headless API is also exported:

```ts
import {reverseEngineerVideo, saveVideoBreakdown} from '@framecraft/studio';
const result = await reverseEngineerVideo(file, {
  model: visionModel,
  transcription: transcriptionProvider,
  trim: {startSeconds: 3.25, endSeconds: 25.5}, // Optional source-video range
  signal: controller.signal,
  onProgress: event => console.log(event.message),
});
await saveVideoBreakdown(session.filesystem, result);
```

`inspectVideoReference(file, {signal})` reads the source video's dimensions and
duration for a custom trim UI. Existing reports without source-range metadata
continue to open as untrimmed references.

Transcription integration follows the [official file transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text).
