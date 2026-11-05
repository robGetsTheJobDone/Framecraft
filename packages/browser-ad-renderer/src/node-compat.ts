import * as buffer from 'buffer/';
import events from 'events/';
import path from 'path-browserify';
import util from 'util/';
import assert from 'assert/';
import {process} from './node-process.js';
import {createReadOnlyFileSystem} from './node-filesystem.js';
import {resolveNodeBuiltin,type RenderFile} from './node-builtins.js';

export function createNodeCompatibility(files:readonly RenderFile[]=[]){
  const fs=createReadOnlyFileSystem(files);
  // path-browserify implements POSIX paths. Do not silently emulate Windows paths.
  const paths={...path};paths.resolve=(...parts:string[])=>path.resolve('/',...parts);paths.relative=(from:string,to:string)=>path.relative(paths.resolve(from),paths.resolve(to));paths.posix=paths;
  const modules:Record<string,any>={'node:buffer':buffer,'node:events':events,'node:path':paths,'node:path/posix':paths,'node:util':util,'node:assert':assert,'node:assert/strict':assert.strict,'node:process':process,'node:fs':fs,'node:fs/promises':fs.promises};
  return {Buffer:buffer.Buffer,process,require(id:string){
    const name=resolveNodeBuiltin(id);if(name)return modules[name];
    throw new Error(`Unsupported Node module: ${id}. Available: buffer, events, path (POSIX), util, assert, process, and read-only fs.`);
  }};
}
