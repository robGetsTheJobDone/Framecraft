import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, copyFile, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
const repo = fileURLToPath(new URL('../', import.meta.url));
const root = await realpath(await mkdtemp(resolve(tmpdir(), 'framecraft-react18-')));
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit', ...options});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
};
try {
  run('npm', ['pack', resolve(repo, 'packages/studio/portable'), '--pack-destination', root]);
  const {version} = JSON.parse(await readFile(resolve(repo, 'packages/studio/portable/package.json'), 'utf8'));
  await writeFile(resolve(root, 'package.json'), JSON.stringify({private: true, type: 'module', dependencies: {
    '@framecraft/studio': `file:./framecraft-studio-${version}.tgz`,
    react: '18.3.1', 'react-dom': '18.3.1', '@langchain/core': '1.2.14',
  }, devDependencies: {vite: '7.3.1', typescript: '5.9.3', '@types/react': '18.3.1', '@types/react-dom': '18.3.1'}}, null, 2));
  // No force or legacy-peer-deps: consumer dependency resolution must succeed.
  run('npm', ['install', '--no-audit', '--no-fund']);
  run('npm', ['ls', 'react', 'react-dom']);
  await writeFile(resolve(root, 'vite.config.mjs'), "export default {optimizeDeps:{exclude:['@framecraft/studio'],include:['react','react-dom','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime']}};\n");
  await mkdir(resolve(root, 'test'));
  await copyFile(resolve(repo, 'packages/studio-playground/embed-test.html'), resolve(root, 'embed-test.html'));
  await copyFile(resolve(repo, 'packages/studio-playground/scenes-test.html'), resolve(root, 'scenes-test.html'));
  // Bundle only fixture helpers; the studio itself is installed from its real tarball.
  await build({stdin: {contents: "export {MemoryFileSystem} from '@deepbench/browser-filesystem'; export {encodeWav} from '@deepbench/studio-audio';", resolveDir: resolve(repo, 'packages/studio-playground'), loader: 'ts'}, outfile: resolve(root, 'test/support.js'), bundle: true, format: 'esm', platform: 'browser'});
  await writeFile(resolve(root, 'test/support.d.ts'), "export const MemoryFileSystem: any; export function encodeWav(input: {numberOfChannels:number;length:number;sampleRate:number;getChannelData(channel:number):Float32Array}): Blob;\n");
  let fixture = await readFile(resolve(repo, 'packages/studio-playground/test/embed.tsx'), 'utf8');
  fixture = fixture.replaceAll("'@deepbench/studio", "'@framecraft/studio").replaceAll("'@deepbench/browser-filesystem'", "'./support.js'").replaceAll("'@framecraft/studio-audio'", "'./support.js'");
  fixture = "import wasmURL from '@framecraft/studio/esbuild.wasm?url';\n" + fixture.replace("projectId:'embedded-test',", "projectId:'embedded-test',wasmURL,").replace("{mode:'review'}", "{mode:'review',wasmURL}").replace("{mode:'export',container:'mp4'}", "{mode:'export',container:'mp4',wasmURL}");
  await writeFile(resolve(root, 'test/embed.tsx'), fixture);
  let scenes = await readFile(resolve(repo, 'packages/studio-playground/test/scenes.tsx'), 'utf8');
  scenes = scenes.replaceAll("'@deepbench/studio", "'@framecraft/studio").replaceAll("'@deepbench/browser-filesystem'", "'./support.js'");
  scenes = "import wasmURL from '@framecraft/studio/esbuild.wasm?url';\n" + scenes.replace("projectId:'scene-browser',", "projectId:'scene-browser',wasmURL,").replace("{mode:'export'}", "{mode:'export',wasmURL}");
  await writeFile(resolve(root, 'test/scenes.tsx'), scenes);
  await writeFile(resolve(root, 'tsconfig.json'), JSON.stringify({compilerOptions: {target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true, types: ['vite/client']}, include: ['test']}));
  run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
  const env = {...process.env, STUDIO_TEST_ROOT: root, STUDIO_EXPECT_REACT: '18.3.1'};
  run(process.execPath, [resolve(repo, 'scripts/embedded-studio-smoke.mjs')], {env});
  run(process.execPath, [resolve(repo, 'scripts/monaco-portable-smoke.mjs')], {env});
  run(process.execPath, [resolve(repo, 'scripts/scenes-portable-smoke.mjs')], {env});
  console.log('React 18.3.1 compatibility: clean npm install, React 18 types, review, music, video export, and Monaco passed.');
} finally {
  await rm(root, {recursive: true, force: true});
}
