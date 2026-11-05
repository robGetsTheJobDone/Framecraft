/** Canonical names keep package locks independent of CDN-specific Node URLs. */
export const nodeBuiltinNames = ['buffer','events','path','path/posix','util','assert','assert/strict','process','fs','fs/promises'] as const;
export const nodeBuiltinImports = nodeBuiltinNames.flatMap(name=>[name,`node:${name}`]);
export function resolveNodeBuiltin(specifier:string):string|undefined {
  let name=specifier;
  if(name.startsWith('https://esm.sh/'))name=name.slice('https://esm.sh'.length);
  if(name.startsWith('/node/')&&name.endsWith('.mjs'))name=name.slice(6,-4);
  if(name.startsWith('node:'))name=name.slice(5);
  return (nodeBuiltinNames as readonly string[]).includes(name)?`node:${name}`:undefined;
}
export interface RenderFile {path:string; /** Base64 bytes, never a host filesystem path. */ data:string}
export const renderFileLimits={files:2048,totalBytes:64*1024*1024};
export function needsNodeFilesystem(source:string):boolean {
  return /["'](?:node:|\/node\/|https:\/\/esm\.sh\/node\/)?fs(?:\/promises)?(?:\.mjs)?["']/.test(source);
}
export function needsNodeCompatibility(code:string):boolean {
  return /\b(?:Buffer|process)\b/.test(code)||nodeBuiltinImports.some(name=>code.includes(JSON.stringify(name))||code.includes(`'${name}'`));
}
