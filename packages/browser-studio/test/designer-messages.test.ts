import {describe, it, expect} from 'vitest';
import {AIMessage, AIMessageChunk, HumanMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {MemoryFileSystem} from '@deepbench/browser-filesystem';
import {designerMessages} from '../src/designer-messages.js';
import {createAdSession} from '../src/ad-session.js';

const invalid = {id:'truncated', name:'edit_scenes', args:'{"operations":[', error:'Invalid JSON', type:'invalid_tool_call' as const};
const raw = {id:invalid.id, type:'function' as const, function:{name:invalid.name, arguments:invalid.args}};
const malformed = () => new AIMessage({content:'', tool_calls:[], invalid_tool_calls:[invalid], additional_kwargs:{tool_calls:[raw]}, response_metadata:{finish_reason:'length'}});

function assertProtocol(messages: BaseMessage[]) {
  let pending = new Set<string>();
  for (const message of messages) {
    if (message instanceof ToolMessage) {
      expect(pending.delete(message.tool_call_id)).toBe(true);
    } else {
      expect([...pending]).toEqual([]);
      if (message instanceof AIMessage) {
        expect(message.invalid_tool_calls).toEqual([]);
        const calls = message.tool_calls?.length ? message.tool_calls : message.additional_kwargs.tool_calls ?? [];
        pending = new Set(calls.map(call => call.id!));
      }
    }
  }
  expect([...pending]).toEqual([]);
}

describe('malformed designer tool calls', () => {
  it('repairs already-saved orphaned calls while preserving the original checkpoint messages', () => {
    const original = malformed();
    const messages = [original, new HumanMessage('Apply the change with a tool.')];
    const repaired = designerMessages(messages);
    assertProtocol(repaired);
    expect(repaired[1].content).toMatch(/output limit.*not executed.*smaller tool calls/);
    expect(original.invalid_tool_calls).toEqual([invalid]);
    expect(original.additional_kwargs.tool_calls).toEqual([raw]);
    expect(designerMessages(repaired)).toEqual(repaired);
  });

  it('preserves valid calls and their results in mixed streamed batches', () => {
    const valid = {id:'read', name:'inspect_project', args:{}, type:'tool_call' as const};
    const response = new AIMessageChunk({content:'Working', tool_call_chunks:[{id:'read',name:'inspect_project',args:'{}',index:0,type:'tool_call_chunk'},{id:invalid.id,name:invalid.name,args:'not JSON',index:1,type:'tool_call_chunk'}]});
    const toolResult = new ToolMessage({tool_call_id:'read',content:'Project revision'});
    const repaired = designerMessages([response,toolResult]);
    assertProtocol(repaired);
    expect((repaired[0] as AIMessage).tool_calls).toEqual([valid]);
    expect(repaired[1]).toBe(toolResult);
    expect(repaired[2].content).toContain('do not repeat successful tools');
  });

  it.each([false,true])('recovers a truncated scene edit through the real session loop (stream=%s)', async stream => {
    let calls = 0;
    const source = 'export default function Ad(){return <div>Recovered</div>}';
    const next = (messages: BaseMessage[]) => {
      assertProtocol(messages);
      if (calls++ === 0) return malformed();
      if (calls === 2) {
        expect(messages.some(message => String(message.content).includes('output limit'))).toBe(true);
        return new AIMessage({content:'',tool_calls:[{id:'write',name:'write_ad',args:{source}}]});
      }
      return new AIMessage({content:'',tool_calls:[{id:'finish',name:'finish_design',args:{}}]});
    };
    const model = {
      withStructuredOutput:()=>({invoke:async()=>({durationSeconds:null,concept:'Simple',scenes:[{id:null,componentId:null,start:0,end:8,copy:'Hi',visual:'Blue',motion:'Title',assetKeys:[]}],assets:[],nextChanges:['Layout']})}),
      bindTools:()=>stream ? {stream:async function*(messages: BaseMessage[]){yield next(messages);}} : {invoke:async(messages: BaseMessage[])=>next(messages)},
    } as unknown as BaseChatModel;
    const session = await createAdSession({projectId:'truncated',initialMode:'source',adapters:{model,storage:new MemoryFileSystem(),render:async()=>({frames:[{format:'story',timeSeconds:1,dataUrl:'data:image/png;base64,cGl4ZWxz'}]})}});
    await session.send('Make a video',{review:false});
    expect(calls).toBe(3);
    expect(await session.workspace.read('Ad.tsx')).toBe(source);
  });
});
