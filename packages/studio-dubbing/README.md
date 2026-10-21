# @deepbench/studio-dubbing

A browser-safe, headless dubbing wizard over the shared studio project. A UI or agent can call its methods; AI and speech services are injected, with no bundled credentials or paid calls.

```ts
import { DubbingWizard } from '@deepbench/studio-dubbing';
import { createProjectStore } from '@deepbench/studio-project';

const store = createProjectStore(filesystem, conversationId);
const project = await store.seed();
// Import a video asset and place its video clip on the timeline first.
const wizard = new DubbingWizard({ scriptProvider, speechProvider });
wizard.selectSource(await store.load(), videoClipId);
await wizard.draft('Write a friendly introduction in Spanish', { language: 'es' });
// Show wizard.state.segments in an editable script/timing form.
wizard.editSegments(editedSegments);
wizard.approve();
await wizard.synthesize({ voice: 'your-provider-voice', overflow: 'reject' });
await wizard.apply(store, { sourceAudio: 'mute', title: 'Spanish narration' });
```

`ScriptProvider.draft` receives the prompt, language, selected source asset metadata and timeline, plus an AbortSignal. Return nonempty, ordered, nonoverlapping segments with unique IDs and absolute timeline seconds contained within the selected clip. Fetch or transcribe media within your provider adapter if needed; metadata alone does not make a model understand the video.

`SpeechProvider.synthesize` receives text, language, optional voice, target duration, and an AbortSignal. Return a real nonempty audio Blob with an audio MIME type and its measured duration in seconds. The target is a hint: the wizard does not time-stretch speech. Overflow rejects by default; explicit `overflow: 'trim'` places a shorter timeline clip while preserving the full audio asset. Short speech leaves silence in the remaining segment window.

The lifecycle is source → drafting → editing → approved → synthesizing → ready → applying → applied. Edits invalidate approval and synthesized audio. Cancellation and source changes invalidate late results even from providers that ignore abort signals. Failed providers leave an editable/retryable state; inspect `wizard.state.error` and handle the rejected promise.

Applying persists audio bytes, adds a voiceover track and script, and optionally mutes only the selected video's audio. Existing music and other tracks remain available to the mixer. Source changes are rejected. Applying uses the store’s serialized update callback so other writes through the same store instance cannot overwrite the dub. Share one project store instance per conversation; the filesystem store does not offer cross-tab compare-and-swap transactions. An interrupted apply can leave unreferenced audio assets; it does not add a partially synthesized track.

The optional React entry point supplies an accessible visual wizard with source selection, brief and language, script/timing editing, approval, voice selection, speech preview, cancellation, and source-audio policy:

```tsx
import { DubbingWizardPanel } from '@deepbench/studio-dubbing/react';

<DubbingWizardPanel
  wizard={wizard}
  store={store}
  project={project}
  onApplied={setProject}
/>
```

Keep `wizard` and `store` stable across renders. The panel manages its own workflow interactions; avoid independently mutating that same wizard while the panel is mounted. Install React 19 for this optional entry point. Headless consumers do not import React. `getGeneratedAudio()` also exposes immutable audio blobs and copied timing metadata for custom preview UIs.

Transcription, hosted model adapters, and automatic voice cloning are not bundled.
