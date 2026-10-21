import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile,readdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
process.chdir(root);
const names=(await readdir('packages')).filter(n=>!n.startsWith('.')&&n!=='studio-playground');
const manifests=await Promise.all(names.map(async n=>JSON.parse(await readFile('packages/'+n+'/package.json','utf8'))));
const internal=manifests.map(m=>m.name);
const dependencies={};
for(const m of manifests)for(const [name,version]of Object.entries(m.dependencies??{}))if(!internal.includes(name)&&!['react','react-dom'].includes(name))dependencies[name]=version;
const studioManifest=manifests.find(m=>m.name==='@deepbench/studio');
const dir='packages/studio/portable';await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
await build({entryPoints:['packages/studio/src/index.tsx'],outfile:dir+'/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',external:['react','react/*','react-dom','react-dom/*'],loader:{'.ttf':'file'},define:{'process.env.NODE_ENV':'"production"'}});
// Keep Node filesystem imports isolated behind the optional /node subpath.
await build({entryPoints:['packages/studio/src/node.ts'],outfile:dir+'/node.js',bundle:true,format:'esm',platform:'node',target:'node22'});
// Preserve declaration modules and rewrite workspace references to local files.
for (let i=0;i<names.length;i++) {
 const name=names[i]; const typeDir=dir+'/types/'+name; await mkdir(typeDir,{recursive:true});
 const walk=async(sub='')=>{
  for(const entry of await readdir('packages/'+name+'/dist/'+sub,{withFileTypes:true})){
   const path=sub+entry.name;
   if(entry.isDirectory()){await mkdir(typeDir+'/'+path,{recursive:true});await walk(path+'/');}
   else if(entry.name.endsWith('.d.ts')){
    let source=await readFile('packages/'+name+'/dist/'+path,'utf8');
    source=source.replace(/(['"])@deepbench\/([^'"]+)\1/g,(_,quote,target)=>{
      const [pkg,...rest]=target.split('/');
      const depth=sub.split('/').filter(Boolean).length;
      return quote+'../'.repeat(depth+1)+pkg+'/'+(rest.length?rest.join('/'):'index')+'.js'+quote;
    });
    await writeFile(typeDir+'/'+path,source);
   }
  }
 };await walk();
}
await writeFile(dir+'/index.d.ts',"export * from './types/studio/index.js';\n");
await writeFile(dir+'/node.d.ts',"export * from './types/studio/node.js';\n");
await copyFile('packages/studio/README.md',dir+'/README.md');
await writeFile(dir+'/styles.css', (await readFile(dir+'/index.css','utf8')) + '\n' + (await readFile('packages/studio/src/styles.css','utf8')));
await copyFile('packages/studio/dist/monaco-editor.worker.js',dir+'/monaco-editor.worker.js');
await copyFile('packages/browser-ad-renderer/dist/esbuild.wasm',dir+'/esbuild.wasm');
await writeFile(dir+'/package.json',JSON.stringify({name:'@deepbench/studio',version:studioManifest.version,description:'Browser-first AI video studio with editable Remotion ads, music and portable sessions',repository:{type:'git',url:'git+https://github.com/robGetsTheJobDone/DeepBench.git',directory:'packages/studio'},publishConfig:{access:'public'},files:['*.js','*.css','*.d.ts','*.wasm','*.ttf','types','README.md'],type:'module',exports:{'.':{types:'./index.d.ts',import:'./index.js'},'./node':{types:'./node.d.ts',import:'./node.js'},'./styles.css':'./styles.css','./esbuild.wasm':'./esbuild.wasm'},sideEffects:['*.css'],peerDependencies:{react:'^19.0.0','react-dom':'^19.0.0'},dependencies},null,2));
console.log('Portable package built at '+dir);
