import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
const root = new URL('../packages/studio/portable/', import.meta.url);
const source = JSON.parse(await readFile(new URL('../packages/studio/package.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
assert.equal(pkg.name, '@framecraft/studio');
assert.equal(pkg.version, source.version);
assert.deepEqual(pkg.peerDependencies, source.peerDependencies);
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

// Follow static edges only: opening the package must not eagerly load optional engines.
const {outputs} = JSON.parse(await readFile(new URL('../packages/studio/dist/portable-meta.json', import.meta.url), 'utf8'));
const visited = new Set();
function visit(path) {
  if (visited.has(path)) return;
  visited.add(path);
  const output = outputs[path];
  assert.ok(output, `Missing output chunk: ${path}`);
  for (const item of output.imports) if (!item.external && item.kind !== 'dynamic-import') visit(item.path);
}
visit('packages/studio/portable/index.js');
const eagerInputs = [...visited].flatMap(path => Object.keys(outputs[path].inputs));
for (const feature of ['monaco-runtime', 'tone-renderer', 'renderer-runtime', 'harness-code']) {
  assert.ok(!eagerInputs.some(path => path.includes(feature)), `${feature} is eagerly loaded`);
  assert.ok(Object.values(outputs).some(output => Object.keys(output.inputs).some(path => path.includes(feature))), `${feature} missing from bundle`);
}
const eagerBytes = [...visited].reduce((sum, path) => sum + outputs[path].bytes, 0);
assert.ok(eagerBytes < 5_000_000, 'Initial JavaScript exceeds the 5 MB uncompressed budget');
console.log(`Initial static JavaScript: ${(eagerBytes / 1e6).toFixed(2)} MB; editor, Tone and renderer are deferred.`);
