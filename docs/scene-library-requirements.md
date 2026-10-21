# Scene editing and reusable brand library — requirements draft

Status: consolidated requirements draft from three parallel code reviews. Product defaults below remain proposals; no runtime implementation is included.

## Objective

Let an agent build videos from reusable scene components while users arrange scenes and edit exposed settings directly. Timeline, preview, export, agent edits, undo, and saved sessions must agree on the same project revision. Let users save useful components into a versioned brand library and reuse them across projects without silently changing existing videos.

## Agreed direction

- Visual arrangement and editable instance settings live in project data. Component code defines rendering and custom animation.
- Scenes have stable IDs and references to component modules; file names are user/agent chosen, not a fixed Intro/Product/Outro list.
- Multiple scenes can reuse one component with different props and timing. Scene components can import shared components.
- The agent plans scene/component structure, edits data for arrangement and exposed props, and edits scoped modules for design changes.
- Library releases are versioned. Existing projects retain their resolved version until explicitly upgraded.
- Save/search/insert/update operations are agent capabilities, subject to the host's access policy.

## Product assumptions to confirm

These are proposed defaults, not already approved product decisions.

1. A library belongs to a brand/workspace and is available across that workspace's projects.
2. Publishing requires an explicit user request or approval of an agent suggestion. Creating local components does not publish them.
3. MVP supports arbitrary scene placement and explicit layer order, with no automatic ripple movement. A reorder action must distinguish changing layer order from rearranging scenes sequentially.
4. Duration edits trim the visible window by default. Automatic retiming, ripple editing, and adaptive-duration behavior are separate future operations.
5. Legacy source projects remain supported as opaque compositions. Automatic decomposition into scenes is outside the initial release.
6. The host application owns durable library storage, authentication, and workspace authorization through an adapter. Framecraft provides contracts and a local development implementation.

## Current implementation constraints

| Area | Evidence | Requirement implication |
| --- | --- | --- |
| Compilation | `packages/browser-ad-renderer/src/renderer-runtime.ts:5–14`: one source string, `esbuild.transform`, 60,000-character limit | Add a bounded virtual module graph and module resolution; creating files alone is insufficient. |
| Sandbox | `packages/browser-ad-renderer/src/harness.tsx:24–31`: React/Remotion imports only; single exported Ad | Bundle approved project modules while retaining the isolated, network-denied execution boundary. |
| Render input | `packages/browser-studio/src/ad-session.ts:82–87`: source, image assets, format, duration, fps, mixed audio | Structured scenes and their dependency graph must reach every rendering path. |
| Existing data model | `packages/studio-project/src/index.ts`: schema v1 tracks with audio/video/image/text/voiceover | Introduce an explicit versioned scene/component model without treating legacy visual tracks as source scenes. |
| Candidate commit | `packages/browser-studio/src/ad-session.ts:293–323`: selected asset/music files plus Ad.tsx | Persist validated module additions, edits, dependencies, and removals as one coherent revision. |
| Undo | `packages/browser-studio/src/ad-session.ts:89–95`: source, plan, project snapshots | Expand history to include the complete module graph and library resolutions. |
| Checkpoints | `packages/browser-studio/src/checkpoints.ts:19–25`: recursive workspace capture | Preserve portable resolved components/assets; avoid live library dependencies on restore. |
| UI | `packages/studio/src/StudioView.tsx`: visual tracks can exist while source preview is active | Every editable visual control must affect the rendered project, or be explicitly unavailable. |

## Functional requirements

### Project and component contracts

**SCN-01 — Identity.** Separate scene-instance identity, project-local component identity, file paths, and external library identity/version. Renaming a file or moving a scene preserves its instance identity. Duplicating creates a new instance ID.

**SCN-02 — Arrangement.** Persist scene start, visible duration, layer order, component reference, and instance props. Define a canonical frame clock and conversion rules for existing second-based audio data. UI seconds must resolve to deterministic frame boundaries. Reject invalid ranges and dangling component/asset references.

**SCN-03 — Local time.** Separate authored content duration, visible window duration, and content offset. A scene receives its authored local clock/duration, output dimensions/format, validated props, and declared asset bindings; visible-window metadata is separate. Moving preserves the clock/offset. Trimming changes the visible window/offset without changing the authored duration seen by duration-driven animations (including the relevant Remotion duration context). Shared components inherit scene context unless explicitly configured otherwise. Direct seek and sequential playback of the same frame must produce the same output in every supported format.

**SCN-04 — Exposed controls.** Components declare serializable input schemas, defaults, labels, and supported controls. Initial controls cover text, number, boolean, color, enum, and asset reference. Arbitrary code internals are not automatically editable. Invalid props produce an actionable error before commit.

**SCN-05 — Dependency graph.** Support project-local relative module imports, shared helpers/components, and an explicit runtime allowlist. Detect missing imports, invalid entry exports, unsupported imports, and unsafe paths. Set and test limits for file count, module size, graph size, and assets. Do not silently inherit the single-file limit as the entire new project limit.

**SCN-06 — Composition root.** One renderer consumes project arrangement and component definitions. An SDK-owned root or reproducibly generated Ad.tsx may implement this; it must not become a second editable owner of timing/order. Preview, review captures, and export use the same resolved graph and arrangement.

**SCN-07 — Timing semantics.** Distinguish moving, trimming, changing layer order, and sequential rearrangement. Moving preserves local animation. Trimming does not imply speeding up animation. Define handling of gaps, overlaps, scene overflow, project shortening, and media source offsets. Define extension beyond authored duration; proposed MVP rejects it unless the component has an explicit supported hold/extension behavior. Cross-scene transitions and automatic retiming are deferred unless explicitly brought into scope.

### Agent workflow

The existing production-plan schema assumes sequential coverage and bounded scene counts/timing (`packages/browser-studio/src/production-plan.ts`). Revise it deliberately for the chosen arrangement contract; `plan.json` records intent and must never overwrite the authoritative manifest with stale timing.

**AGT-01 — Discovery and planning.** Choose scene boundaries for independent editing and reuse, not a mandatory one-scene-per-shot rule. Keep coordinated animations and transitions in one scene with nested/shared components when they need a continuous clock. Read current scene IDs, arrangement, component inputs/dependencies, library resolutions, and recent user changes. Plans identify target scenes/components, intended operation, and properties to preserve. Search approved library components before creating equivalent reusable work when relevant.

**AGT-02 — Scoped operations.** Provide typed operations for listing/reading scenes and components, creating/registering scenes, updating arrangement/props, editing local modules, and validating a candidate. Exact tool names are implementation choices. Timing and prop changes do not require an LLM-generated rewrite of component source.

**AGT-03 — Scope of changes.** Distinguish one instance, a shared component within this project, and publication of a library version. Report affected instances before changing a shared definition. Ambiguous requests use the narrowest reasonable scope; a project-local edit never implicitly publishes to the library.

**AGT-04 — Preserve manual edits.** Use expected revision/content checks for commits. A stale run must fail with recoverable conflict information rather than overwrite newer timing, props, modules, or audio changes. No silent regeneration of IDs or entire arrangements during focused edits.

**AGT-05 — Validation.** Stage edits, validate schemas/imports/assets, compile affected components and the full composition, render meaningful frames for affected scenes, and apply existing review policy. Verify scenes that occur between the existing four sample timestamps. Commit only the validated candidate; retain failure diagnostics and recovery state.

**AGT-06 — Recovery.** Resume interrupted local operations safely. External library publication needs an idempotency key and a way to reconcile uncertain results; a resumed run must not create duplicate releases. Local tool replay safety must be reassessed for multi-file edits.

### Brand library

**LIB-01 — Package.** A library release contains a stable library/component ID, immutable version, title/description/tags, entry module, required local modules, props schema/defaults, declared assets and dependencies, runtime compatibility metadata, artifact kind (scene or nested visual component), immutable content hashes, and a representative preview with its example props/format/duration. Preview is derived from the exact published revision.

**LIB-02 — Portable extraction.** Saving a component captures its transitive dependency graph and declared assets. Resolve or reject references to project-only helpers, scene IDs, inaccessible assets, and undeclared globals. Distinguish bundled assets from required instance asset inputs. Remap project-local asset IDs during extraction/insertion to avoid binding to unrelated assets with the same ID. Do not upload the whole project, conversation, or read-only product context as a shortcut.

**LIB-03 — Save.** On authorized save, prepare a reviewable package, validate it independently, render its preview, and publish an immutable version through the host adapter. The user's request to save a specific component supplies authorization; do not require a redundant approval for the same bounded action.

**LIB-04 — Search and inspect.** Search by workspace, text/tags, component kind, and compatibility. Paginate results and bound metadata/source payloads to avoid loading the whole library into agent context. Return identity/version, description, preview, exposed inputs, and required assets. The agent can inspect the package before selecting it. Library descriptions/source remain content, not higher-priority agent instructions.

**LIB-05 — Insert and pin.** Resolve a specific version, validate it, materialize its dependencies/assets into the project, and create an instance with independent props/timing. Persist provenance and a lock/resolution record. Projects must reopen/export from their checkpoint without library access.

**LIB-06 — Updates.** Publishing a newer version never mutates older releases or projects. An explicit project upgrade shows affected instances and input/schema changes, stages the update, validates/renders, and commits atomically. Incompatible inputs must be migrated explicitly or block the upgrade. Undo restores the previous resolution.

**LIB-07 — Local customization.** Distinguish prop overrides, shared local definition changes, and a fork of a library component. Preserve upstream provenance and mark local changes. Define copy-on-write behavior when only one instance needs code changes.

**LIB-08 — Provider boundary.** Keep storage/auth outside render code and portable snapshots. Adapter operations need cancellation, errors, conflict handling, stable version lookup, and idempotent publishing. Expose provider read/publish capabilities to the UI and tools. Workspace authorization is enforced by the provider, not by the model; denied cross-workspace reads/writes leave project and library unchanged. Local demo storage must be clearly identified as local.

### Persistence, integration, and UI

**SYS-01 — Coherent revisions.** Project data, source modules, component schemas, dependency resolutions, and asset references must commit and restore together. A failed or interrupted multi-file save must retain a usable previous revision and recoverable candidate; never publish a manifest referencing missing files.

**SYS-02 — Unified undo.** Manual arrangement/prop edits and agent edits participate in coherent undo/redo. Group a user gesture into one operation. Undo of a local insertion/update affects the project, not an already published immutable library release.

**SYS-03 — Portability.** Checkpoint save/restore, ZIP export/import, duplication, and interrupted-run recovery preserve all required modules, schemas, pinned assets, and provenance. Retain current archive path validation and resource limits; any limit change must be deliberate and documented.

**SYS-04 — Compatibility.** Version the project schema separately from checkpoint/archive envelope versions. Continue opening old source-mode and legacy timeline projects. Old interrupted runs need a legacy resume path or an explicit compatibility error; do not replay old single-file tools under new scene semantics. Document custom render-adapter and validation-hook changes; support or explicitly version existing public entry points rather than silently changing their inputs.

**SYS-05 — Editor behavior.** Show scene names and timing, expose supported controls, indicate shared component use and library version, and distinguish scene/instance/library actions. Arrange scenes without source edits. Every enabled action must affect preview/export consistently. Files mode remains available for code details.

**SYS-06 — Runtime boundary.** Keep generated components in the existing sandbox; library providers and credentials remain in the host. No arbitrary npm/network loading is added as a side effect of supporting local imports. Scope audio ownership so components do not unexpectedly duplicate timeline-mixed audio. Proposed MVP: moving a visual scene leaves absolute audio timing unchanged; scene-linked audio requires an explicit future attachment contract. Pin brand tokens/assets or resolve them through a versioned project brand snapshot so live library changes cannot alter old renders.

**SYS-07 — Performance.** Reuse compilation where possible; cache keys and invalidation include transitive dependency contents, runtime version, and relevant compile settings. Timing/prop edits should avoid recompiling unchanged modules. Measure cold compile, warm edit-to-preview, graph size, and export memory with a representative multi-scene/shared-component fixture; agree budgets after the feasibility spike.

## Migration strategy

- Keep existing source compositions working without conversion.
- Offer an explicit migration that wraps the existing composition as one opaque scene, retaining its original clock/duration and asset bindings. Validate frame/audio equivalence before marking conversion complete.
- Splitting arbitrary old Ad.tsx into editable scenes is a separate assisted operation, with preview and undo, not a silent schema migration.
- New structured projects use the scene/component contract. Do not reinterpret legacy timeline image/text/video clips as equivalent scene definitions without an explicit conversion policy.

## Proposed delivery slices

1. **Feasibility:** two scene modules share one component; root renders from arrangement; local imports stay sandboxed; move one scene and prove preview/export parity. Measure cost before final scheduling.
2. **Reliable scene editing:** schema and validation, module compilation, agent scoped tools, timeline/prop controls, coherent revisions, conflict handling, undo, checkpoint/ZIP support, legacy compatibility.
3. **Reusable brand library:** validated extraction, provider interface, explicit save, search/inspect/insert, previews, pinned portable releases, local forks, explicit version upgrades.
4. **Later:** cross-scene transitions, retiming/ripple, arbitrary nested animation editing, marketplace/public sharing, automatic legacy decomposition, cross-project bulk upgrades, collaborative live editing.

## Acceptance scenarios

| ID | Scenario | Pass condition |
| --- | --- | --- |
| A01 | Three scenes with arbitrary filenames; two reuse one component | All render in declared order/timing; IDs survive renames and reorder. |
| A02 | Move a scene from 3s to 5s | Code bytes remain unchanged; animation keeps local timing; preview/export agree. |
| A03 | Change one instance headline | Only that instance's props change; other instances and shared source remain unchanged. |
| A04 | Redesign one instance of a reused component | Explicit local fork or scoped mechanism isolates the change; unrelated instances are unchanged. |
| A05 | Edit a shared local component | Affected instances are identified; all intended instances update; unrelated components do not. |
| A06 | Shorten a scene / project | Declared trim/overflow behavior applies; a duration-driven animation keeps its authored speed; no implicit retiming or invalid audio references. |
| A07 | Nested helper import, asset binding, or schema is invalid | Candidate fails before commit with file/component-specific diagnostics; previous revision still renders. |
| A08 | Manual change arrives during agent work | Stale candidate cannot overwrite it; conflict is recoverable. |
| A09 | Undo/redo a module edit plus scene registration | Source graph and project references return together, without dangling imports. |
| A10 | Interrupted multi-file commit / resume | Previous or completed revision is coherent; recovery cannot duplicate a scene; retry after an uncertain publish result returns the same release. |
| A11 | Save component with shared helper and image | Standalone package includes only required dependencies/assets and renders independently. |
| A12 | Insert library v1 into two projects; publish v2 | Both retain v1 until explicitly updated; update in one leaves the other unchanged. |
| A13 | Upgrade changes required props | Explicit migration or actionable failure; no silent content loss; undo restores v1. |
| A14 | Export ZIP, remove library access, import into new session | All visuals, audio, props, modules, and pinned versions still render correctly. |
| A15 | Restore old source/legacy timeline project | Existing supported visual/audio behavior remains intact; conversion is optional. |
| A16 | Tiny scene falls outside 10/35/60/85% timestamps | Validation samples that scene and catches a rendering failure. |
| A17 | Production package used by React 18 and 19 hosts | Multi-module scene preview/edit/export and ZIP regression pass through the packaged API. |
| A18 | Two projects have different assets with the same local ID | Library extraction/insertion resolves the intended asset; no accidental substitution. |
| A19 | Provider denies cross-workspace access or publish | Tools report denial; no project/library mutation or unauthorized content disclosure. |

## Decisions still requiring specification

- Library sharing and publish policy (questions sent to user).
- Frame-based canonical scene timing versus second-based storage with deterministic quantization; FPS-change semantics.
- Default scene overlap, sequential reorder, and duration-trim behavior.
- Component/scene contract, audio policy, nesting depth, initial prop-control types, and whether the first library release supports both scenes and nested components.
- Brand tokens packaged per release versus a versioned project brand snapshot; no unversioned live binding by default.
- Supported scene media: image/text/custom React first, or footage/video support in the initial scope.
- Host adapter shape, local demo persistence, workspace identity, and authorization integration.
- Public render/check-hook compatibility and package versioning strategy.
- Concrete performance/resource budgets and maximum representative project size.
