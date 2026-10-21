# @deepbench/studio-project

Version 1 contract and per-conversation workspaces for a browser video studio. All timeline and source offsets use seconds. Media clips reference assets by ID; clips must fit both project duration and known source duration. Audio gain is linear, defaults to 1, and fades default to zero. Track/clip mute affects audio only, preserving video imagery. Text tracks contain captions/titles. Overlapping clips are permitted intentionally for mixing and compositing.

```ts
const store = createProjectStore(new IndexedDBFileSystem(), conversationId);
const project = await store.seed({ title: 'Launch video', durationSeconds: 30 });
// Pass store.filesystem to an agent: / maps only to this conversation.
const asset = await store.writeAsset({ id: 'music', kind: 'audio', mimeType: 'audio/wav' }, wavBlob);
project.assets.push(asset);
await store.save(project);
```

`seed` creates `/project.json`, `/brief.md`, `/AGENTS.md`, `/assets`, `/exports`, `/revisions` once, repairs missing starter files, and preserves existing content. Malformed saved projects throw; they are never reset. Conversation IDs are encoded injectively to filesystem-safe UTF-8 hex. `filesystem` exposes only conversation-relative paths, while `resolveAssetPath` is for callers using the original shared filesystem.

`validateProject(unknown)` returns issues; `assertValidProject` throws with their paths. Validation checks JSON structure and declared references, not existence or decodeability of asset bytes. Image assets can be stored, but v1 timeline visual media clips are video only.

`save` writes an immutable revision then replaces project JSON. Each filesystem write is atomic in the bundled filesystem implementations; the multi-file save is not a transaction. Failed writes may leave orphan revisions/assets. Saves are serialized within one store, but concurrent store instances/tabs are last-writer-wins. Keep one writer per conversation. `restoreRevision` publishes the snapshot as a new revision. Revision history begins at the first save, not at seed. Chat history/provider secrets are application-owned and are not persisted here.

Use `store.update(async project => { /* mutate project */ })` for read-modify-write operations: it serializes the whole operation against other updates/saves on that store. Do not invoke `save`, `update`, or `restoreRevision` from inside a mutator (that would wait on itself). For longer-lived editor snapshots, retain `const token = JSON.stringify(project)` after `load`, and call `save(edited, {expectedProjectJson: token})`; a changed current project rejects rather than overwriting edits. Tokens represent semantic parsed JSON serialization, not original file whitespace. `load` may return the previous published state while an update is in progress. Direct filesystem writes bypass validation, revisions, and the queue; cross-store/cross-tab writers still require application-level coordination.
