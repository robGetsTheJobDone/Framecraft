/** Node-only entry point. Never re-export this module from the browser entry point. */
import {readdir, readFile, realpath, stat} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {contextLimits, isExcludedContextPath, contextRelativePath} from './context-files.js';
export interface LoadContextFilesOptions {
  root: string;
  /** Glob syntax: *, **, ?, and brace alternatives, e.g. **\/*.{ts,tsx,css}. */
  include?: string[];
  exclude?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}
function expand(pattern: string): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  return match ? match[1].split(',').flatMap(value => expand(pattern.slice(0,match.index)+value+pattern.slice(match.index+match[0].length))) : [pattern];
}
function matcher(patterns: string[]): (path:string)=>boolean {
  const regexes = patterns.flatMap(expand).map(pattern => {
    let expression = '^';
    for (let i=0;i<pattern.length;i++) {
      const c=pattern[i];
      if (c==='*' && pattern[i+1]==='*') {i++; if(pattern[i+1]==='/'){i++;expression+='(?:.*/)?';} else expression+='.*';}
      else if(c==='*') expression+='[^/]*';
      else if(c==='?') expression+='[^/]';
      else expression+=c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    }
    return new RegExp(expression+'$');
  });
  return path => regexes.some(regex=>regex.test(path));
}
export async function loadContextFiles(options: LoadContextFilesOptions): Promise<Record<string,string>> {
  const limits = {maxFiles:options.maxFiles??contextLimits.maxFiles,maxFileBytes:options.maxFileBytes??contextLimits.maxFileBytes,maxTotalBytes:options.maxTotalBytes??contextLimits.maxTotalBytes};
  for(const [key,value] of Object.entries(limits)) if(!Number.isSafeInteger(value)||value<1||value>contextLimits[key as keyof typeof contextLimits]) throw new Error(`Invalid context limit: ${key}`);
  const root = await realpath(resolve(options.root));
  const includes=matcher(options.include??['**/*.{ts,tsx,js,jsx,mjs,cjs,css,scss,md,mdx,json,html,txt,svg}']);
  const excludes=matcher(options.exclude??[]);
  const files:Record<string,string>=Object.create(null);
  let bytes=0;
  const walk=async(relative=''):Promise<void>=>{
    for(const entry of (await readdir(join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path=contextRelativePath(relative?`${relative}/${entry.name}`:entry.name);
      if(entry.isSymbolicLink()||isExcludedContextPath(path)||excludes(path)) continue;
      if(entry.isDirectory()) {if(!excludes(`${path}/`)) await walk(path);continue;}
      if(!entry.isFile()||!includes(path)) continue;
      const absolute=join(root,path), info=await stat(absolute);
      if(info.size>limits.maxFileBytes) throw new Error(`Context file exceeds maxFileBytes: ${path}`);
      const data=await readFile(absolute);
      if(data.byteLength>limits.maxFileBytes) throw new Error(`Context file exceeds maxFileBytes: ${path}`);
      let content:string;
      try {content=new TextDecoder('utf-8',{fatal:true}).decode(data);} catch {throw new Error(`Context file is not UTF-8 text: ${path}`);}
      if(content.includes('\0')) throw new Error(`Context file is binary: ${path}`);
      bytes+=data.byteLength;
      if(bytes>limits.maxTotalBytes) throw new Error('Context exceeds maxTotalBytes');
      files[path]=content;
      if(Object.keys(files).length>limits.maxFiles) throw new Error('Context exceeds maxFiles');
    }
  };
  await walk();
  return files;
}
