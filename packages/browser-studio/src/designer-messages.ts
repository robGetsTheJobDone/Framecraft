import {AIMessage, HumanMessage, isAIMessage, isToolMessage, type BaseMessage} from '@langchain/core/messages';

/** Keep malformed calls in checkpoints, but never send orphaned tool calls to a provider. */
export function designerMessages(messages: BaseMessage[]): BaseMessage[] {
  const result: BaseMessage[] = [];
  let repair: string | undefined;
  for (const message of messages) {
    // Valid calls in a mixed batch must receive their results before a repair request.
    if (repair && !isToolMessage(message)) {
      result.push(new HumanMessage(repair));
      repair = undefined;
    }
    if (!isAIMessage(message) || !message.invalid_tool_calls?.length) {
      result.push(message);
      continue;
    }
    const {tool_calls: _rawCalls, ...additional_kwargs} = message.additional_kwargs;
    const names = message.invalid_tool_calls.map(call => call.name ?? 'unknown').join(', ');
    const truncated = message.response_metadata.finish_reason === 'length';
    repair = `The ${names} tool call${message.invalid_tool_calls.length === 1 ? '' : 's'} contained invalid JSON${truncated ? ' because the model output limit was reached' : ''} and were not executed. Retry those calls with complete, valid JSON. Split large scene/module edits into smaller tool calls; do not repeat successful tools. Inspect the current project revision before editing.`;
    result.push(new AIMessage({
      content: message.content || 'The attempted tool call could not be parsed.',
      tool_calls: message.tool_calls,
      additional_kwargs,
      response_metadata: message.response_metadata,
      id: message.id,
      name: message.name,
    }));
  }
  if (repair) result.push(new HumanMessage(repair));
  return result;
}
