export interface AgentProgress {id: string; label: string; text?: string}
/** Only public text blocks are displayed. Reasoning blocks and tool arguments stay out of the UI. */
export function publicText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
}
export async function streamAgent(agent: {streamEvents: (...args: any[]) => AsyncIterable<any>}, history: unknown[], signal: AbortSignal, progress: (entry: AgentProgress) => void) {
  let answer = '';
  const text = new Map<string, string>();
  const events = agent.streamEvents({messages: history}, {version: 'v2', signal, recursionLimit: 40});
  for await (const event of events) {
    signal.throwIfAborted();
    const id = event.run_id;
    if (event.event === 'on_chat_model_start') progress({id, label: 'Preparing response…'});
    if (event.event === 'on_chat_model_stream') {
      const delta = publicText(event.data?.chunk?.content);
      if (delta) {text.set(id, (text.get(id) ?? '') + delta); progress({id, label: 'Assistant', text: text.get(id)});}
    }
    if (event.event === 'on_chat_model_end') {
      const content = publicText(event.data?.output?.content);
      if (content) {answer = content; progress({id, label: 'Assistant', text: content});}
      else progress({id, label: 'Response ready', text: text.get(id)});
    }
    if (event.event === 'on_tool_start') progress({id, label: `Running ${event.name}…`});
    if (event.event === 'on_tool_end') progress({id, label: `Finished ${event.name}`});
    if (event.event === 'on_chain_end' && Array.isArray(event.data?.output?.messages)) {
      const content = publicText(event.data.output.messages.at(-1)?.content);
      if (content) answer = content;
    }
  }
  signal.throwIfAborted();
  return answer || 'Finished.';
}
