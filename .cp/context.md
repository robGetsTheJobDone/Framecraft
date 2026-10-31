# Project environment
Node 24.15.0, pnpm 10.15.0 monorepo (packages/*). Playwright 1.64.1 Chromium preinstalled at /ms-playwright (with system deps). Run `pnpm install --frozen-lockfile`, then `pnpm build`, `pnpm test`; browser smoke tests via `pnpm test:browser` etc. Dependencies are not preinstalled; install per checkout.
## Checks (commands that prove the environment works)
- install: `pnpm install --frozen-lockfile`
- build: `pnpm build`
- test: `pnpm test`
# Context from the Project Brain
## Relevant memories
- (finding) Framecraft environment registration blocked by control-plane build contexts Environment setup 2026-10-31: committed .cp/environment.Dockerfile (Node 24.15.0, pnpm 10.15.0, cached pnpm lock graph, Playwright 1.64.1 Chromium with Linux deps). environment.build 0c6006b7-e0c6-4ccd-a9d8-828fc6173ad1 and environment.register 7d29f53e-789a-461d-bc2c-6e6b4276e97d fail before Dockerfile execution: error: invalid local: resolve : lstat /empty: no such file or directory. environment.test 8c385a56-1243-41e9-b58b-e7e6fffca6b5 fetches repo at 7cdcc611 then fails 'failed to read dockerfile: open Dockerfile: no such file or directory' despite supplied full dockerfile argument. Need control-plane build context repair; no project checks ran and registration not successful.
## Decisions
## Skills
## Prior attempts
- [success] Unify studio design tokens and base styles: https://github.com/robGetsTheJobDone/Framecraft/pull/5
- [success] Tidy StudioView layout and sub-components markup: https://github.com/robGetsTheJobDone/Framecraft/pull/4
- [success] Replace the playground startup placeholder with an accessible branded loading screen: https://github.com/robGetsTheJobDone/Framecraft/pull/3
- [success] Tidy studio WorkspaceFiles component: https://github.com/robGetsTheJobDone/Framecraft/pull/7
- [success] Clean up playground shell UI: https://github.com/robGetsTheJobDone/Framecraft/pull/6