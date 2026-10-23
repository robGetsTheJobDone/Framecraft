import {afterEach, beforeEach, expect, it, vi} from 'vitest';
vi.mock('esbuild-wasm',()=>({initialize:async()=>{},transform:async()=>({code:''})}));
vi.mock('../src/harness-code.js',()=>({harnessCode:'',tailwindCode:''}));
import {mountAd} from '../src/renderer-runtime';
let port: {onmessage?: (event:any)=>void; close:ReturnType<typeof vi.fn>};
const input={source:'',assets:{},format:{id:'story',width:1080,height:1920},durationSeconds:8,fps:30};
const container={append:vi.fn()} as unknown as HTMLElement;
beforeEach(()=>{
  vi.useFakeTimers();
  vi.stubGlobal('document',{createElement:()=>({style:{},setAttribute:vi.fn(),remove:vi.fn()})});
  vi.stubGlobal('MessageChannel',class {port1=port={close:vi.fn()};port2={};});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('reports startup timeout with format instead of generic disposal',async()=>{
  const mounted=await mountAd(container,input,{mode:'review'});
  const failure=expect(mounted.result).rejects.toThrow('starting renderer (story, 1080×1920)');
  await vi.advanceTimersByTimeAsync(60000);await failure;
  expect(port.close).toHaveBeenCalledOnce();
});
it('allows a multi-frame review to exceed 60 seconds while making progress',async()=>{
  const mounted=await mountAd(container,input,{mode:'review'});
  await vi.advanceTimersByTimeAsync(45000);
  port.onmessage!({data:{stage:'capturing frame 120'}});
  await vi.advanceTimersByTimeAsync(45000);
  port.onmessage!({data:{frames:[]}});
  await expect(mounted.result).resolves.toEqual({frames:[]});mounted.dispose();
});
it('identifies a stalled review frame',async()=>{
  const mounted=await mountAd(container,input,{mode:'review'});
  port.onmessage!({data:{stage:'capturing frame 120'}});
  const failure=expect(mounted.result).rejects.toThrow('completing capturing frame 120');
  await vi.advanceTimersByTimeAsync(60000);await failure;
});
it('reports cancellation as AbortError',async()=>{
  const controller=new AbortController();
  const mounted=await mountAd(container,input,{mode:'review',signal:controller.signal});
  const failure=expect(mounted.result).rejects.toMatchObject({name:'AbortError',message:'Render cancelled'});
  controller.abort();await failure;
});
