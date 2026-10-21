# @deepbench/browser-filesystem

A browser-safe asynchronous virtual filesystem for agent workspaces. No Node APIs, network services, runtime dependencies, or access to the user's disk. Use `MemoryFileSystem` for ephemeral sessions and `IndexedDBFileSystem` for persistent, same-origin workspaces.

```ts
import { IndexedDBFileSystem } from '@deepbench/browser-filesystem';

const fs = new IndexedDBFileSystem({ databaseName: 'my-agent-workspace' });
await fs.writeFile('/project/notes.md', '# Notes', { createParents: true });
const content = new TextDecoder().decode(await fs.readFile('/project/notes.md'));
const files = await fs.list('/project', { recursive: true });
await fs.close();
```

The exported `BrowserFileSystem` interface has `readFile`, `writeFile`, `stat`, `list`, `mkdir`, and `remove`. Reads return copied bytes; writes accept UTF-8 strings or byte arrays. Metadata exposes absolute `path`, `type`, byte `size` and millisecond `createdAt`/`modifiedAt` timestamps. Directory size is zero; directory timestamps describe directory creation (child writes do not update them).

Paths must start with `/`; repeated separators, `.` and in-root `..` are normalized. Root traversal, NUL bytes, and backslashes are rejected. Root always exists and cannot be removed. Listing is sorted, excludes the directory itself, and is shallow unless `recursive: true`. File writes overwrite by default; `exclusive: true` fails if the path exists. Missing parents require `createParents: true`. Directory creation and deletion accept `recursive: true`. Errors use `FsError` and filesystem-style codes; browser storage failures retain their native errors.

IndexedDB modifications commit in one read/write transaction, including parent creation and exclusive-write checks. Multiple connections share the same database safely. Operations resolve on transaction completion. The initial implementation reads the workspace index and file contents for each operation, so it is intended for small agent workspaces, not large video asset libraries. Browser quotas, storage eviction, private-mode restrictions, and origin isolation apply. This is storage, not a JavaScript execution sandbox. Closing a connection releases resources; a subsequent operation reopens it.

The implementation follows [IndexedDB transactions](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction) and the [transaction complete event](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event). Tests exercise both adapters; IndexedDB tests use `fake-indexeddb` and do not replace testing in the target browser.
