const identity='((?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*)@(\\d+\\.\\d+\\.\\d+(?:-[A-Za-z0-9.-]+)?)';
/** Only pinned npm code on the two supported transports. No arbitrary URL fetch. */
export function packageURLIdentity(input:string){
  const url=new URL(input);
  if(url.username||url.password||url.hash||/%|\\/.test(url.pathname))throw new Error('Unsupported package URL');
  const raw=url.origin==='https://cdn.jsdelivr.net';
  if(!raw&&url.origin!=='https://esm.sh')throw new Error('Unsupported package URL');
  const match=url.pathname.match(new RegExp('^'+(raw?'/npm/':'/')+identity+(raw?'/(.+\\.[cm]?js)$':'(?:/|$)')));
  if(!match||raw&&url.search)throw new Error(`Dependency is not an exact browser package: ${url.pathname}`);
  if(/\.(css|wasm|json)$/.test(url.pathname))throw new Error('Non-JavaScript package assets are unsupported');
  return {url:url.href,name:match[1],version:match[2],source:raw?'jsdelivr' as const:'esm.sh' as const};
}
