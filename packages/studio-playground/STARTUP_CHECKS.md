# Startup screen verification

Verified in Chromium via Playwright on 2026-10-31 against the playground's Vite dev server.

- Held the actual `pierogi-logo.png` fetch pending: centered loading screen at 1440 × 1000 and 320 × 640; screenshots reviewed. Exactly one `role=status` contains the loading message and supporting copy.
- Applied 200% CSS zoom at 320px: content reflows without horizontal overflow; vertical scrolling remains available. The wordmark wraps between “Frame” and “craft”.
- Emulated `prefers-reduced-motion: reduce`: indicator animation is `none`, with the status and static accent still visible.
- Released the pending fetch: startup screen unmounts and the actual `.deepbench-studio` mounts. Body margin changes from `0px` during startup back to its original `8px` after unmount.
- Returned HTTP 503 for the logo fetch: one `role=alert`, no loading status, readable error details and a Reload studio button. Indicator animation remains `none` even with reduced motion disabled.
- Tab focuses Reload studio; Enter reloads the document and requests the logo again.
- Rejected the asset fetch with a long unbroken error: error wraps without horizontal overflow at 320px and 200% CSS zoom.
- Opened `?mode=timeline` with the asset fetch rejecting: timeline studio mounts without the startup screen.
- No uncaught browser page errors during the completed checks. Network failures in the error cases were intentional.

Builds passed:

```sh
pnpm --filter '@deepbench/studio-playground^...' build
pnpm --filter @deepbench/studio-playground build
```

Vite reports dependency directive/annotation, mixed import and large chunk warnings; these do not fail the build. No new dependencies were added.
