import {describe, it, expect} from 'vitest';
import {resolveImageSource} from '../src/image-sources';

describe('image asset resolution',()=>{
 const assets={one:'data:image/jpeg;base64,b25l',two:'data:image/jpeg;base64,dHdv'};
 const metadata=[{id:'one',path:'assets/hero.jpg',name:'Hero photo'},{id:'two',path:'assets/logo.webp',name:'Logo'}];
 it('resolves exact IDs and registered relative/absolute paths without fetching',()=>{
  for(const source of ['one','assets/hero.jpg','/assets/hero.jpg','./assets/hero.jpg'])expect(resolveImageSource(source,assets,metadata)).toBe(assets.one);
  expect(resolveImageSource('assets/two',assets)).toBe(assets.two);
  expect(()=>resolveImageSource('assets/one',assets,metadata)).toThrow('Unresolved image reference');
 });
 it('suggests matching filenames/names but never silently chooses a typo or an unregistered path',()=>{
  for(const source of ['assets/herro.jpg','Hero photo'])expect(()=>resolveImageSource(source,assets,metadata)).toThrow(/Possible matches:.*assets\["one"\]/);
  for(const source of ['../assets/hero.jpg','https://example.com/assets/hero.jpg'])expect(()=>resolveImageSource(source,assets,metadata)).toThrow('Unresolved image reference');
 });
 it('rejects ambiguous paths and explains undefined lookups',()=>{
  expect(()=>resolveImageSource('/assets/hero.jpg',assets,[...metadata,{id:'two',path:'assets/hero.jpg'}])).toThrow('Ambiguous image path');
  expect(()=>resolveImageSource(undefined,assets,metadata)).toThrow(/Image src is missing.*assets\["one"\]/);
 });
 it('keeps embedded image URLs intact',()=>{
  expect(resolveImageSource(assets.one,assets,metadata)).toBe(assets.one);
  expect(resolveImageSource('blob:local-image',assets,metadata)).toBe('blob:local-image');
 });
});
