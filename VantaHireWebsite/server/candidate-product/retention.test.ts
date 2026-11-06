import {describe,it,expect,vi} from 'vitest';
import {redactSourceCopies} from './retention';
describe('source retention adapter',()=>{
 it('calls only the bounded payload compactor',async()=>{
  const query=vi.fn().mockResolvedValue({rows:[{result:{redacted:100}}]});
  expect(await redactSourceCopies({query})).toBe(100);
  expect(query).toHaveBeenCalledWith('SELECT public.flow_candidate_source_redact_due() AS result',[]);
 });
 it.each([-1,101,1.5,'1',null])('refuses invalid result %s',async redacted=>{
  await expect(redactSourceCopies({query:async()=>({rows:[{result:{redacted}}]})})).rejects.toThrow();
 });
 it('does not swallow a database refusal',async()=>{
  await expect(redactSourceCopies({query:async()=>{throw Error('unavailable');}})).rejects.toThrow('unavailable');
 });
});
