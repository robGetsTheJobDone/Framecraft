import {isBase64} from './base64-validation.js';

/** Human feedback references, separate from assets used in the composition. */
export interface FeedbackAttachment {name:string; mimeType:string; data:string}
export const feedbackLimits={files:6,imageBytes:5*1024*1024,textBytes:200*1024,totalBytes:10*1024*1024};
export function validateFeedback(attachments:FeedbackAttachment[]):void {
  if(!Array.isArray(attachments)||attachments.length>feedbackLimits.files)throw new Error('Attach up to 6 feedback files.');
  let total=0;
  for(const attachment of attachments){
    if(!attachment||typeof attachment.name!=='string'||!attachment.name.trim()||attachment.name.length>255||typeof attachment.data!=='string')throw new Error('Invalid feedback attachment.');
    let size:number;
    if(['image/png','image/jpeg','image/webp','image/gif'].includes(attachment.mimeType)){
      const prefix=`data:${attachment.mimeType};base64,`;
      if(!attachment.data.startsWith(prefix)||!isBase64(attachment.data.slice(prefix.length))||attachment.data.length===prefix.length)throw new Error('Invalid feedback image.');
      size=(attachment.data.length-prefix.length)*3/4-(attachment.data.endsWith('==')?2:attachment.data.endsWith('=')?1:0);
      if(size>feedbackLimits.imageBytes)throw new Error('Feedback images must be 5 MB or smaller.');
    }else if(attachment.mimeType==='text/plain'){
      size=new TextEncoder().encode(attachment.data).length;
      if(attachment.data.includes('\0'))throw new Error('Feedback text must be a UTF-8 text file.');
      if(size>feedbackLimits.textBytes)throw new Error('Feedback text files must be 200 KB or smaller.');
    }else throw new Error('Attach PNG, JPEG, WebP, GIF or plain text files.');
    total+=size;
  }
  if(total>feedbackLimits.totalBytes)throw new Error('Feedback attachments must total 10 MB or less.');
}
export function feedbackBlocks(attachments:FeedbackAttachment[]) {
  return attachments.flatMap(attachment=>attachment.mimeType==='text/plain'
    ?[{type:'text' as const,text:`Attached human feedback file: ${attachment.name}\n<feedback-file>\n${attachment.data}\n</feedback-file>`}]
    :[{type:'text' as const,text:`Attached human feedback image: ${attachment.name}`},{type:'image_url' as const,image_url:{url:attachment.data}}]);
}
