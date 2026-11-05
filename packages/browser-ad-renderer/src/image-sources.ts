const repair = 'Use the supplied assets map: <Img src={assets[assetId]} />. Asset-valued props contain IDs, so resolve them through assets too. Pass assets to nested components. Keep the requested images; fix the reference before replacing or regenerating them.';
export interface ImageAssetFile {id: string; path: string; name?: string}
const virtualPath = (path: string) => '/' + path.replace(/^\.\//, '').replace(/^\//, '');
function distance(a: string, b: string) {
  let previous = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = next;
  }
  return previous[b.length];
}
function suggestions(source: string, files: ImageAssetFile[]) {
  const query = source.replace(/^\.?\/?assets\//, '').toLowerCase().slice(0, 160);
  const matches = files.slice(0, 200).map(file => ({file, score: Math.min(...[file.id, file.name, file.path, file.path.split('/').at(-1)].filter(Boolean).map(value => distance(query, value!.toLowerCase().slice(0, 160))))}))
    .filter(({score}) => score <= Math.max(2, Math.floor(query.length / 4))).sort((a, b) => a.score - b.score).slice(0, 3);
  const selected = matches.length ? matches.map(({file}) => file) : files.slice(0, 3);
  return selected.length ? ` ${matches.length ? 'Possible matches' : 'Available image assets'}: ${selected.map(file => `${JSON.stringify((file.name || file.id).slice(0, 100))} at ${JSON.stringify(virtualPath(file.path))} → assets[${JSON.stringify(file.id)}]`).join('; ')}. Call inspect_project for the full inventory.` : ' No image assets are registered; import or generate the requested image first.';
}

/** Resolve only exact registered references. Suggestions never select an image. */
export function resolveImageSource(source: unknown, assets: Record<string, string>, metadata?: ImageAssetFile[]): string {
  const files = (metadata ?? Object.keys(assets).map(id => ({id, path: `assets/${id}`}))).filter(file => Object.hasOwn(assets, file.id));
  if (typeof source !== 'string' || !source.trim()) throw new Error(`Image src is missing or empty.${suggestions('', files)} ${repair}`);
  if (/^(data:|blob:)/i.test(source)) return source;
  if (Object.hasOwn(assets, source)) return assets[source];
  const matches = files.filter(file => virtualPath(file.path) === virtualPath(source));
  if (matches.length === 1) return assets[matches[0].id];
  if (matches.length > 1) throw new Error(`Ambiguous image path ${JSON.stringify(source.slice(0, 160))}.${suggestions(source, matches)} Use an explicit asset ID; no image was selected.`);
  const label = source.split(/[?#]/, 1)[0].slice(0, 160);
  throw new Error(`Unresolved image reference ${JSON.stringify(label)}. Only registered image asset IDs/paths and embedded URLs are supported.${suggestions(source, files)} ${repair}`);
}

export function imageDecodeError(source: string, assets: Record<string, string>, cause: unknown) {
  const id = Object.keys(assets).find(id => assets[id] === source);
  const label = id ? `asset ${JSON.stringify(id)}` : 'embedded image';
  return new Error(`Cannot decode ${label}. The src is embedded; inspect this asset's actual bytes and MIME type before changing the design. ${cause instanceof Error ? cause.message : String(cause)}`);
}
