# Scene components and brand libraries

Framecraft supports both legacy single-file compositions and structured scene projects. Scene projects store arrangement in `project.json`, visual implementation in local TSX modules, and reusable component versions in a host-provided library. Components can import local helpers and shared components; filenames are arbitrary.

## Ownership and timing

A scene is an independently editable animation sequence, not necessarily one shot or visual beat. Keep connected motion, morphs, and coordinated transitions together in one scene when they need a shared clock. That scene can contain several reusable components and nested sequences. Split scenes when separate arrangement or reuse is useful; neither multiple files nor one scene per beat is mandatory.

- Scene instances have stable IDs, component references, frame-based start/duration/content-offset, layer order, and exposed props.
- Components have stable IDs, an entry module, authored duration in frames, input definitions/defaults, and optional asset aliases.
- A higher layer appears above a lower layer. Changing the layer does not change start time. Gaps and overlaps are allowed; no automatic ripple editing occurs.
- Moving a scene preserves its local clock. Trimming changes the visible window, not animation speed or authored duration. Extending past authored content or project bounds fails validation.
- Audio remains on its absolute project timeline when scenes move. Scene-linked audio, generic retiming, and cross-scene transitions are not provided by these controls.
- Each frame is rendered from the same resolved scene graph in preview, review captures, and export. Source animations should be frame-driven, not based on wall-clock time or side effects.

Structured projects use project schema version 2; legacy projects retain version 1. Checkpoint and ZIP envelope versions remain unchanged. Older clients must reject a schema-2 project instead of falling back to an unrelated legacy `Ad.tsx`.

## Create and edit scenes

Fresh `createAdSession` projects start in scene mode with an empty composition. Existing saved projects keep their current mode. Integrations that deliberately need a new legacy source project can set `initialMode: 'source'`; this option never converts an existing project.

```ts
import {createAdSession} from '@framecraft/studio';

const session = await createAdSession({
  projectId: 'campaign',
  adapters: {model, storage},
  durationSeconds: 8,
  fps: 30,
});
const state = await session.sceneState();
await session.editScenes({
  baseRevision: state.revision,
  operations: [
    {
      type: 'addComponent',
      component: {
        id: 'headline', entry: '/scenes/Headline.tsx',
        authoredDurationInFrames: 120,
        inputs: {text: {type: 'text', label: 'Headline', required: true}},
        defaults: {text: 'Meet our product'},
      },
      source: `import React from 'react';
        import {AbsoluteFill} from 'remotion';
        export default function Headline({text}) {
          return <AbsoluteFill style={{background:'#17382a',color:'white',fontSize:64}}>{text}</AbsoluteFill>;
        }`,
    },
    {
      type: 'addScene',
      scene: {id:'opening', name:'Opening', componentId:'headline',
        startFrame:0, durationInFrames:120, sourceStartFrame:0,
        layer:0, props:{text:'A new beginning'}},
    },
  ],
});

const latest = await session.sceneState();
await session.editScenes({
  baseRevision: latest.revision,
  operations: [{type:'updateScene', id:'opening', patch:{startFrame:30}}],
});
```

`editScenes` stages the full edit, validates the project/module graph, renders it, then commits a coherent revision. A stale `baseRevision` fails without overwriting newer work. Add, update, remove, duplicate (new ID), and fork operations can be grouped. `forkScene` copies the transitive component graph so an individual redesign can be independent of its original.

To preserve an existing composition, call `session.convertToScenes()` or use **Enable scene editing**. This wraps its existing source as one scene. It does not infer internal scene boundaries. Existing legacy projects continue to render without conversion.

Exposed controls support text, finite numbers, booleans, hex colors, enums, and image asset IDs. Components receive these as props alongside `assets`, `format`, `width`, `height`, `sceneId`, and authored `durationInFrames`. Shared module imports must remain local; React and Remotion are the allowed runtime imports. Source modules cannot fetch remote dependencies. Code still executes in the sandbox.

## Agent operations

The agent can inspect the current scene graph and make scoped operations. Timing/prop changes update data; redesign changes a component module; scene creation registers a module and an instance together. The production plan describes intent; the current project remains authoritative after manual edits.

Shared edits have three scopes: one instance, all uses of a local component in this project, or a new library release. Project changes never implicitly publish or upgrade other projects. Audio-only changes preserve visual source and arrangement.

The scene panel exposes timing, trim, layer, input settings, duplicate, remove, and independent-component actions. Files-mode saves validate supported source/project edits and participate in history. Changes to component modules refresh preview. Low-level filesystem writes remain an advanced integration surface; prefer session APIs for validated revisions and conflict detection.

## Configure a library

```ts
import {createFileSystemComponentLibrary, createAdSession} from '@framecraft/studio';

// libraryStorage is a separate BrowserFileSystem (e.g. IndexedDB for local use).
const componentLibrary = createFileSystemComponentLibrary(libraryStorage, {
  workspaceId: 'brand-acme',
  canPublish: true,
});
const session = await createAdSession({
  projectId: 'campaign',
  adapters: {model, storage, componentLibrary},
  libraryWorkspaceId: 'brand-acme',
});
```

The playground uses a separate IndexedDB library named `framecraft-brand-library`, scoped to `local-brand`. It is local to that browser, not a hosted team service. For shared team storage, implement `ComponentLibraryAdapter` with workspace authorization, immutable version lookup, bounded search, and atomic idempotent publishing. Set `capabilities.canPublish` to expose save controls; enforce access again at the provider boundary. Credentials stay in the host.

## Save, reuse, and upgrade

```ts
await session.library!.save({
  localComponentId: 'headline',
  componentId: 'brand-headline',
  name: 'Brand headline', version: '1.0.0',
  authorized: true, // explicit user Save action/request
  idempotencyKey: 'save-brand-headline-1', // retain for retries of this request
});
const matches = await session.library!.search({query:'headline', limit:10});
await session.library!.insert({
  componentId:'brand-headline', version:'1.0.0',
  props:{text:'Another story'}, startFrame:120, durationInFrames:120,
});
```

Saving extracts the transitive module graph and declared assets, validates the package, renders a representative preview, and publishes an immutable version. The preview uses defaults and representative instance props; required inputs must resolve to valid values. Instance values used for the preview do not become new component defaults. Declare embedded image assets through default asset inputs or `assetBindings`; the save API also accepts explicit asset IDs. Unrelated project files, chat, and reference context are not uploaded.

Insertion requires a structured scene project. It copies the exact code/assets into the project and records provenance and hashes in `/component-library-lock.json`. Existing projects never follow a moving `latest` version. Pins include the originating workspace; upgrading through a different workspace is rejected. When a project image ID collides with a bundled image ID, `insert({..., projectAssetInputs:['imageProp']})` explicitly selects the project asset for that input; the UI distinguishes included and project images. ZIP restore and export work without the library provider.

`session.library.upgrade({localComponentId, version})` explicitly updates that local component's instances, validates input compatibility and duration, and participates in undo. Local source edits block automatic upgrade; fork or reconcile them explicitly first. Publishing is external and immutable: undoing a project edit does not delete a published version.

In the UI, **Save to brand library** is explicit authorization. For an agent request that should publish, the host must pass `session.send(prompt, {libraryPublish:true})`, or the user can enable **Allow library publishing for this request** in the chat. This grants publishing only to that request and its recovery in the same live session. After restoring a checkpoint, publishing requires fresh host authorization through `session.resume(runId, {libraryPublish:true})`; a saved checkpoint cannot grant permission. Ordinary generation does not grant publishing permission.

## Recover a rendered draft

If a run fails after producing a valid draft, use **Restore saved draft** next to its interrupted-run controls, or call `session.restoreRunDraft(runId)`. This restores the saved scene modules, project data, music, and assets without another model call. It participates in undo and rejects restoration over a project changed since that run. A restored draft retains its review status; restoration does not mean visual approval.

## Validation and compatibility

- Scene edits, component/module changes, library insertions/upgrades, and their dependency metadata share revision history and rollback.
- Browser Web Locks serialize participating commits/recovery across tabs. Hosts using other writers must enforce their own concurrency boundary rather than writing directly into an active workspace.
- Legacy custom render adapters still receive `source`. Structured inputs additionally include `composition` and `modules`; custom adapters must render these and explicitly declare `adapters.renderSupportsScenes: true`. Otherwise structured rendering fails with an actionable error. Custom checks receive those fields as well.
- Imports are limited to TS/TSX/JS/JSX project modules and approved runtime dependencies. Footage compositing, arbitrary npm imports, source-to-timeline reverse engineering, advanced retiming, and automatic monolithic decomposition remain outside this release.
- Runtime uses pinned Remotion sequence context to retain authored duration through trims; the production browser regression covers this behavior on dependency upgrades.

Run `pnpm test`, `pnpm --filter @deepbench/browser-ad-renderer test:browser`, then build the portable package and run `node scripts/scenes-portable-smoke.mjs`. The public-package smoke exercises real scene clocks, UI edits, undo/redo, library reuse, offline ZIP restoration, and WebM export. Existing ZIP and React compatibility suites remain required.
