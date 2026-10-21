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
const dir='packages/studio/portable';await mkdir(dir,{recursive:true});
// Keep the output directory inode intact for terminals opened here.
for (const entry of await readdir(dir)) await rm(resolve(dir,entry),{recursive:true,force:true});
const browserBuild=await build({entryPoints:{index:'packages/studio/src/index.tsx'},outdir:dir,chunkNames:'[name]-[hash]',splitting:true,minify:true,keepNames:true,metafile:true,legalComments:'linked',bundle:true,format:'esm',platform:'browser',target:'es2022',external:['react','react/*','react-dom','react-dom/*'],loader:{'.ttf':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await writeFile('packages/studio/dist/portable-meta.json',JSON.stringify(browserBuild.metafile));
// Keep Node filesystem imports isolated behind the optional /node subpath.
await build({entryPoints:['packages/studio/src/node.ts'],outfile:dir+'/node.js',bundle:true,format:'esm',platform:'node',target:'node22',minify:true,legalComments:'inline'});
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
await writeFile(dir+'/package.json',JSON.stringify({name:'@framecraft/studio',version:studioManifest.version,description:'Browser-first AI video studio with editable Remotion ads, music and portable sessions',repository:{type:'git',url:'git+https://github.com/robGetsTheJobDone/DeepBench.git',directory:'packages/studio'},homepage:'https://github.com/robGetsTheJobDone/DeepBench#readme',bugs:{url:'https://github.com/robGetsTheJobDone/DeepBench/issues'},publishConfig:{access:'public'},files:['*.js','*.css','*.d.ts','*.wasm','*.ttf','*.txt','types','README.md'],type:'module',exports:{'.':{types:'./index.d.ts',import:'./index.js'},'./node':{types:'./node.d.ts',import:'./node.js'},'./styles.css':'./styles.css','./esbuild.wasm':'./esbuild.wasm'},sideEffects:['*.css'],peerDependencies:studioManifest.peerDependencies,dependencies},null,2));
console.log('Portable package built at '+dir);
