import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {checkSourcingAuthority,frozenSourcingFiles,sourcingAuthorityTokens} from '../../../scripts/check-sourcing-authority.mjs';
const read=(path:string)=>readFileSync(resolve(path),'utf8');
describe('sourcing authority guard',()=>{
  it('accepts the complete authority and protected source',()=>{expect(()=>checkSourcingAuthority(read)).not.toThrow();});
  for(const path of Object.keys(frozenSourcingFiles))it(`refuses frozen drift: ${path}`,()=>{
    expect(()=>checkSourcingAuthority((p:string)=>read(p)+(p===path?'\nchanged':''))).toThrow('sourcing_frozen');
  });
  for(const [path,tokens] of Object.entries(sourcingAuthorityTokens))for(const token of tokens as string[])it(`refuses authority removal: ${path} / ${token}`,()=>{
    let targetReads=0;
    expect(()=>checkSourcingAuthority((p:string)=>{
      if(p!==path)return read(p);
      // Frozen drift is tested above. Supply the real bytes for that first read,
      // then remove the token so this case independently exercises authority checks.
      if(path in frozenSourcingFiles && targetReads++===0)return read(p);
      return read(p).split(token).join('REMOVED');
    })).toThrow('sourcing_authority:'+path+':'+token);
  });
});
