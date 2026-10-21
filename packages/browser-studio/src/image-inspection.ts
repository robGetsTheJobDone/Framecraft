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
