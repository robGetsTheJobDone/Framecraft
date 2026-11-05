import {Buffer} from 'buffer/';
import {renderFileLimits,type RenderFile} from './node-builtins.js';

const error=(code:string,syscall:string,path:unknown)=>Object.assign(new Error(`${code}: ${syscall} '${String(path)}' in the read-only project filesystem`),{code,syscall,path});
function normalize(input:unknown):string {
  if(input instanceof URL){
    if(input.protocol!=='file:'||input.hostname||/%2f|%5c/i.test(input.pathname))throw error('EINVAL','path',input);
    input=decodeURIComponent(input.pathname);
  }
  if(input instanceof Uint8Array)input=Buffer.from(input).toString('utf8');
  if(typeof input!=='string'||input.includes('\0')||input.includes('\\'))throw error('EINVAL','path',input);
  const parts:string[]=[];
  for(const part of input.split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){if(!parts.length)throw error('EACCES','path',input);parts.pop();}else parts.push(part);
  }
  return '/'+parts.join('/');
}
const parent=(path:string)=>path.slice(0,path.lastIndexOf('/'))||'/';
const notImplemented=(name:string)=>()=>{throw error('ERR_NOT_IMPLEMENTED',name,'');};
const writes=['writeFile','appendFile','mkdir','mkdtemp','rm','rmdir','unlink','rename','copyFile','cp','truncate','chmod','chown','utimes','link','symlink'];
export function createReadOnlyFileSystem(files:readonly RenderFile[]=[]){
  const entries=new Map<string,Uint8Array|null>([['/',null]]);let bytes=0;
  if(files.length>renderFileLimits.files)throw new Error('Project filesystem snapshot has too many files');
  for(const file of files){
    const path=normalize(file.path);
    if(path==='/'||path!==file.path||entries.has(path))throw new Error(`Invalid or duplicate snapshot path: ${file.path}`);
    if(typeof file.data!=='string'||file.data.length>Math.ceil(renderFileLimits.totalBytes/3)*4||file.data.length%4||/[^A-Za-z0-9+/=]/.test(file.data))throw new Error(`Invalid snapshot bytes: ${path}`);
    const data=Buffer.from(file.data,'base64');if(data.toString('base64')!==file.data)throw new Error(`Invalid snapshot bytes: ${path}`);bytes+=data.length;
    if(bytes>renderFileLimits.totalBytes)throw new Error('Project filesystem snapshot exceeds size limit');
    entries.set(path,data);
    for(let dir=parent(path);dir!=='/';dir=parent(dir)){
      if(entries.has(dir)&&entries.get(dir)!==null)throw new Error(`Snapshot file used as directory: ${dir}`);
      entries.set(dir,null);
    }
  }
  function lookup(input:unknown,syscall:string){
    const path=normalize(input);
    for(let dir=parent(path);dir!=='/';dir=parent(dir))if(entries.has(dir)&&entries.get(dir)!==null)throw error('ENOTDIR',syscall,input);
    if(!entries.has(path))throw error('ENOENT',syscall,input);
    return {path,data:entries.get(path)!};
  }
  const encoding=(options:any)=>typeof options==='string'?options:options?.encoding;
  const validateOptions=(options:any,keys:string[])=>{
    if(options&&typeof options==='object')for(const key of Object.keys(options))if(!keys.includes(key))throw error('ERR_NOT_IMPLEMENTED',`option ${key}`,'');
  };
  function readFileSync(input:unknown,options?:any){
    validateOptions(options,['encoding','flag','signal']);options?.signal?.throwIfAborted();
    if(options?.flag&&options.flag!=='r')throw error('EROFS','readFile',input);
    const {data}=lookup(input,'readFile');if(data===null)throw error('EISDIR','readFile',input);
    const result=Buffer.from(data);const enc=encoding(options);return enc?result.toString(enc):result;
  }
  const typeMethods=(directory:boolean)=>({isFile:()=>!directory,isDirectory:()=>directory,isSymbolicLink:()=>false,isBlockDevice:()=>false,isCharacterDevice:()=>false,isFIFO:()=>false,isSocket:()=>false});
  function statSync(input:unknown,options?:any):any {
    validateOptions(options,['bigint','throwIfNoEntry']);
    if(options?.bigint)throw error('ERR_NOT_IMPLEMENTED','bigint stat',input);
    let found;try{found=lookup(input,'stat');}catch(e){if(options?.throwIfNoEntry===false&&(e as any).code==='ENOENT')return undefined;throw e;}
    const {data}=found;
    return {...typeMethods(data===null),size:data?.length??0,mode:data===null?0o40555:0o100444,nlink:1,uid:0,gid:0,dev:0,ino:0,rdev:0,blksize:4096,blocks:Math.ceil((data?.length??0)/512),atimeMs:0,mtimeMs:0,ctimeMs:0,birthtimeMs:0,atime:new Date(0),mtime:new Date(0),ctime:new Date(0),birthtime:new Date(0)};
  }
  function readdirSync(input:unknown,options?:any){
    validateOptions(options,['encoding','withFileTypes','recursive']);
    if(options?.recursive)throw error('ERR_NOT_IMPLEMENTED','recursive readdir',input);
    const {path,data}=lookup(input,'readdir');if(data!==null)throw error('ENOTDIR','readdir',input);
    return [...entries.keys()].filter(p=>p!==path&&parent(p)===path).sort().map(p=>{
      const name=p.slice(p.lastIndexOf('/')+1);const enc=encoding(options);
      const encoded=enc==='buffer'?Buffer.from(name):enc?Buffer.from(name).toString(enc):name;
      return options?.withFileTypes?{name:encoded,parentPath:path,...typeMethods(entries.get(p)===null)}:encoded;
    });
  }
  const constants=Object.freeze({F_OK:0,R_OK:4,W_OK:2,X_OK:1});
  function accessSync(input:unknown,mode=0){lookup(input,'access');if(mode&2)throw error('EROFS','access',input);if(mode&1)throw error('EACCES','access',input);if(mode&~7)throw error('EINVAL','access',input);}
  function realpathSync(input:unknown,options?:any){validateOptions(options,['encoding']);const {path}=lookup(input,'realpath');const enc=encoding(options);return enc==='buffer'?Buffer.from(path):enc?Buffer.from(path).toString(enc):path;}
  const sync:Record<string,Function>={readFile:readFileSync,readdir:readdirSync,stat:statSync,lstat:statSync,access:accessSync,realpath:realpathSync};
  const promises:Record<string,any>={constants};
  const fs:Record<string,any>={constants,promises,existsSync:(input:unknown)=>{try{lookup(input,'exists');return true;}catch{return false;}}};
  for(const [name,fn]of Object.entries(sync)){
    fs[name+'Sync']=fn;promises[name]=async(...args:any[])=>fn(...args);
    fs[name]=(...args:any[])=>{
      const callback=args.pop();if(typeof callback!=='function')throw new TypeError(`${name} requires a callback`);
      queueMicrotask(()=>{let value;try{value=fn(...args);}catch(e){callback(e);return;}callback(null,value);});
    };
  }
  fs.exists=(path:unknown,callback:Function)=>{if(typeof callback!=='function')throw new TypeError('exists requires a callback');queueMicrotask(()=>callback(fs.existsSync(path)));};
  for(const name of writes){
    const fail=(path:unknown)=>{throw error('EROFS',name,path);};
    fs[name+'Sync']=fail;promises[name]=async(path:unknown)=>fail(path);
    fs[name]=(...args:any[])=>{const cb=args.at(-1);if(typeof cb!=='function')throw new TypeError(`${name} requires a callback`);queueMicrotask(()=>cb(error('EROFS',name,args[0])));};
  }
  for(const name of ['open','close','read','readv','write','writev','fstat','watch','watchFile','unwatchFile','createReadStream','createWriteStream','readlink','opendir']){
    fs[name]=notImplemented(`fs.${name}`);fs[name+'Sync']=notImplemented(`fs.${name}Sync`);promises[name]=async()=>notImplemented(`fs.promises.${name}`)();
  }
  return fs;
}
