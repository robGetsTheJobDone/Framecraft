import {describe,it,expect} from 'vitest';
import {build} from 'esbuild';
import {createSceneBuildOptions,sceneCompilationKey} from '../src/module-graph';
import type {SceneComposition} from '@deepbench/studio-project';
const composition: SceneComposition={version:1,components:[{id:'hello',entry:'/scenes/Hello.tsx',authoredDurationInFrames:60}],scenes:[]};
const modules={'/scenes/Hello.tsx':`import React from 'react'; import {color} from '../shared/colors'; export default function Hello(){return <div style={{color}}/>}`, '/shared/colors.ts':`export const color='red'`};
describe('virtual scene module graph',()=>{
  it('bundles only local modules and approved externals',async()=>{
    const result=await build(createSceneBuildOptions(modules,composition));
    expect(result.outputFiles![0].text).toContain('red');
    expect(result.outputFiles![0].text).not.toContain('require("../shared/colors")');
  });
  it('resolves TypeScript modules referenced with emitted .js extensions',async()=>{
    const result=await build(createSceneBuildOptions({...modules,'/scenes/Hello.tsx':modules['/scenes/Hello.tsx'].replace('../shared/colors','../shared/colors.js')},composition));
    expect(result.outputFiles![0].text).toContain('red');
  });
  it('rejects missing, escaping, package, and dynamic imports',async()=>{
    for(const source of [`import '../missing';`,`import '../../../outside';`,`import 'node:fs';`,`import('react');`]) await expect(build(createSceneBuildOptions({...modules,'/scenes/Hello.tsx':source+' export default ()=>null'},composition))).rejects.toThrow();
  });
  it('invalidates caches for shared helper changes, not timing or props changes',()=>{
    const key=sceneCompilationKey(modules,composition);
    expect(sceneCompilationKey({...modules,'/shared/colors.ts':`export const color='blue'`},composition)).not.toBe(key);
    expect(sceneCompilationKey(modules,{...composition,scenes:[{id:'new',componentId:'hello',startFrame:0,durationInFrames:30,sourceStartFrame:0,layer:0,props:{}}]})).toBe(key);
  });
  it('rejects oversized and malformed source paths',()=>{
    expect(()=>createSceneBuildOptions({...modules,'/../bad.ts':'x'},composition)).toThrow();
    expect(()=>createSceneBuildOptions({...modules,'/large.ts':'x'.repeat(120001)},composition)).toThrow();
  });
});


describe('locked package resolver',()=>{
 const url='https://esm.sh/demo@1.0.0/es2022/demo.mjs';
 const lock={version:1 as const,packages:[{name:'demo',version:'1.0.0',entry:url,imports:['demo']}],modules:{[url]:{source:"export const color='green'",sha256:'a'.repeat(64),imports:{}}}};
 it('bundles saved package code without a network resolver and invalidates changed locks',async()=>{
  const scene={'/scenes/Hello.tsx':"import {color} from 'demo'; export default ()=>color"};
  const output=await build(createSceneBuildOptions(scene,composition,lock));expect(output.outputFiles![0].text).toContain('green');
  expect(sceneCompilationKey(scene,composition,lock)).not.toBe(sceneCompilationKey(scene,composition));
 });
 it('rejects unlocked dependencies and dynamic imports even in saved package code',async()=>{
  for(const source of ["import 'other'; export const color='x';","export const color=import('react');"]){
   const next=structuredClone(lock);next.modules[url].source=source;
   await expect(build(createSceneBuildOptions({'/scenes/Hello.tsx':"import {color} from 'demo';export default ()=>color"},composition,next))).rejects.toThrow();
  }
 });
});
