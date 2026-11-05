import {afterEach, beforeEach, expect, it, vi} from 'vitest';
vi.mock('esbuild-wasm',()=>({initialize:async()=>{},transform:async()=>({code:''})}));
vi.mock('../src/harness-code.js',()=>({harnessCode:'',tailwindCode:''}));
import {mountAd} from '../src/renderer-runtime';
let port: {onmessage?: (event:any)=>void; close:ReturnType<typeof vi.fn>; postMessage:ReturnType<typeof vi.fn>};
const input={source:'',assets:{},format:{id:'story',width:1080,height:1920},durationSeconds:8,fps:30};
const container={append:vi.fn()} as unknown as HTMLElement;
beforeEach(()=>{
  vi.useFakeTimers();
  vi.stubGlobal('document',{createElement:()=>({style:{},setAttribute:vi.fn(),remove:vi.fn()})});
  vi.stubGlobal('MessageChannel',class {port1=port={close:vi.fn(),postMessage:vi.fn()};port2={};});
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
it('allows a 30-second timeline review frame to take longer than 60 seconds',async()=>{
  const mounted=await mountAd(container,{...input,durationSeconds:30},{mode:'review'});
  port.onmessage!({data:{stage:'capturing frame 0'}});
  await vi.advanceTimersByTimeAsync(120000);
  expect(port.close).not.toHaveBeenCalled();
  port.onmessage!({data:{frames:[]}});
  await expect(mounted.result).resolves.toEqual({frames:[]});mounted.dispose();
});
it.each([
  {mode:'review' as const,durationSeconds:30,deadline:180000},
  {mode:'review' as const,durationSeconds:120,deadline:300000},
  {mode:'export' as const,durationSeconds:8,deadline:300000},
  {mode:'export' as const,durationSeconds:120,deadline:900000},
])('bounds stalled $mode stages for a $durationSeconds-second timeline',async({mode,durationSeconds,deadline})=>{
  const mounted=await mountAd(container,{...input,durationSeconds},{mode});
  port.onmessage!({data:{stage:'capturing frame 0'}});
  const failure=expect(mounted.result).rejects.toThrow(`after ${deadline/1000}s without completing capturing frame 0`);
  await vi.advanceTimersByTimeAsync(deadline-1);expect(port.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);await failure;
  expect(port.close).toHaveBeenCalledOnce();
});
it.each([
  {durationSeconds:8,deadline:30000},
  {durationSeconds:30,deadline:90000},
  {durationSeconds:120,deadline:300000},
])('scales and caps individual export frame captures for $durationSeconds seconds',async({durationSeconds,deadline})=>{
  const mounted=await mountAd(container,{...input,durationSeconds},{mode:'export'});
  port.onmessage!({data:{ready:true}});await mounted.result;
  const failure=expect(mounted.captureFrame(0)).rejects.toThrow(`Frame 0 capture timed out after ${deadline/1000}s (story)`);
  await vi.advanceTimersByTimeAsync(deadline-1);expect(port.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);await failure;
  expect(port.close).toHaveBeenCalledOnce();
});
it('reports cancellation as AbortError',async()=>{
  const controller=new AbortController();
  const mounted=await mountAd(container,input,{mode:'review',signal:controller.signal});
  const failure=expect(mounted.result).rejects.toMatchObject({name:'AbortError',message:'Render cancelled'});
  controller.abort();await failure;
});
