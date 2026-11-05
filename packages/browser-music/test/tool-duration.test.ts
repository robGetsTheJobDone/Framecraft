import {it,expect,vi} from 'vitest';
vi.mock('../src/synthesis.js',()=>({synthesizeMusic:vi.fn(async()=>({blob:new Blob(['WAVE'])}))}));
import {createMusicTools} from '../src/index.js';

it('reads the current duration for both new soundtracks and revisions',async()=>{
 let durationSeconds=8;const requested:number[]=[];const added:any[]=[];
 const files=new Map<string,Uint8Array>();
 const model={withStructuredOutput:()=>({invoke:async(messages:any[])=>{
  const context=JSON.parse(messages[1].content);requested.push(context.durationSeconds);
  return {title:'Dog music',bpm:120,durationSeconds:context.durationSeconds,tracks:[{name:'Bell',instrument:'bell',gain:.2,pan:0,patch:null,notes:[]}]};
 }})};
 const [compose,revise]=createMusicTools({model:model as never,durationSeconds:async()=>durationSeconds,
  saveFile:async(path,data)=>{files.set(path,typeof data==='string'?new TextEncoder().encode(data):data);},
  readFile:async path=>files.get(path)!,addMusic:async music=>{added.push(music);},
 });
 const first=JSON.parse(await compose.invoke({brief:'Dog theme'}));
 durationSeconds=90;
 const second=JSON.parse(await revise.invoke({id:first.id,instructions:'Extend the dog theme for the episode'}));
 expect(requested).toEqual([8,90]);expect(second.durationSeconds).toBe(90);
 expect(added[1]).toMatchObject({durationSeconds:90,replacesId:first.id});
 expect(JSON.parse(new TextDecoder().decode(files.get(second.scorePath))).durationSeconds).toBe(90);
 expect(JSON.parse(new TextDecoder().decode(files.get(first.scorePath))).durationSeconds).toBe(8);
});
