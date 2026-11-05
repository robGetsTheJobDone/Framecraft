export const imageAssetInstructions = `IMAGE ASSET CONTRACT: Each scene receives assets, a map from asset ID to an embedded image URL. Use <Img src={assets["actual-asset-id"]} /> or <img src={assets[assetId]} />. An asset-valued component prop stores an ID, not a URL: use assets[ownerImage], not src={ownerImage}. Pass assets explicitly to nested components that render images. Workspace paths are NOT HTTP URLs. Img/img can resolve an exact registered asset ID or virtual path to embedded bytes, but prefer assets[assetId], and use that URL for CSS backgrounds. Unknown references produce possible matches with exact paths and assets expressions; inspect the inventory and choose the intended match, never invent a path. Component assetBindings maps aliases to actual IDs; without a binding, an asset name or plan key is not an assets key. Inspect the authoritative project assets and check the lookup when src is missing. A render/decode error alone does not mean the image bytes are broken: inspect_asset and check the reference first. Preserve requested photographs and logos; do not replace them with vectors or regenerate them merely to bypass a missing src or workspace-path error.`;

/** Compact model-facing preview; the original workspace asset is never modified. */
export async function inspectionPreview(dataUrl: string): Promise<string> {
  if (dataUrl.length <= 512 * 1024) return dataUrl;
  const response = await fetch(dataUrl);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement('canvas');
    let longest = Math.min(1280, Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = longest / Math.max(bitmap.width, bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image preview canvas unavailable');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const preview = canvas.toDataURL('image/jpeg', .85);
      if (preview.length <= 512 * 1024) return preview;
      longest *= .75;
    }
    throw new Error('Unable to prepare a compact inspection preview');
  } finally {bitmap.close();}
}
