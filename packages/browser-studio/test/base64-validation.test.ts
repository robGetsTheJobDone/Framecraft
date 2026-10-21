import {it,expect} from 'vitest';
import {isBase64} from '../src/base64-validation.js';
import {validateFiles} from '../src/checkpoints.js';

it('preserves standard base64 alphabet, quartet and padding validation',()=>{
  for(const value of ['', 'AAAA', 'AA==', 'AAA=', '+/09', 'aAzZ'])expect(isBase64(value),value).toBe(true);
  for(const value of [null,undefined,123,'A','AA','AAA','A===','====','AA=A','AA==AAAA','AA\n=','AA =','AA-_','AAA===','ＡAAA'])expect(isBase64(value),String(value)).toBe(false);
});
it('validates large recovery payloads without the recursive regexp stack overflow',()=>{
  const payload='A'.repeat(14*1024*1024);
  expect(()=>validateFiles([{path:'/runs/recovered/checkpoints/state.json',data:payload}])).not.toThrow();
  expect(()=>validateFiles([{path:'/runs/recovered/checkpoints/state.json',data:payload.slice(0,-1)+'!'}])).toThrow('Invalid checkpoint file');
});
