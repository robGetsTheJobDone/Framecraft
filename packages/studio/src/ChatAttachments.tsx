import {useRef} from 'react';
import {feedbackLimits,validateFeedback,type FeedbackAttachment} from '@deepbench/browser-studio';

export async function readFeedbackFiles(files:File[],existing:FeedbackAttachment[]):Promise<FeedbackAttachment[]> {
  if(files.length+existing.length>feedbackLimits.files)throw new Error('Attach up to 6 feedback files.');
  const additions:FeedbackAttachment[]=[];
  for(const file of files){
    const image=['image/png','image/jpeg','image/webp','image/gif'].includes(file.type);
    if(!image&&!file.type.startsWith('text/')&&!/\.(txt|md|markdown|csv|json|log|yaml|yml|xml|html|css|js|jsx|ts|tsx)$/i.test(file.name))throw new Error(`${file.name}: attach an image or text file.`);
    if(file.size>(image?feedbackLimits.imageBytes:feedbackLimits.textBytes))throw new Error(`${file.name}: ${image?'images must be 5 MB':'text files must be 200 KB'} or smaller.`);
    const data=image?await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error(`Could not read ${file.name}`));reader.readAsDataURL(file);}):new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
    additions.push({name:file.name,mimeType:image?file.type:'text/plain',data});
  }
  const result=[...existing,...additions];validateFeedback(result);return result;
}

export function ChatAttachments({attachments,disabled,loading,error,onFiles,onRemove}:{attachments:FeedbackAttachment[];disabled:boolean;loading:boolean;error:string;onFiles(files:File[]):void;onRemove(index:number):void}){
  const input=useRef<HTMLInputElement>(null);
  return <section className="chat-attachments" aria-label="Feedback attachments">
    <input ref={input} type="file" multiple hidden aria-label="Attach feedback files" accept="image/png,image/jpeg,image/webp,image/gif,text/*,.txt,.md,.csv,.json,.log,.yaml,.yml,.tsx,.ts,.jsx,.js" onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';onFiles(files);}}/>
    <div className="feedback-heading"><button type="button" disabled={disabled||loading} onClick={()=>input.current?.click()}>＋ Attach feedback</button><small>Drop images or text here</small></div>
    {attachments.map((attachment,index)=><div className="feedback-file" key={`${index}:${attachment.name}`}>
      {attachment.mimeType.startsWith('image/')?<img src={attachment.data} alt={`Feedback: ${attachment.name}`}/>:<span aria-hidden="true">TXT</span>}
      <span title={attachment.name}>{attachment.name}</span><button type="button" aria-label={`Remove attachment ${attachment.name}`} disabled={disabled||loading} onClick={()=>onRemove(index)}>×</button>
    </div>)}
    {loading&&<small role="status">Reading feedback files…</small>}{error&&<p role="alert" className="feedback-error">{error}</p>}
  </section>;
}
