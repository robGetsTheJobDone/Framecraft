const unavailable=(name:string)=>()=>{throw Object.assign(new Error(`process.${name} is unavailable in the browser renderer`),{code:'ERR_NOT_IMPLEMENTED'});};
/** A browser environment description, never the host process or host secrets. */
export const process=Object.freeze({
  browser:true, title:'framecraft', platform:'browser', argv:Object.freeze([]),
  env:Object.freeze({NODE_ENV:'production'}), versions:Object.freeze({}), version:'',
  cwd:()=> '/',
  nextTick(callback:(...args:any[])=>void,...args:any[]){
    if(typeof callback!=='function')throw new TypeError('process.nextTick requires a callback');
    queueMicrotask(()=>callback(...args));
  },
  chdir:unavailable('chdir'),exit:unavailable('exit'),kill:unavailable('kill'),
  binding:unavailable('binding'),dlopen:unavailable('dlopen'),
  on:unavailable('on'),once:unavailable('once'),off:unavailable('off'),
});
