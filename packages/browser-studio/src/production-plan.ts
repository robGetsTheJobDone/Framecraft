import { z } from "zod";

// A concise production artifact, not a transcript of the model's private reasoning.
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/);
export const adProductionPlanSchema = z.object({
  concept: z.string().min(1).max(600),
  scenes: z.array(z.object({
    id: id.nullable().describe('Existing or planned scene ID; null when not assigned'), componentId: id.nullable().describe('Existing or planned component ID; null when not assigned'),
    start: z.number().min(0), end: z.number().positive(),
    copy: z.string().max(500), visual: z.string().min(1).max(600), motion: z.string().min(1).max(600),
    assetKeys: z.array(id).max(8),
  }).strict()).min(1).max(64).describe('Choose boundaries for independently editable sections. Keep coordinated animation or transitions in one continuous scene when appropriate; do not force one scene per shot or beat. A single scene is valid.'),
  assets: z.array(z.object({
    key: id, description: z.string().min(1).max(800),
    action: z.enum(["reuse", "generate"]), assetId: id.nullable(),
  }).strict()).max(12),
  nextChanges: z.array(z.string().min(1).max(600)).min(1).max(8),
}).strict();
// Old saved plans predate scene identities. Normalize only persisted data; provider output stays strict.
export const storedProductionPlanSchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || !('scenes' in value) || !Array.isArray(value.scenes)) return value;
  return {...value, scenes:value.scenes.map(scene => scene && typeof scene === 'object'
    ? {id:null, componentId:null, ...scene} : scene)};
}, adProductionPlanSchema);
export type AdProductionPlan = z.infer<typeof adProductionPlanSchema>;
export function validateProductionPlan(plan: AdProductionPlan, assets: Record<string,string>, duration: number, generated: Record<string,string>, options:{validateTiming?:boolean}={}) {
  const keys=new Set(plan.assets.map(a=>a.key));
  if (keys.size!==plan.assets.length) throw new Error("Asset keys must be unique");
  for(const asset of plan.assets) {
    if(asset.action==="reuse" && (!asset.assetId || !Object.hasOwn(assets,asset.assetId))) throw new Error(`Unknown existing asset for ${asset.key}: ${asset.assetId??'no asset ID'}. Reuse an actual image asset ID (${Object.keys(assets).join(', ')||'none available'}); code-drawn visuals are not image assets.`);
    if(asset.action==="generate" && asset.assetId && generated[asset.key]!==asset.assetId) throw new Error(`Use the generated asset ID returned for ${asset.key}`);
  }
  const ids=new Set<string>();
  for(const scene of plan.scenes) {
    if(options.validateTiming!==false&&(scene.end<=scene.start || scene.end>duration)) throw new Error(`Scene timing must fit within 0–${duration}s`);
    if(scene.id){if(ids.has(scene.id))throw new Error("Scene IDs must be unique");ids.add(scene.id);}
    if(scene.assetKeys.some(key=>!keys.has(key))) throw new Error("Scene references an unknown asset key");

  }
  // The plan describes intent, never overwrites authoritative scene arrangement. Gaps and overlaps are valid.
}
