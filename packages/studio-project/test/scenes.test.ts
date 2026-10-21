import {describe, it, expect} from 'vitest';
import {createStudioProject, validateProject, validateComposition, sceneReviewFrames, type SceneComposition} from '../src/index';
const composition = (): SceneComposition => ({version:1, components:[{id:'title',entry:'/scenes/AnyName.tsx',authoredDurationInFrames:120,inputs:{headline:{type:'text',required:true},image:{type:'asset'}}}],scenes:[{id:'one',componentId:'title',startFrame:90,durationInFrames:30,sourceStartFrame:15,layer:0,props:{headline:'Hello'}}]});
describe('structured scenes', () => {
  it('accepts reusable components and trims without changing authored duration', () => {
    const c=composition(); c.scenes.push({...c.scenes[0],id:'two',startFrame:150,props:{headline:'Different'}});
    expect(validateComposition(c,{durationInFrames:240})).toEqual([]);
    c.scenes[0].durationInFrames=10;
    expect(c.components[0].authoredDurationInFrames).toBe(120);
    expect(validateComposition(c,{durationInFrames:240})).toEqual([]);
  });
  it('rejects dangling refs, invalid inputs, fractional frames and content overflow', () => {
    const c=composition(); Object.assign(c.scenes[0], {startFrame:1.5,sourceStartFrame:115,props:{headline:42,image:'missing',extra:true}});
    const issues=validateComposition(c,{durationInFrames:240,assetIds:new Set()});
    expect(issues.map(i=>i.path)).toEqual(expect.arrayContaining(['scenes.0.startFrame','scenes.0.props.headline','scenes.0.props.image','scenes.0.props.extra']));
    expect(issues.some(i=>i.message.includes('authored'))).toBe(true);
    c.scenes[0].componentId='missing'; expect(validateComposition(c,{durationInFrames:240}).some(i=>i.path.endsWith('componentId'))).toBe(true);
  });
  it('validates defaults and schemas, rejecting unsafe entries and reserved input names', () => {
    const c=composition(); c.components[0].entry='/../outside.tsx'; c.components[0].inputs!.assets={type:'text'};
    expect(validateComposition(c,{durationInFrames:240}).map(i=>i.path)).toEqual(expect.arrayContaining(['components.0.entry','components.0.inputs.assets']));
    c.components[0].entry='/safe.tsx'; delete c.components[0].inputs!.assets; c.components[0].defaults={headline:42};
    expect(validateComposition(c,{durationInFrames:240}).some(i=>i.path==='components.0.defaults.headline')).toBe(true);
  });
  it('extends legacy project validation without requiring a composition', () => {
    const p=createStudioProject({durationSeconds:8,fps:30}); expect(validateProject(p)).toEqual([]);
    p.composition=composition(); expect(validateProject(p).some(i=>i.message.includes('schemaVersion 2'))).toBe(true);
    p.schemaVersion=2; expect(validateProject(p)).toEqual([]);
    p.durationSeconds=2; expect(validateProject(p).some(i=>i.path.startsWith('composition.scenes'))).toBe(true);
  });
  it('rejects React reserved props that cannot be exposed as ordinary controls',()=>{
    const c=composition();c.components[0].inputs!.key={type:'text'};c.components[0].inputs!.ref={type:'text'};
    expect(validateComposition(c,{durationInFrames:240}).map(i=>i.path)).toEqual(expect.arrayContaining(['components.0.inputs.key','components.0.inputs.ref']));
  });
  it('requires composition in schema version 2',()=>{
    const p=createStudioProject();p.schemaVersion=2;expect(validateProject(p).some(i=>i.message.includes('requires a scene composition'))).toBe(true);
  });
  it('samples tiny scenes and both trim boundaries deterministically', () => {
    const c=composition(); c.scenes[0].startFrame=5;c.scenes[0].durationInFrames=1;
    expect(sceneReviewFrames(c,240)).toContain(5);
    c.scenes[0].durationInFrames=4;
    expect(sceneReviewFrames(c,240)).toEqual([5,6,8,23,83,143,203]);
  });
});
