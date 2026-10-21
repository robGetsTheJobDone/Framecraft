# @deepbench/browser-studio

Conversation-scoped orchestration for the browser video studio. This connects project persistence, Deep Agents, audio mixing, the dubbing wizard, and Remotion. A runnable host with media library, timeline controls, and chat lives in [`studio-playground`](../studio-playground/README.md); run `pnpm dev` from the repository root.

```ts
import {IndexedDBFileSystem} from '@deepbench/browser-filesystem';
import {openStudioSession, createLangChainScriptProvider} from '@deepbench/browser-studio';

const session = await openStudioSession({
  filesystem: new IndexedDBFileSystem({databaseName: 'studio'}),
  conversationId,
  seed: {title: 'Product walkthrough', durationSeconds: 30},
});
const agent = session.createAgent({model});
await agent.invoke({messages: [{role: 'user', content: 'Add an opening title to the video.'}]});
const wizard = session.createDubbingWizard({
  scriptProvider: createLangChainScriptProvider(model),
  speechProvider, // Application-supplied SpeechProvider returning real audio and duration.
});
```

Keep the session and wizard stable for the active conversation. Reopening seeds only missing files and restores `/project.json`. The agent's filesystem is scoped to that conversation, and its project tools validate changes and record revisions. Chat/checkpoint persistence is separate.

## Dubbing panel

```tsx
import {DubbingWizardPanel} from '@deepbench/studio-dubbing/react';

<DubbingWizardPanel
  wizard={wizard}
  store={session.store}
  project={project}
  onApplied={setProject}
/>
```

The panel selects an existing timeline video, drafts a script, edits timed segments, asks for script approval, generates speech, previews it, and adds a voiceover track. Original video audio can be preserved or muted. Regeneration after edits requires approval again. The LangChain adapter uses structured output and accepts a brief/transcript; it does not inspect video frames. Supply a capable model gateway and speech provider. No credentials or paid service calls are included.

## Import, edit, preview, and export

`session.importAsset(metadata, file)` stores immutable media and registers it in a revision. `file` can be a browser File/Blob or bytes. Metadata includes a unique ID, MIME type, media kind, and known duration; use `decodeMediaAudio()` from studio-audio to obtain audio duration when supported. Video container decoding depends on the browser. This is media ingestion, not a universal transcoder.

```ts
const asset = await session.importAsset({
  id: crypto.randomUUID(), kind: 'audio', mimeType: file.type,
  name: file.name, durationSeconds: audioDuration,
}, file);
await session.store.update(project => {
  project.tracks.find(track => track.id === 'music')!.clips.push({
    id: crypto.randomUUID(), kind: 'audio', assetId: asset.id,
    startSeconds: 0, sourceStartSeconds: 0,
    durationSeconds: Math.min(audioDuration, project.durationSeconds), gain: 0.25,
  });
});
const preview = await session.preparePreview();
// Pass preview.composition to BrowserRemotionPlayer.
// After the player is unmounted: preview.dispose().
const audio = await session.mixAudio(); // WAV saved under /exports.
const video = await session.exportVideo({format: 'webm'}); // Video saved under /exports.
```

Tracks and clips support trim/source offsets, timeline placement, gain, mute, and non-overlapping linear fades. Audio can be added before or after editing/dubbing. Previews and video exports use the same sample-accurate premix, normalized down only when the peak exceeds 1. Original video audio is muted in the temporary composition to prevent double playback. Visual timing is rounded to video frames. Direct use of the lower-level Remotion studio composition applies frame-based volume without this premix.

Video export snapshots the project, creates temporary media URLs, and releases them after encoding. Preview callers own URL disposal. Export requires supported codecs and HTTPS/localhost. A video with no audio should have `muted: true`; otherwise undecodable source audio fails explicitly. `mixAudio({videoAudio: 'skip'})` deliberately omits all embedded video audio when that is desired.

## Edits and concurrency

Use `store.update()` for UI read–modify–write operations. Agent tools return a current-project token and require it when saving, rejecting stale snapshots. These guarantees cover one shared store instance, including import and dub application. Multiple tabs/store instances and direct filesystem edits are not coordinated; use one writer per conversation. Raw agent filesystem writes bypass the validated save tool, so the prompt directs edits through it and load/preview/export validate the result.

Available agent tools: `get_studio_project`, `save_studio_project`, `mix_studio_audio`, and `export_studio_video`, plus Deep Agents filesystem tools. Speech generation remains in the approval-gated host wizard.

The integration test uses deterministic script/speech providers, real IndexedDB, real Web Audio mixing, and a real encoded video. Run `pnpm test:browser` from the repository root.

## Source studio agent

`createAdSession` powers the React/Remotion source studio. `send(prompt, {review?: boolean, signal?})` reviews the first prompt by default and skips reviewer calls on follow-ups unless explicitly enabled. Render validation and configured checks always run. Follow-up planning reads the current source and production plan and scopes changes to the request; structural redesigns can request a full production plan. Run records include the review setting and targeted edit plan.

The source agent can delegate music to `@deepbench/browser-music` using `compose_music` and `revise_music`. Customize its separate model and instructions with the session's `music` option. Scores, MIDI, and generated audio persist under `/music`, and the soundtrack joins the timeline. Synthesized audio is included in preview and export. Instrument synthesis uses JavaScript, with no sample-library downloads.
