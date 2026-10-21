import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const upstream = JSON.parse(await readFile(require.resolve('deepagents/package.json'), 'utf8'));
if (upstream.version !== '1.15.1') throw new Error('Review browser packaging for the new Deep Agents version');

const root = fileURLToPath(new URL('../', import.meta.url));
// deepagents 1.15.1's advertised browser barrel shares a chunk with its Node-only
// LangSmith sandbox. Remove that unsupported export, not filesystem behavior.
// Fail closed on upstream layout changes so upgrades need a deliberate review.
const sandboxImport = /^import .* from "langsmith\/experimental\/sandbox";\n/gm;
const browserRuntime = {
  name: 'deepagents-browser-runtime',
  setup(plugin) {
    plugin.onLoad({ filter: /deepagents\/dist\/(browser|langsmith-[^/]+)\.js$/ }, async ({ path }) => {
      let contents = await readFile(path, 'utf8');
      if (path.endsWith('/browser.js')) {
        if (!contents.includes('t as LangSmithSandbox,')) throw new Error('Deep Agents browser barrel changed');
        contents = contents.replace('t as LangSmithSandbox,', '').replace('LangSmithSandbox,', '');
      } else {
        const start = contents.indexOf('//#region src/backends/langsmith.ts');
        const end = contents.indexOf('//#endregion', start);
        if (start < 0 || end < 0 || !contents.includes('LangSmithSandbox as t,')) throw new Error('Deep Agents sandbox chunk changed');
        if ([...contents.matchAll(sandboxImport)].length !== 1) throw new Error('Deep Agents sandbox import changed');
        contents = contents.slice(0, start) + contents.slice(end + '//#endregion'.length);
        contents = contents.replace(sandboxImport, '')
          .replace('LangSmithSandbox as t,', '');
      }
      return { contents, loader: 'js' };
    });
  },
};
const result = await build({
  metafile: true,
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  external: ['@deepbench/browser-filesystem'],
  alias: {
    'node:crypto': fileURLToPath(new URL('./sha256.ts', import.meta.url)),
    path: 'path-browserify',
    util: 'util/',
  },
  plugins: [browserRuntime],
  inject: [fileURLToPath(new URL('./globals.ts', import.meta.url))],
  sourcemap: true,
  // Ship the production runtime; no provider credentials are injected.
  define: { 'process.env.NODE_ENV': '"production"' },
});

for (const output of Object.values(result.metafile.outputs)) {
  for (const imported of output.imports) {
    if (imported.external && imported.path !== '@deepbench/browser-filesystem') {
      throw new Error(`Unexpected unresolved browser dependency: ${imported.path}`);
    }
  }
}
