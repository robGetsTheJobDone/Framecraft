import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
const root = new URL('../packages/studio/portable/', import.meta.url);
const source = JSON.parse(await readFile(new URL('../packages/studio/package.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
assert.equal(pkg.name, '@framecraft/studio');
assert.equal(pkg.version, source.version);
assert.equal(pkg.private, undefined);
assert.equal(pkg.publishConfig.access, 'public');
for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
  assert.ok(!name.startsWith('@deepbench/'), `Unbundled workspace dependency: ${name}`);
  assert.ok(!/^(workspace:|file:|link:)/.test(version), `Local dependency: ${name}`);
}
for (const file of ['index.js', 'index.d.ts', 'node.js', 'node.d.ts', 'styles.css', 'esbuild.wasm', 'monaco-editor.worker.js', 'types/studio/index.d.ts']) await access(new URL(file, root));
const {loadContextFiles} = await import(new URL('node.js', root));
assert.equal(typeof loadContextFiles, 'function');
console.log(`Portable ${pkg.name}@${pkg.version} validated`);
