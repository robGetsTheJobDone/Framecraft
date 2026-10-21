import type {BuildOptions} from 'esbuild-wasm';
import {isModulePath, type SceneComposition} from '@deepbench/studio-project';
export const moduleLimits = {files: 256, fileCharacters: 120000, totalCharacters: 2000000};
/** Includes all sources, so changes to any transitive helper invalidate the cache. */
export function sceneCompilationKey(modules: Record<string, string>, composition: SceneComposition): string {
  return JSON.stringify([Object.entries(modules).sort(([a],[b]) => a.localeCompare(b)), composition.components.map(c => [c.id,c.entry])]);
}
export function createSceneBuildOptions(modules: Record<string, string>, composition: SceneComposition): BuildOptions {
  const entries = Object.entries(modules); let total = 0;
  if (entries.length > moduleLimits.files) throw new Error('Too many source modules');
  for (const [path, source] of entries) {
    if (!isModulePath(path) || typeof source !== 'string') throw new Error(`Invalid source module: ${path}`);
    if (source.length > moduleLimits.fileCharacters) throw new Error(`Source module exceeds size limit: ${path}`);
    total += source.length;
  }
  if (total > moduleLimits.totalCharacters) throw new Error('Source module graph exceeds size limit');
  const entry = composition.components.map((c,i) => `import Component${i} from ${JSON.stringify(c.entry)};`).join('\n') + '\nexport default {' + composition.components.map((c,i) => `${JSON.stringify(c.id)}:Component${i}`).join(',') + '};';
  const resolve = (path: string, importer: string) => {
    if (!path.startsWith('/') && !path.startsWith('./') && !path.startsWith('../')) throw new Error(`Unsupported import: ${path}`);
    const segments = path.startsWith('/') ? [] : importer.split('/').slice(1,-1);
    for (const part of path.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {if (!segments.length) throw new Error(`Import escapes project: ${path}`); segments.pop();} else segments.push(part);
    }
    const normalized = '/' + segments.join('/');
    const candidates = [normalized, ...['.tsx','.ts','.jsx','.js','/index.tsx','/index.ts','/index.jsx','/index.js'].map(ext => normalized + ext)];
    if (normalized.endsWith('.js')) candidates.push(normalized.slice(0,-3)+'.ts', normalized.slice(0,-3)+'.tsx');
    const found = candidates.find(candidate => Object.hasOwn(modules, candidate));
    if (!found) throw new Error(`Missing module ${path} imported by ${importer}`);
    return found;
  };
  return {stdin: {contents: entry, sourcefile: '__scene_entry.ts', loader: 'ts', resolveDir: '/'}, bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'transform', logLevel: 'silent', plugins: [{name: 'project-modules', setup(build) {
    build.onResolve({filter: /.*/}, args => {
      if (args.kind === 'dynamic-import') return {errors: [{text: 'Dynamic imports are unsupported in scene modules'}]};
      if (args.path === 'react' || args.path === 'remotion') return {path: args.path, external: true};
      try {return {path: resolve(args.path, args.importer || '/__scene_entry.ts'), namespace: 'project'};} catch (error) {return {errors: [{text: String(error)}]};}
    });
    build.onLoad({filter: /.*/, namespace: 'project'}, args => ({contents: modules[args.path], loader: args.path.endsWith('tsx') ? 'tsx' : args.path.endsWith('jsx') ? 'jsx' : args.path.endsWith('ts') ? 'ts' : 'js'}));
  }}]};
}
