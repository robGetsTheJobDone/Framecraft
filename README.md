# Framecraft loading preview

A dependency-free, standalone loading-state preview pending integration into a real application. It remains in the loading state: there is no application lifecycle, simulated progress, completion timer, or success/error transition.

From the repository directory, run:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. Stop the server with Ctrl+C. No installation or build step is required.

## Files

- `index.html`: centered Framecraft wordmark and a polite, atomic status region with meaningful loading text. Decorative elements are hidden from assistive technology.
- `styles.css`: responsive layout, system typography, neutral background, teal accent, and a CSS indicator. Reduced motion disables rotation while preserving the visible ring and loading text.
- `README.md`: preview instructions and integration scope.

The preview uses no JavaScript, external fonts, assets, or network services. The only page resources are the local HTML and CSS; the favicon is an empty inline data URL. There are no interactive controls or focus traps.

## Validation

Check at 320px and desktop widths, and at 200% browser zoom. Confirm the content wraps without horizontal overflow, the status exposes “Loading…” and supporting copy, and reduced motion leaves a visible static indicator. Text uses dark colors on a light background for WCAG AA contrast. No build system, test suite, or test framework is included.

Implementation validation: local HTML and CSS returned HTTP 200. Source inspection confirmed the status attributes, hidden decorations, reduced-motion override, and exclusively local/inline resource references. Minimum calculated text contrast across the background gradient endpoints is 12.16:1 for headings and 5.47:1 for supporting copy.

Browser validation was attempted with temporary Playwright/Chromium tooling but Chromium could not launch because the runner lacks `libglib-2.0.so.0`. Rendering at 320px and desktop widths, 200% browser zoom, runtime reduced-motion behavior, and browser network requests remain unverified. These checks should be completed in a browser before integration.
