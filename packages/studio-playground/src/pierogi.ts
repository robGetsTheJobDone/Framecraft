import logoURL from './assets/pierogi-logo.png?url';
import type {AdSessionOptions} from '@deepbench/browser-studio';

let logo: Promise<NonNullable<AdSessionOptions['assets']>> | undefined;
export function loadPierogiAssets() {
  return logo ??= fetch(logoURL).then(async response => {
    if (!response.ok) throw new Error('Could not load the preloaded Pierogi logo');
    return [{metadata: {id: 'pierogi-logo', name: 'Pierogi logo', kind: 'image' as const, mimeType: 'image/png', width: 1024, height: 768}, data: await response.blob()}];
  }).catch(error => {logo = undefined; throw error;});
}
export const pierogiBrand = {name: 'Pierogi', logoAssetId: 'pierogi-logo', instructions: 'Use the supplied Pierogi logo asset when requested. Preserve its proportions; do not redraw or regenerate it.'};
