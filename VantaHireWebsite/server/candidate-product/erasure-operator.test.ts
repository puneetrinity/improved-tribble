import {describe,it,expect,vi} from 'vitest';
import {boundedBlobs,FILE_PHASE_BUDGET_MS,objectIdentity,planErasure,executeErasure,type OperatorDb} from '../../scripts/erase-spark-candidate';
const id='11111111-1111-4111-8111-111111111111';
function fixture(){
 const calls:string[]=[];let shared=false,verified=true,owned=true,missing=false;
 const db:OperatorDb={query:async(sql)=>{
  calls.push(sql);
  if(sql.includes('pg_get_userbyid'))return {rows:[{owned}]};
  if(sql.includes('r.actor_user_id user_id'))return {rows:verified?[{user_id:7,directive_id:id,subject_id:id,binding_id:id}]:[]};
  if(sql.includes('FROM candidate_privacy_directives d'))return {rows:[{ok:1}]};
  if(sql.includes('SELECT DISTINCT gcs_path'))return {rows:missing?[]:[{gcs_path:'gs://private-bucket/resumes/a.pdf',gcs_generation:'9007199254740993'}]};
  if(sql.startsWith('SELECT gcs_path FROM candidate_resumes'))return {rows:[{gcs_path:'gs://private-bucket/resumes/a.pdf'}]};
  if(sql.includes('SELECT resume_url value'))return {rows:shared?[{value:'https://storage.googleapis.com/private-bucket/resumes/a.pdf?signature=private'}]:[]};
  if(sql.includes('resume_jobs,'))return {rows:[{resume_jobs:1,lookups:1,interpretations:1,retained_applications:2}]};
  if(sql.includes(') drafts,'))return {rows:[{drafts:1,source_proposals:1,ai_proposals:1}]};
  return {rows:[]};
 }};
 return {db,calls,shared:()=>{shared=true;},unverified:()=>{verified=false;},runtime:()=>{owned=false;},missing:()=>{missing=true;}};
}
describe('operator-only Spark erasure',()=>{
 it('includes and locks form-upload references, preserving their object',async()=>{
  const f=fixture(),original=f.db.query;f.db.query=async(sql,args)=>{
   if(sql.includes('SELECT file_url FROM form_response_answers'))return {rows:[{value:'gs://private-bucket/resumes/a.pdf'}]};
   return original(sql,args);
  };
  const remove=vi.fn(),plan=await planErasure(f.db,f.db,id);
  expect(plan.retainSharedFiles).toBe(1);await executeErasure(f.db,f.db,{remove},id,plan.planHash);
  expect(remove).not.toHaveBeenCalled();expect(f.calls.some(q=>q.startsWith('LOCK TABLE')&&q.includes('form_response_answers'))).toBe(true);
 });
 it('awaits the in-flight deletion and refuses further work after the phase budget',async()=>{
  let time=0,release!:()=>void,settled=false;
  const remove=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
  const bounded=boundedBlobs({remove},()=>time);
  const pending=bounded.remove('gs://private-bucket/a','1').finally(()=>{settled=true;});
  const rejected=expect(pending).rejects.toThrow('file_phase_deadline');
  time=FILE_PHASE_BUDGET_MS;await Promise.resolve();expect(settled).toBe(false);
  release();await rejected;
  await expect(bounded.remove('gs://private-bucket/b','1')).rejects.toThrow('file_phase_deadline');
  expect(remove).toHaveBeenCalledTimes(1);
 });
 it('dry run contains counts, no contacts/locators and makes no write',async()=>{
  const f=fixture(),plan=await planErasure(f.db,f.db,id);
  expect(plan.deleteFiles).toBe(1);expect(plan.unresolvedFiles).toBe(0);
  expect(JSON.stringify(plan)).not.toContain('a.pdf');
  expect(f.calls.every(q=>q.startsWith('SELECT'))).toBe(true);
 });
 it('requires owner credentials and a verified quarantined request',async()=>{
  for(const mode of ['runtime','unverified'] as const){const f=fixture();f[mode]();
   await expect(planErasure(f.db,f.db,id)).rejects.toThrow();}
 });
 it('refuses an altered plan before any destructive action',async()=>{
  const f=fixture(),remove=vi.fn();const plan=await planErasure(f.db,f.db,id);f.shared();
  await expect(executeErasure(f.db,f.db,{remove},id,plan.planHash)).rejects.toThrow('plan_changed');
  expect(remove).not.toHaveBeenCalled();expect(f.calls.some(q=>q==='BEGIN')).toBe(false);
 });
 it('keeps independently referenced objects and never edits applications',async()=>{
  const f=fixture();f.shared();const remove=vi.fn();const plan=await planErasure(f.db,f.db,id);
  expect(plan.retainSharedFiles).toBe(1);await executeErasure(f.db,f.db,{remove},id,plan.planHash);
  expect(remove).not.toHaveBeenCalled();expect(f.calls.some(q=>/^(DELETE FROM|UPDATE) applications/.test(q))).toBe(false);
  expect(f.calls.findIndex(q=>q.includes('erasure_prepare'))).toBeLessThan(f.calls.findIndex(q=>q.includes('candidate_profile_erase')));
 });
 it('uses the exact generation, never a rounded number or latest object',async()=>{
  const f=fixture(),remove=vi.fn();const plan=await planErasure(f.db,f.db,id);
  await executeErasure(f.db,f.db,{remove},id,plan.planHash);
  expect(remove).toHaveBeenCalledWith('gs://private-bucket/resumes/a.pdf','9007199254740993');
 });
 it('keeps incomplete file deletion resumable and does not mark complete',async()=>{
  const f=fixture(),remove=vi.fn().mockRejectedValue(Error('cloud unavailable'));const plan=await planErasure(f.db,f.db,id);
  await expect(executeErasure(f.db,f.db,{remove},id,plan.planHash)).rejects.toThrow('cloud unavailable');
  expect(f.calls.at(-1)).toBe('ROLLBACK');expect(f.calls.some(q=>q.includes("stage='complete'"))).toBe(false);
 });
 it('refuses a library object without an immutable generation inventory',async()=>{
  const f=fixture();f.missing();const plan=await planErasure(f.db,f.db,id),remove=vi.fn();
  await expect(executeErasure(f.db,f.db,{remove},id,plan.planHash)).rejects.toThrow('file_inventory_incomplete');
  expect(remove).not.toHaveBeenCalled();
 });
 it('normalises signed reference aliases without double-decoding object names',()=>{
  expect(objectIdentity('https://private-bucket.storage.googleapis.com/resumes/a%252Fb.pdf?token=x'))
   .toBe('gs://private-bucket/resumes/a%252Fb.pdf');
  expect(objectIdentity('https://storage.googleapis.com.evil.invalid/private-bucket/a')).toBeNull();
  expect(objectIdentity('gs://private-bucket/resumes/%2e%2e/a')).toBeNull();
 });
});
