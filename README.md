# DeepBench

A browser-first AI video studio built as pluggable TypeScript packages in a pnpm workspace. Create editable React and Remotion ads, generate image assets, compose music, record voiceover, and export video locally.

**Run the studio:** `pnpm install`, then `pnpm dev`. Open **http://127.0.0.1:5180**. For real AI, copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and restart. Without a key it starts in demo mode. The agent can generate scene images for Remotion and request voiceover scripts for timeline review. See [playground instructions](packages/studio-playground/README.md).

| Package | Purpose |
| --- | --- |
| [`@deepbench/studio`](packages/studio/README.md) | Embeddable React studio, headless sessions, skills, and integration adapters. |
| [`@deepbench/browser-ad-renderer`](packages/browser-ad-renderer) | Browser compilation, sandboxed previews, rendered frames, and ad export. |
| [`@deepbench/browser-filesystem`](packages/browser-filesystem/README.md) | Shared async filesystem with memory and persistent IndexedDB adapters. |
| [`@deepbench/browser-deepagents`](packages/browser-deepagents/README.md) | LangChain Deep Agents environment backed by that filesystem. |
| [`@deepbench/browser-remotion`](packages/browser-remotion/README.md) | React video preview and local MP4/WebM export. |
| [`@deepbench/studio-project`](packages/studio-project/README.md) | Versioned timeline contracts, conversation isolation, seeding, validation, revisions. |
| [`@deepbench/studio-audio`](packages/studio-audio/README.md) | Browser decoding, trim/gain/fades, timeline mixing, and WAV export. |
| [`@deepbench/studio-dubbing`](packages/studio-dubbing/README.md) | AI script/speech interfaces, approval-gated workflow, and optional React wizard panel. |
| [`@deepbench/browser-music`](packages/browser-music/README.md) | Separate composer agent, procedural instruments, editable scores, MIDI and synthesized audio. |
| [`@deepbench/browser-studio`](packages/browser-studio/README.md) | Integrated conversation sessions, studio agent tools, imports, mixed previews, and video exports. |
| [`@deepbench/studio-playground`](packages/studio-playground/README.md) | Runnable React studio with media uploads, preview, timeline controls, assistant chat, and dubbing. |

## Development

Use Node.js 22.22+ and pnpm 10.15.0.

```sh
pnpm install
pnpm build
pnpm lint
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
```

`lint` currently performs TypeScript checking. Library packages export their compiled `dist` directories; build before consuming them. `pnpm dev` builds the playground's dependencies automatically and starts its local Vite server.

The browser suite verifies the actual Deep Agents tool loop, IndexedDB persistence, sample-accurate audio mixing, and the dubbing panel from draft through approval and speech application to an exported video with audible mixed audio. Deterministic model/speech providers keep tests credential-free. See [`tests/browser/fixture.tsx`](tests/browser/fixture.tsx) and [`tests/browser/studio-fixture.tsx`](tests/browser/studio-fixture.tsx).

For the integrated studio flow, start with [`createAdSession()` and `Studio`](packages/studio/README.md). Each conversation has its own files, editable composition, agent context, and review history. Sessions support checkpoint adapters, interrupted-run recovery, and ZIP download/import. Product source files can be supplied as read-only context. The reusable React dubbing panel is available at `@deepbench/studio-dubbing/react`; the playground demonstrates the application shell and timeline controls. Run its interactive browser checks with `pnpm test:playground`.

## Using the packages together

```tsx
import { IndexedDBFileSystem } from '@deepbench/browser-filesystem';
import { createBrowserAgent } from '@deepbench/browser-deepagents';
import { exportComposition, titleCardComposition } from '@deepbench/browser-remotion';

const filesystem = new IndexedDBFileSystem({ databaseName: 'my-project' });
const agent = createBrowserAgent({ filesystem, model });
// `model` is an application-supplied LangChain chat model with tool calling.
await agent.invoke({ messages: [{
  role: 'user',
  content: 'Write /video.json containing title and background strings for a title card.',
}] });
const props = JSON.parse(new TextDecoder().decode(await filesystem.readFile('/video.json')));
if (typeof props.title !== 'string' || typeof props.background !== 'string') {
  throw new Error('Invalid title-card parameters');
}
const blob = await exportComposition({ ...titleCardComposition, inputProps: props });
// Download/upload the Blob, or persist small outputs in the workspace:
await filesystem.writeFile('/output.mp4', new Uint8Array(await blob.arrayBuffer()));
await filesystem.close();
```

Applications supply model and image-generation adapters; the development playground provides a local gateway for credentials. Compilation, sandboxed Remotion previews, frame capture, music synthesis, storage, and video export run in the browser. The ad harness runs planning, design, rendering, and configurable visual review. Browser storage is origin-local and subject to quotas. Video export requires HTTPS/localhost and a supported browser encoder.

## Embed in another app

See [the studio package](packages/studio/README.md) for the React component, headless session, skills, adapters, portable install, and current browser limitations. Open http://localhost:5180/?mode=ad for the source-based workflow.

## Publishing

See [PUBLISHING.md](PUBLISHING.md) for the npm release workflow and one-time trusted publisher setup. The installable artifact is `@framecraft/studio`; internal packages remain private.
