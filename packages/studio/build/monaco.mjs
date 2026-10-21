import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
await build({entryPoints: [root + '/src/monaco-editor.worker.ts'], outfile: root + '/dist/monaco-editor.worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true});
await copyFile(root + '/src/monaco.css', root + '/dist/monaco.css');
