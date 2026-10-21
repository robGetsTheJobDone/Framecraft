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

## Browser loading

The npm build is minified and preserves dynamic imports. Monaco loads when Files is opened, Tone loads when synthesizing music, and the composition renderer loads on its first use. Optional encoder chunks load as needed. The compiler WASM is shipped locally and loaded when compiling a composition. Mounting the studio starts a preview, so rendering and compilation are needed at that point.

Keep the generated JavaScript chunks, CSS, worker, and WASM available when bundling or deploying the package. Splitting reduces the initial JavaScript load; it does not remove the compiler from the npm download.

## Current limits

- `Ad.tsx` owns source-mode visuals; the timeline owns audio and pending voiceover. Visual timeline edits are not automatically translated into composition code.
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
