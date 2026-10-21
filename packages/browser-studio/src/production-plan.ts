import { z } from "zod";

// A concise production artifact, not a transcript of the model's private reasoning.
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/);
export const adProductionPlanSchema = z.object({
  concept: z.string().min(1).max(600),
  scenes: z.array(z.object({
    start: z.number().min(0).max(15), end: z.number().min(0.01).max(15),
    copy: z.string().max(500), visual: z.string().min(1).max(600), motion: z.string().min(1).max(600),
    assetKeys: z.array(id).max(8),
  }).strict()).min(1).max(8),
  assets: z.array(z.object({
    key: id, description: z.string().min(1).max(800),
    action: z.enum(["reuse", "generate"]), assetId: id.nullable(),
  }).strict()).max(12),
  nextChanges: z.array(z.string().min(1).max(600)).min(1).max(8),
}).strict();
export type AdProductionPlan = z.infer<typeof adProductionPlanSchema>;
export function validateProductionPlan(plan: AdProductionPlan, assets: Record<string,string>, duration: number, generated: Record<string,string>) {
  const keys=new Set(plan.assets.map(a=>a.key));
  if (keys.size!==plan.assets.length) throw new Error("Asset keys must be unique");
  for(const asset of plan.assets) {
    if(asset.action==="reuse" && (!asset.assetId || !Object.hasOwn(assets,asset.assetId))) throw new Error(`Unknown existing asset for ${asset.key}`);
    if(asset.action==="generate" && asset.assetId && generated[asset.key]!==asset.assetId) throw new Error(`Use the generated asset ID returned for ${asset.key}`);
  }
  let end=0;
  for(const scene of plan.scenes) {
    if(Math.abs(scene.start-end)>0.01 || scene.end<=scene.start || scene.end>duration) throw new Error(`Scenes must cover 0–${duration}s sequentially without gaps or overlaps`);
    if(scene.assetKeys.some(key=>!keys.has(key))) throw new Error("Scene references an unknown asset key");
    end=scene.end;
  }
  if(Math.abs(end-duration)>0.01)throw new Error(`Plan must cover all ${duration}s`);
}
