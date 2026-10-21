/** Standard padded base64, checked with constant stack space even for large checkpoints. */
export function isBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length % 4 !== 0) return false;
  let end=value.length;
  if(end&&value.charCodeAt(end-1)===61)end--;
  if(end&&value.charCodeAt(end-1)===61)end--;
  for(let i=0;i<end;i++){
    const code=value.charCodeAt(i);
    if(!((code>=65&&code<=90)||(code>=97&&code<=122)||(code>=48&&code<=57)||code===43||code===47))return false;
  }
  return true;
}
