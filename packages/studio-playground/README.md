# DeepBench Studio playground

From the repository root:

```sh
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5180**. The root command first builds the workspace packages, then starts Vite. Port 5173 is fixed so browser storage stays on the same origin. Stop the server with Ctrl+C. Application edits reload through Vite; after changing another package, rebuild it or restart `pnpm dev`.

## Try it without credentials

1. Send `title: My next film` in the assistant panel. Demo chat uses the real Deep Agents tool loop with a deterministic local model. It supports title changes and `mute music` / `unmute music`, not arbitrary AI requests.
2. Upload images/audio/video or use **Sample video** and **Demo music**. New media is added to the timeline at time zero. Imported video audio starts muted; select the clip and uncheck **Mute clip audio** to enable it if the browser can decode it.
3. Select a clip to edit timing, source offset, gain, fades, or title text. Changes validate on **Apply changes**. Tracks can also be muted. **Length** controls total project duration; it cannot be shorter than existing clips.
4. Open **Dub video**, choose a source clip, enter a brief, draft, edit, approve, generate, then apply. **Demo drafting copies your brief, and demo speech is a test tone, not spoken words.** This lets you exercise the full workflow without network credentials.
5. Export a WebM video or WAV mix, then click the download link. Exports are also written to the conversation filesystem. Browser codec support is required; use a recent Chromium browser on localhost.

Each conversation has its own IndexedDB workspace and chat. Reopening/reloading restores it. Conversation labels and the selected conversation ID live in localStorage. Connection tokens are never persisted. A new conversation gets a starter title; **Sample video** replaces title clips with its sample footage. This is a small-workspace playground: uploads are limited to 100 MB and underlying filesystem operations currently read the workspace into memory.

## Browse the live conversation filesystem

Use **Files** or **Changes** in the top bar, including while the agent is working. The browser polls the scoped virtual filesystem every 2.5 seconds, lists added/modified/deleted files, and refreshes the timeline/preview when a valid project changes. The change feed records up to 100 events since this conversation was opened; it is not an audit log and intermediate writes between polls may be combined.

Chat commands run locally without calling the model:

- `/files` opens the file browser.
- `/changes` opens recent file changes.
- `/open /brief.md` opens a specific workspace path.

Text files up to 1 MB can be viewed and edited. Saved edits use an atomic content comparison so a concurrent agent or another tab cannot silently overwrite your draft. If there is a conflict, preserve your draft, then discard/reload and reconcile it with the current file. Conversation switching is disabled while the editor has unsaved work. Saves are disabled while the agent is running; file viewing and change monitoring remain available.

`/project.json` edits validate the timeline and create a project revision. Revisions and chat history are read-only. Media assets and exports have image/audio/video previews and a download link; they are never edited as text. Code files are shown as text and are not executed by the editor. Invalid project writes leave the last valid preview visible and show a validation error.

## OpenAI from your environment

Copy `.env.example` to `.env` at the repository root and set `OPENAI_API_KEY`. Restart `pnpm dev`; the header should show **OpenAI connected**. You can also export the variable in your shell. Defaults are `OPENAI_MODEL=gpt-6-astra`, `OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst`, `OPENAI_IMAGE_FALLBACK_MODEL=gpt-image-2.5-flare`, and `OPENAI_SPEECH_MODEL=gpt-realtime-2.1`. These environment variables can override the server models. Astra tool calls use the Responses API with low reasoning effort; conversation state remains in the browser. Speech is generated over a server-side Realtime WebSocket and returned as a 24 kHz WAV. The image fallback is attempted once for explicit model-unavailable errors, never for moderation, credential, quota, or ambiguous network failures. The response’s `X-Image-Model` header identifies the model used. Never use `VITE_OPENAI_API_KEY`: Vite-prefixed variables belong to the browser bundle.

The local Node middleware holds the key and calls OpenAI for chat, PNG images, and speech. The browser only receives model names and generated results. Requests begin when you use the assistant or approve speech; API usage is billed to your account. These routes are for a localhost studio, not a publicly hosted service. A static `dist` host alone cannot serve the API; use the Vite dev or preview server.

Try: **“Create three illustrated forest scenes across 12 seconds. Generate the images, remove the starter title, and request a short voiceover script.”** The agent extends the project, saves generated images into this conversation, and places image clips on the timeline. Remotion uses those assets in preview and export. Images can be repositioned/resized in time with the inspector, and use Fill frame or Fit image.

A voiceover request appears as a dashed clip labeled **! … — review script**. Click it to read and edit the script. **Save script** keeps it pending. **Approve & generate voiceover** creates AI speech and replaces the request with an audio clip at the same start time. Pending requests are silent in previews/exports. Failed generation leaves the request available for retry. Speech longer than the reserved slot is rejected rather than silently cut; shorten the script or adjust the request duration in the inspector. Scripts remain saved with the conversation after generation.

Current model and API references: [Astra migration](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#migration-quickstart), [image generation](https://developers.openai.com/api/docs/guides/image-generation), and [Realtime speech](https://developers.openai.com/api/docs/guides/realtime-conversations). These defaults reflect the documented models at the time of this update; they do not silently switch to future releases.

## Connect a real model and speech service

In **Settings**, enter an OpenAI-compatible gateway base URL (including `/v1` if your gateway expects it), model ID, and optional short-lived gateway session token. The model must support tool calling; script drafting additionally uses structured output. The browser calls the gateway directly, so configure CORS for `http://127.0.0.1:5180`. Requests start only when you use chat or draft a script. See the [LangChain ChatOpenAI reference](https://reference.langchain.com/javascript/langchain-openai/ChatOpenAI) for the model adapter.

Keep shared provider secrets on your gateway. Only HTTPS or localhost endpoints are accepted. Settings stay in memory and reset on reload. Existing project files/chat remain intact when switching modes.

The optional speech endpoint receives:

```http
POST /your-speech-endpoint
Content-Type: application/json
Authorization: Bearer <session token, when configured>
```

```json
{"text":"Your reviewed script","language":"en","voice":"optional-voice-id","targetDurationSeconds":2}
```

Return a successful response containing an audio file with an `audio/*` Content-Type. The browser decodes it to measure duration. Speech exceeding the segment is rejected unless you explicitly select trimming in the wizard. The bundled local server implements this contract at `/api/speech`. External providers have not been exercised with real credentials; local demo behavior is browser-tested.

## Validation

```sh
pnpm --filter @deepbench/studio-playground build
pnpm test:playground
pnpm test:studio-ai
pnpm test:files
```

The browser smoke test runs its own Vite instance on port 5174, uses an isolated browser profile, and checks agent edits, uploads, clip controls, exports, persistence, isolation, the dubbing panel, and responsive layout. Install Chromium once with `pnpm exec playwright install chromium`.

For production output, run `pnpm build`, then `pnpm --filter @deepbench/studio-playground preview` (port 4173). Production and development are separate browser origins and therefore separate workspaces. The runtime is currently a large bundle because it includes the agent and media stack; this is a local playground, not a hosting deployment.
