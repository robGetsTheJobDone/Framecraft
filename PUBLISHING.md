# Publishing @deepbench/studio

The public Git repository lives in `studio/` in the local parent workspace. GitHub still sees the package workspace at its repository root. The sibling `hosting/` folder is not part of this repo.

The npm artifact bundles the internal workspace packages into one installable package. Workspace packages stay private; publish only `packages/studio/portable`. Version is taken from `packages/studio/package.json`.

## One-time npm setup

Use an npm account with permission to publish in the `@deepbench` scope. If the package does not exist yet, log into npm locally, run `pnpm pack:studio`, then run `npm publish --access public` from `packages/studio/portable` to create the first version.

In the npm package settings, configure a GitHub Actions trusted publisher:

- Owner: `robGetsTheJobDone`
- Repository: `DeepBench`
- Workflow: `publish.yml`
- Environment: leave empty
- Allow direct publishing with `npm publish`

The workflow uses Node 24 and OIDC; no stored npm token is needed. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/). Package scope ownership and npm publisher configuration must be completed in your npm account before automatic publishing works.

## Releases

1. Bump `version` in `packages/studio/package.json` to a new stable version.
2. Commit and push the change.
3. Create a GitHub release with the matching `vVERSION` tag, for example `v0.1.1` after bootstrapping `0.1.0`.

Publishing a release runs build, tests, portable bundle validation and a browser smoke test before publishing with public access and provenance. A mismatched tag fails. Never reuse an already published version. Pre-release version strings are rejected to avoid accidentally promoting them to npm's `latest` tag.

Run **Publish studio to npm → Run workflow** for validation only; manual runs do not publish. Locally, use `pnpm pack:studio` followed by `node scripts/check-portable.mjs`. Generated declarations are included in the npm artifact for consumers, but remain excluded from Git.
