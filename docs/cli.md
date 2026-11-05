# Framecraft CLI

The `framecraft` executable ships with `@framecraft/studio` 0.5.0 and later. It uses the same session, revision, recovery, and rendering APIs as the embedded editor. Node owns the project files and provider credentials; headless Chromium runs compilation, scene validation, audio, and video encoding.

Requires Node 22.22+ and Chromium. Install the matching browser once:

```sh
npm install -g @framecraft/studio
framecraft setup
```

For a development checkout, run `pnpm install && pnpm build`, then `node packages/studio/build/portable.mjs`. Use `node packages/studio/portable/cli/main.mjs` in place of `framecraft`. `pnpm test:cli` exercises the packaged runtime with real Chromium, MP4/WebM export, and a deterministic local model provider.

On Linux, Chromium also needs OS libraries; provision them with `npx playwright install-deps chromium` using the Playwright version installed with Framecraft. `--browser /path/to/chromium` or `FRAMECRAFT_BROWSER` selects an existing compatible executable.

## AI workflow

Set `OPENAI_API_KEY` in the shell environment. The CLI does not load `.env` automatically or accept keys as command-line arguments. Keys stay in Node and are not stored in the project or sent to the browser. The model defaults to `gpt-6-astra`; override with `OPENAI_MODEL` or `--model`.

```sh
framecraft create ./launch-ad \
  --brief "Create a 15-second product launch film with animated typography" \
  --duration 15 --format story:1080x1920 --format feed:1080x1080

framecraft edit ./launch-ad "Make the opening headline larger"
framecraft export ./launch-ad --format story --out ./launch-story.mp4
framecraft export ./launch-ad --format feed --out ./launch-feed.webm
```

`create` without `--brief` creates a blank project without a model call. Supplying a brief starts generation immediately. Planning and visual review use the configured model; `--no-review` disables the reviewer for that run while retaining render validation. The CLI imposes no output-token cap; provider/model limits still apply.

`--context ./product` on `create` mounts a filtered, read-only snapshot of text source files under `/context/product`. It excludes dependency/build directories, symlinks, and common credential filenames. It does not inspect arbitrary file contents for secrets; provide a directory suitable for model input. The snapshot remains pinned across later edits.

Set `OPENAI_BASE_URL` to a compatible API base URL, including `/v1`. Responses is the default protocol; use `--chat-completions` for providers that implement Chat Completions instead. Remote endpoints require HTTPS; local providers may use HTTP on loopback. Model calls have a five-minute transport timeout. `--timeout SECONDS` cancels a command after the given execution time; there is no default whole-command deadline.

## Drive it from a coding agent or script

Inspection, direct edits, asset import, undo/redo, and exports require no model key. Results are JSON; `--json` makes stdout compact JSON and stderr JSONL progress. Plain `read` writes the original text to stdout, while `read --json` returns `{path, content}`.

```sh
framecraft create ./film --mode source --duration 8 --format story:1080x1920
framecraft read ./film /Ad.tsx > Ad.tsx
# Edit Ad.tsx in your editor or coding agent.
REVISION=$(framecraft inspect ./film --json | jq -r .revision)
framecraft write ./film /Ad.tsx ./Ad.tsx --revision "$REVISION"
framecraft export ./film --out film.mp4
```

The default `scenes` mode uses multiple component modules. `apply` takes a JSON file containing the current `baseRevision` from `inspect` and a batch of scene operations. For a one-second project at 30 fps:

```json
{
  "baseRevision": "COPY_THE_REVISION_FROM_INSPECT",
  "operations": [
    {
      "type": "addComponent",
      "component": {
        "id": "headline",
        "entry": "/components/Headline.tsx",
        "authoredDurationInFrames": 30
      },
      "source": "export default function Headline(){return <div style={{width:'100%',height:'100%',background:'#10141e',color:'white',fontSize:64}}>Hello Framecraft</div>}"
    },
    {
      "type": "addScene",
      "scene": {
        "id": "intro",
        "componentId": "headline",
        "startFrame": 0,
        "durationInFrames": 30,
        "sourceStartFrame": 0,
        "layer": 0,
        "props": {}
      }
    }
  ]
}
```

```sh
framecraft apply ./film ./edit.json
framecraft undo ./film
framecraft redo ./film
```

Supported operations are `addComponent`, `updateComponent`, `removeComponent`, `writeModule`, `removeModule`, `addScene`, `updateScene`, `removeScene`, and `forkScene`. They use the SDK's [SceneOperation contract](../packages/browser-studio/src/scene-session.ts). Scene edits validate and render the whole batch before committing. Stale revisions and broken compositions leave the previous revision intact. `write` accepts `/Ad.tsx` for source projects, project JS/TS modules for scene projects, and `/project.json` for validated timeline changes. Internal checkpoint and context files are not writable through this command.

`framecraft asset ./film ./logo.png` imports a raster image and returns its asset ID. Bind that ID in your composition or refer to it in an AI edit. This first CLI supports raster image import and the model's existing scene/source and procedural music tools; it does not configure an image-generation service, speech service, or microphone UI. ZIP imports retain existing audio/video assets.

## Persistence, portability, and recovery

Each directory contains `.framecraft/state.json`: an atomic, versioned checkpoint containing the virtual filesystem, modules, assets, edit history, and resumable model runs. Keep this directory to preserve your project. Commands acquire an exclusive lock so two processes cannot mutate the same project. Failed or cancelled model runs retain their last durable tool boundary.

```sh
framecraft inspect ./film --json
framecraft resume ./film
# Specify the run ID if there is more than one interrupted run:
framecraft resume ./film RUN_ID

framecraft pack ./film --out film.zip
framecraft import film.zip ./film-copy
```

The ZIP is compatible with the embedded Framecraft editor. Import requires a new project; existing projects are never replaced. Existing output files require `--force` to overwrite. Ctrl-C requests cancellation, allows checkpoint saving, and exits with status 130. SIGTERM exits with 143. Other failures exit with 1. If the process is forcibly killed, confirm it has stopped before removing `.framecraft/lock`; the previous atomic checkpoint remains available for `resume`. The SDK blocks automatic replay of interrupted operations whose external outcome is unknown.

Model errors are surfaced with their upstream message instead of a generic connection error. Stdout is reserved for results; progress and errors use stderr. `setup` streams browser installation output.
