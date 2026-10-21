/** Structured scene data is independent of module filenames and component code. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};
export interface ComponentInput {type: 'text' | 'number' | 'boolean' | 'color' | 'enum' | 'asset'; label?: string; required?: boolean; options?: string[]; min?: number; max?: number}
export interface SceneComponent {id: string; entry: string; authoredDurationInFrames: number; assetBindings?: Record<string, string>; inputs?: Record<string, ComponentInput>; defaults?: Record<string, JsonValue>}
export interface SceneInstance {id: string; name?: string; componentId: string; startFrame: number; durationInFrames: number; sourceStartFrame: number; layer: number; props: Record<string, JsonValue>}
export interface SceneComposition {version: 1; components: SceneComponent[]; scenes: SceneInstance[]}
export interface SceneValidationIssue {path: string; message: string}
const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v);
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;
export const isModulePath = (v: unknown): v is string => typeof v === 'string' && /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:tsx?|jsx?)$/.test(v) && !v.split('/').some(p => p === '.' || p === '..');
const json = (v: unknown, depth = 0): boolean => depth < 32 && (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (Array.isArray(v) ? v.every(x => json(x, depth + 1)) : object(v) && Object.entries(v).every(([k, x]) => !['__proto__','constructor','prototype'].includes(k) && json(x, depth + 1))));
export function validateComponentProps(component: SceneComponent, props: unknown, assetIds?: ReadonlySet<string>, requireInputs = true): SceneValidationIssue[] {
  const issues: SceneValidationIssue[] = [];
  if (!object(props) || !json(props)) return [{path: 'props', message: 'Expected finite JSON object'}];
  const inputs = component.inputs ?? {};
  for (const key of Object.keys(props)) if (!Object.hasOwn(inputs, key)) issues.push({path: `props.${key}`, message: 'Undeclared component input'});
  for (const [key, input] of Object.entries(inputs)) {
    const value = props[key];
    if (value === undefined) {if (requireInputs && input.required) issues.push({path: `props.${key}`, message: 'Required component input'}); continue;}
    let valid = false;
    if (input.type === 'number') valid = typeof value === 'number' && Number.isFinite(value) && (input.min === undefined || value >= input.min) && (input.max === undefined || value <= input.max);
    else if (input.type === 'boolean') valid = typeof value === 'boolean';
    else if (input.type === 'enum') valid = typeof value === 'string' && !!input.options?.includes(value);
    else if (input.type === 'asset') valid = typeof value === 'string' && id(value) && (!assetIds || assetIds.has(value));
    else if (input.type === 'color') valid = typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
    else if (input.type === 'text') valid = typeof value === 'string';
    if (!valid) issues.push({path: `props.${key}`, message: `Invalid ${input.type} input`});
  }
  return issues;
}
export function validateComposition(value: unknown, options: {durationInFrames: number; assetIds?: ReadonlySet<string>}): SceneValidationIssue[] {
  const issues: SceneValidationIssue[] = []; const fail = (path: string, message: string) => issues.push({path, message});
  if (!object(value) || value.version !== 1 || !Array.isArray(value.components) || !Array.isArray(value.scenes)) return [{path: '', message: 'Expected scene composition version 1'}];
  if (value.components.length > 256 || value.scenes.length > 1000) fail('', 'Scene composition exceeds resource limits');
  const components = new Map<string, SceneComponent>();
  value.components.forEach((c: unknown, i: number) => {
    const p = `components.${i}`; if (!object(c)) {fail(p, 'Expected component'); return;}
    if (!id(c.id) || components.has(c.id)) fail(`${p}.id`, 'Invalid or duplicate component ID');
    if (!isModulePath(c.entry)) fail(`${p}.entry`, 'Expected safe absolute module path');
    if (!integer(c.authoredDurationInFrames, 1)) fail(`${p}.authoredDurationInFrames`, 'Expected positive integer frames');
    if (c.assetBindings !== undefined) {
      if (!object(c.assetBindings)) fail(`${p}.assetBindings`, 'Expected asset bindings');
      else for (const [alias, target] of Object.entries(c.assetBindings)) if (!id(alias) || ['__proto__','constructor','prototype'].includes(alias) || !id(target) || (options.assetIds && !options.assetIds.has(target))) fail(`${p}.assetBindings.${alias}`, 'Invalid or missing bound asset');
    }
    let validInputs = true;
    if (c.inputs !== undefined && !object(c.inputs)) {fail(`${p}.inputs`, 'Expected input definitions'); validInputs = false;}
    else for (const [key, input] of Object.entries(c.inputs ?? {})) {
      const v = input as any;
      if (!id(key) || ['assets','format','width','height','durationInFrames','sceneId','key','ref','__proto__','constructor','prototype'].includes(key) || !object(v) || !['text','number','boolean','color','enum','asset'].includes(v.type) || (v.label !== undefined && typeof v.label !== 'string') || (v.required !== undefined && typeof v.required !== 'boolean') || (v.min !== undefined && (typeof v.min !== 'number' || !Number.isFinite(v.min))) || (v.max !== undefined && (typeof v.max !== 'number' || !Number.isFinite(v.max))) || (v.min !== undefined && v.max !== undefined && v.min > v.max) || (v.type === 'enum' && (!Array.isArray(v.options) || !v.options.length || v.options.some((x: unknown) => typeof x !== 'string')))) {fail(`${p}.inputs.${key}`, 'Invalid input definition'); validInputs = false;}
    }
    if (validInputs) {
      const component = c as unknown as SceneComponent;
      for (const issue of validateComponentProps(component, c.defaults ?? {}, options.assetIds, false)) fail(`${p}.defaults${issue.path.slice(5)}`, issue.message);
      components.set(c.id, component);
    }
  });
  const ids = new Set<string>();
  value.scenes.forEach((s: unknown, i: number) => {
    const p = `scenes.${i}`; if (!object(s)) {fail(p, 'Expected scene'); return;}
    if (!id(s.id) || ids.has(s.id)) fail(`${p}.id`, 'Invalid or duplicate scene ID'); ids.add(s.id);
    if (s.name !== undefined && typeof s.name !== 'string') fail(`${p}.name`, 'Expected scene name');
    for (const key of ['startFrame','sourceStartFrame']) if (!integer(s[key])) fail(`${p}.${key}`, 'Expected nonnegative integer frames');
    if (!integer(s.durationInFrames, 1)) fail(`${p}.durationInFrames`, 'Expected positive integer frames');
    if (!Number.isSafeInteger(s.layer)) fail(`${p}.layer`, 'Expected integer layer');
    if (s.startFrame + s.durationInFrames > options.durationInFrames) fail(p, 'Scene extends beyond project duration');
    const component = components.get(s.componentId);
    if (!component) {fail(`${p}.componentId`, 'Missing component'); return;}
    if (s.sourceStartFrame + s.durationInFrames > component.authoredDurationInFrames) fail(p, 'Scene extends beyond authored content');
    if (!object(s.props) || !json(s.props)) fail(`${p}.props`, 'Expected finite JSON object');
    else for (const issue of validateComponentProps(component, {...component.defaults, ...s.props}, options.assetIds)) fail(`${p}.${issue.path}`, issue.message);
  });
  return issues;
}
/** Include every scene, including scenes shorter than the normal review interval. */
export function sceneReviewFrames(composition: SceneComposition, totalFrames: number): number[] {
  const frames = new Set([.1,.35,.6,.85].map(f => Math.floor((totalFrames - 1) * f)));
  for (const scene of composition.scenes) for (const offset of [0, Math.floor((scene.durationInFrames - 1) / 2), scene.durationInFrames - 1]) frames.add(scene.startFrame + offset);
  return [...frames].filter(f => f >= 0 && f < totalFrames).sort((a,b) => a-b);
}
