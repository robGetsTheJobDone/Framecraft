/** Downloaded code is data until bundled and executed inside the render sandbox. */
export interface PackageModule {source:string; sha256:string; imports:Record<string,string>}
export interface InstalledPackage {name:string; version:string; entry:string; imports:string[]}
export interface PackageLock {version:1; packages:InstalledPackage[]; modules:Record<string,PackageModule>}
export const packageBuiltins = ['react','react/jsx-runtime','react/jsx-dev-runtime','remotion'] as const;
export const packageLimits = {packages:32, modules:128, moduleBytes:512*1024, totalBytes:4*1024*1024};
export function validatePackageGraph(lock:PackageLock) {
  if(lock?.version!==1||!Array.isArray(lock.packages)||!lock.modules||typeof lock.modules!=='object')throw new Error('Invalid package lock');
  const files=Object.entries(lock.modules);let bytes=0;
  if(lock.packages.length>packageLimits.packages||files.length>packageLimits.modules)throw new Error('Package graph exceeds limits');
  const names=new Set<string>();
  for(const pkg of lock.packages){
    if(!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(pkg.name)||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version)||names.has(pkg.name)||!Object.hasOwn(lock.modules,pkg.entry)||!Array.isArray(pkg.imports)||pkg.imports.some(id=>typeof id!=='string'||(id!==pkg.name&&!id.startsWith(pkg.name+'/'))||id.includes('..')))throw new Error('Invalid installed package');
    names.add(pkg.name);
  }
  for(const [url,file]of files){
    if(!url.startsWith('https://esm.sh/')||typeof file.source!=='string'||!/^([a-f0-9]{64})$/.test(file.sha256)||!file.imports||typeof file.imports!=='object')throw new Error('Invalid package module');
    const size=new TextEncoder().encode(file.source).length;bytes+=size;
    if(size>packageLimits.moduleBytes||bytes>packageLimits.totalBytes)throw new Error('Package source exceeds limits');
    for(const target of Object.values(file.imports))if(!packageBuiltins.includes(target as any)&&!Object.hasOwn(lock.modules,target))throw new Error(`Missing locked dependency: ${target}`);
  }
}

export async function verifyPackageIntegrity(lock:PackageLock) {
  validatePackageGraph(lock);
  for(const file of Object.values(lock.modules)) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(file.source));
    const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==file.sha256)throw new Error('Package integrity mismatch; restore an intact project snapshot');
  }
}
