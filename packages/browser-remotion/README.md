# @deepbench/browser-remotion

React preview and client-side video export. All Remotion packages are pinned to **4.0.537**.

```tsx
import {BrowserRemotionPlayer, exportComposition, titleCardComposition} from '@deepbench/browser-remotion';

export function VideoEditor() {
  return <>
    <BrowserRemotionPlayer composition={titleCardComposition} />
    <button onClick={async () => {
      const blob = await exportComposition(titleCardComposition);
      // Store the Blob, upload it, or expose a download link using URL.createObjectURL(blob).
      console.log(blob);
    }}>Export MP4</button>
  </>;
}
```

Replace the composition's `component` and `inputProps` to use your own React video; preview and export receive identical inputs. Export accepts `{format: 'webm', signal: controller.signal, onProgress: (fraction) => {}, licenseKey}`. It dynamically loads the renderer, checks the requested codec and dimensions, and returns a Blob. Abort errors and rendering failures propagate to the caller. Blob URLs created by the host should be revoked when no longer needed.

## What runs in the browser

- [Player](https://www.remotion.dev/docs/player/player) previews a React component directly. It does not require a Remotion Studio project.
- [Web Renderer](https://www.remotion.dev/docs/web-renderer) exports using WebCodecs; its API has been stable since 4.0.491. This package uses MP4/H.264 or WebM/VP8 and [checks capability](https://www.remotion.dev/docs/web-renderer/can-render-media-on-web) before rendering. A browser with a secure context (HTTPS or localhost) and compatible encoder is required. Preview success does not guarantee export support.
- The [client renderer has CSS and media limitations](https://www.remotion.dev/docs/client-side-rendering/limitations). Its default canvas reconstruction does not capture arbitrary browser layout perfectly. Keep compositions within its supported features; prefer Remotion's recommended media components and CORS-accessible assets. Test real target browsers, output, and fonts.
- [Rendering](https://www.remotion.dev/docs/web-renderer/render-media-on-web) is local but resource-intensive, and this Blob helper holds the completed file in memory. Remotion's lower-level API supports streaming output for larger jobs. Remotion's [licensing](https://www.remotion.dev/docs/license) and [telemetry](https://www.remotion.dev/docs/client-side-rendering/telemetry) apply; a local render is not a promise of no network traffic.

## Studio timelines

`createStudioComposition(project, assetUrls)` renders the shared studio timeline with video, audio, and text clips. `prepareStudioComposition(project, resolveAsset)` creates temporary media URLs and returns `{composition, dispose}`; release URLs after the Player/export finishes. Later visual tracks overlay earlier tracks. Mute affects audio only, preserving video visibility. Clip timing/source offsets round to video frames.

The renderer uses [`Audio`](https://www.remotion.dev/docs/media/audio) and [`Video`](https://www.remotion.dev/docs/media/video) from `@remotion/media`, which support client rendering. Lower-level timeline rendering uses raw track/clip gain with frame-based fades. For consistent normalized audio in preview and export, use `@deepbench/browser-studio`'s session methods, which pre-mix the timeline to one WAV.

## Agent-generated source files

This package accepts already-compiled React components. Writing `.tsx` to the browser filesystem does not automatically load or execute it.

The official [Browser Bundler](https://www.remotion.dev/docs/browser-bundler) can compile virtual project snapshots and resolve registered compositions. At 4.0.537 it is an **experimental**, Chrome-tested API, separate from this package. It needs HTTPS/localhost, module workers, shared-memory WebAssembly, emitted compiler assets, and cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`). It resolves npm imports over HTTP.

The next integration can map the filesystem's source snapshot into that compiler and hand its resolved component to the Player/export path. Run generated source in an isolated origin with restricted capabilities: compiling code does not sandbox it. No arbitrary source execution or Node shell is provided here. For now, agents can edit JSON parameters for trusted, precompiled compositions such as `TitleCard`.

## Verification

`pnpm --filter @deepbench/browser-remotion test` checks metadata validation, unsupported encoders, codec selection, input preservation, cancellation, and non-browser rejection. These mocked unit tests do not prove a physical browser encoder works; run a browser smoke export for the deployment target.

From the monorepo root, `node packages/browser-remotion/test/browser/smoke.mjs` bundles this package and runs a real Chromium preview plus a three-frame 320×180 WebM export. It verifies the title, MIME type, nonempty encoded bytes, WebM header, and absence of page errors. The workspace's Playwright Chromium installation is required (`pnpm exec playwright install chromium`).
