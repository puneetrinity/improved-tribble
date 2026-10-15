import {describe,expect,it} from 'vitest';
import {mergeAutofill,mergeAutofillList} from '../../client/src/lib/job-autofill';

describe('posting-wizard autofill',()=>{
 const empty={title:'',location:'',type:'full-time',salaryMin:''};
 it('fills empty fields and records what it wrote',()=>{
  const r=mergeAutofill(empty,{title:'Senior Backend Engineer',location:'Bengaluru',type:'contract',salaryMin:''},{},{type:'full-time'});
  expect(r.values).toEqual({title:'Senior Backend Engineer',location:'Bengaluru',type:'contract',salaryMin:''});
  expect(r.written).toEqual({title:'Senior Backend Engineer',location:'Bengaluru',type:'contract'});
 });
 it('never replaces a value the recruiter typed',()=>{
  const r=mergeAutofill({...empty,title:'Platform Engineer'},{title:'Senior Backend Engineer'},{});
  expect(r.values.title).toBe('Platform Engineer');expect(r.written).toEqual({});
 });
 it('refreshes a field only while it still holds the earlier autofill',()=>{
  const first={title:'Senior Backend Engineer'};
  expect(mergeAutofill({...empty,title:'Senior Backend Engineer'},{title:'Staff Engineer'},first).values.title).toBe('Staff Engineer');
  expect(mergeAutofill({...empty,title:'Lead Engineer'},{title:'Staff Engineer'},first).values.title).toBe('Lead Engineer');
 });
 it('treats a changed default as recruiter input',()=>{
  expect(mergeAutofill({...empty,type:'part-time'},{type:'contract'},{},{type:'full-time'}).values.type).toBe('part-time');
 });
 it('fills a skills list only when empty or untouched since the last autofill',()=>{
  expect(mergeAutofillList([],['Python'],undefined)).toEqual(['Python']);
  expect(mergeAutofillList(['Go'],['Python'],undefined)).toEqual(['Go']);
  expect(mergeAutofillList(['Python'],['Python','Redis'],['Python'])).toEqual(['Python','Redis']);
  expect(mergeAutofillList(['Python','Go'],['Redis'],['Python'])).toEqual(['Python','Go']);
 });
});
