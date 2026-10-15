import {describe,expect,it} from 'vitest';
import {initialCriteria,notIncluded,selectionFor} from '../../client/src/components/brief-review-workspace';
import {skillCriterion} from '../../client/src/components/hiring-criteria-step';

const H='a'.repeat(64);
const py=skillCriterion('Python','must_have'),go=skillCriterion('Go','preferred'),k8s=skillCriterion('Kubernetes','must_have');
const item=(id:string,c:any,reason:any=null,span:any={start:0,end:5})=>({id,text:c?c.label:'Mentoring',priority:'required' as const,topic:'skill' as const,quote:'Q',sourceHash:H,span,proposedCriterion:c,reason});
const ws:any={contractVersion:1,extractionId:'e1',sourceHash:H,extractionLimit:false,reviewHash:null,versionId:null,exclusionsConfirmed:false,
 dispositions:[],items:[item('i1',py),item('i2',go,'capacity'),item('i3',k8s),item('i4',null,'unsupported_mapping',null)]};
const payload=(cs:any[])=>({schemaVersion:3,compilerVersion:3,taxonomyVersion:3,criteria:cs}) as any;

describe('also-in-JD list',()=>{
 it('starts from the server proposal',()=>{expect(initialCriteria(ws).map(c=>c.id)).toEqual([py.id,k8s.id]);});
 it('lists every item not in the criteria; removing one puts it back on the list',()=>{
  expect(notIncluded(ws,payload([py,k8s])).map(i=>i.id)).toEqual(['i2','i4']);
  expect(notIncluded(ws,payload([py])).map(i=>i.id)).toEqual(['i2','i3','i4']);
  expect(notIncluded(ws,payload([py,k8s,go])).map(i=>i.id)).toEqual(['i4']);
 });
 it('saves one record per item: included, or simply not chosen',()=>{
  expect(selectionFor(ws,payload([py,k8s]))).toEqual([
   {itemId:'i1',state:'included',criterionIds:[py.id]},{itemId:'i2',state:'excluded',reason:'other'},
   {itemId:'i3',state:'included',criterionIds:[k8s.id]},{itemId:'i4',state:'excluded',reason:'other'}]);
 });
});
