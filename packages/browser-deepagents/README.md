# @deepbench/browser-deepagents

A browser-owned filesystem environment for the real LangChain Deep Agents runtime. Imports `deepagents/browser` and implements its current `BackendProtocolV2`; it never imports a Node filesystem or shell backend.

```ts
import { IndexedDBFileSystem } from '@deepbench/browser-filesystem';
import { createBrowserAgent } from '@deepbench/browser-deepagents';

const filesystem = new IndexedDBFileSystem({ databaseName: 'agent-workspace' });
const agent = createBrowserAgent({
  filesystem,
  model, // A configured browser-compatible LangChain chat model instance
  systemPrompt: 'Create and maintain project files in your workspace.',
});
const result = await agent.invoke({
  messages: [{ role: 'user', content: 'Write a storyboard in /storyboard.md' }],
});
```

Configure `model` in your application with a browser-compatible provider adapter pointed at your authenticated model gateway (or a local browser model implementing LangChain's chat-model contract). The gateway must support the adapter's protocol and tool calls; a cross-origin gateway must allow your app via CORS. This package does not create a gateway or include credentials. Do not embed a shared provider API secret in browser code. Explicit model instances avoid Deep Agents' default provider selection and dynamic provider loading.

`BrowserBackend` is also exported for direct backend operations. Browser applications should use the packaged `createBrowserAgent` factory so they receive the compatibility build described below.

Files survive agent invocations independently of graph state; IndexedDB additionally survives reloads. Conversation history/checkpoint persistence is separately configured through Deep Agents. Each backend exposes its provided filesystem to all tools and subagents using that backend; create a separate database/filesystem when isolation is required. Do not call `close()` until all runs finish.

Supported operations: list, line-paginated text reads, binary reads, overwriting writes, literal edits, recursive glob matching, literal grep with optional match caps, recursive deletion, binary upload/download. Writes create parent directories. Glob patterns are relative to the supplied directory (or absolute when starting with `/`); grep's filename filters support basename matching. UTF-8 text and common media types are detected; `BrowserBackend` accepts an optional MIME resolver. Unknown valid UTF-8 files are text, other unknown files are binary. Search walks the workspace in memory, so very large workspaces may require a dedicated indexed implementation. Read/modify/write edits are not transactional across concurrent agents or tabs.

This is a filesystem environment, not a process sandbox: there is no `execute` tool, shell, npm installation, or arbitrary Node execution. Browser Remotion integration is provided separately. Agent-written source text is not automatically executable; applications should expose deliberately scoped tools to compile or preview it.

References: [official browser entrypoint](https://github.com/langchain-ai/deepagentsjs#runtime-entrypoints), [custom backends](https://docs.langchain.com/oss/javascript/deepagents/backends), [V2 protocol source](https://github.com/langchain-ai/deepagentsjs/blob/main/libs/deepagents/src/backends/v2/protocol.ts).

## Browser packaging workaround

Deep Agents is pinned to `1.15.1`. Despite its official browser entrypoint, that release's shared chunk imports a Node-only LangSmith sandbox, Node SHA-256, and micromatch's Node utilities. Our production build emits a standalone browser ESM bundle: it removes only the unsupported LangSmith sandbox class/import/export from the pinned browser chunk, implements the binary offload digest with the real `@noble/hashes` SHA-256, and supplies real `path-browserify`/`util` implementations for micromatch. Lexically scoped `process/browser` and `buffer` implementations provide scheduling and binary codecs without modifying browser globals. No filesystem or crypto operation is silently stubbed. The transformation checks upstream chunk markers and fails on an unexpected layout; review it when upgrading Deep Agents. Applications import this package's built `dist` entrypoint, with no bundler aliases required. Source-level imports of this package's `src` files bypass that packaging and are not supported for browser consumers.

The bundled runtime adds size in exchange for predictable browser compatibility. LangChain model instances supplied by the application interoperate through the public model contract. Tests cover actual graph execution and SHA-256 vectors; the repository's browser smoke test additionally invokes the packaged agent inside Chromium.
