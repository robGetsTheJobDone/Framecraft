# Framecraft loading-state preview

A dependency-free static preview built with system fonts and local CSS. The checkout had no tracked application files when rechecked. **No application lifecycle exists to integrate yet.** This preview stays in its loading state; it has no JavaScript, timers, invented progress or simulated completion. A future application must connect the loading view to its real loading, success and error transitions.

## Serve locally

From this checkout, run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory /workspace
```

Open http://127.0.0.1:8000 in a browser. No package installation, build step, external fonts or external assets are required. You can also open `index.html` directly.

## Accessibility and layout

The loading message and supporting copy are in a polite, atomic `role="status"` region. Decorative marks and the CSS indicator are hidden from assistive technology. Reduced-motion preferences disable rotation while retaining the indicator and readable status. The layout uses fluid width, wrapping copy, flexible spacing and minimum rather than fixed viewport height so content can scroll vertically when enlarged.

## Verification — 2026-10-31

- Rechecked `/workspace`: unborn `master`, only `.cp` metadata, no existing app, tests or build commands.
- Served HTML and CSS locally with Python; both returned HTTP 200 and matched the source files.
- Source checks passed for one status region, local-only asset references and the reduced-motion animation override. No script or external CSS imports exist.
- Browser verification is **unavailable in this runner**. Playwright 1.64.1 and Chromium were provisioned outside the repository, but Chromium could not launch because the system library `libglib-2.0.so.0` is missing. Thus visual rendering, computed overflow, accessibility-tree output and reduced-motion emulation could not be verified. No browser check is claimed as passing.
- Remaining browser checks: inspect at 320px and desktop widths, repeat at actual 200% browser zoom, confirm no horizontal overflow, emulate reduced motion and confirm the indicator is static, inspect the status in the accessibility tree, and confirm the Network panel shows only local requests. Test with a screen reader if available; initial live-region announcement behavior varies by browser and assistive technology.
