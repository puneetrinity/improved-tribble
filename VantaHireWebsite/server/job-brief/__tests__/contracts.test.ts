import { describe, expect, it } from 'vitest';
import { briefPayloadSchema, currentJdSchema, jobBriefEnabled, saveBriefSchema, sourceHash, validateSourceSpans } from '../contracts';
import { jobMetaDescription, publicJobDescription, resolveJobDescription } from '../../../shared/jobDescription';

const id = '10000000-0000-4000-8000-000000000001';
const jd = 'Build Python services.';
const item = { id, label: 'Python', class: 'must_have', subject: 'skill', requirement: { kind: 'text', value: 'Python' }, evidenceKinds: ['profile_evidence'], use: 'retrieval', provenance: { kind: 'jd', sourceHash: sourceHash(jd), start: 6, end: 12 } };
const payload = { schemaVersion: 1, compilerVersion: 1, taxonomyVersion: 1, criteria: [item] };
describe('brief closed contracts', () => {
  it.each([["No career gaps",false],["Career gap",false],["Married",false],["Marriott hospitality systems experience",true],["unmarried only",false],["Native Hindi speaker",false],["Native English speaker",false],["Native fluent English speaker",false],["US citizens only",false],["Citizen of India",false],["Recent graduate",false],["age limit 30",false],["male candidates only",false],["female applicants preferred",false],["Debug race conditions in Go services",true],["Handle a race condition",true],["Age of Empires modding",true],["male/female connectors",true]])('C4 contextual phrase %s accepted=%s in every text field',(text,accepted)=>{
    for(const patch of [{label:text},{requirement:{kind:'text',value:text}},{note:text}]) {
      expect(briefPayloadSchema.safeParse({...payload,criteria:[{...item,...patch}]}).success).toBe(accepted);
    }
  });
  it('allows citizenship only as verified or candidate-provided work eligibility',()=>{
    const c={...item,subject:'work_eligibility',label:'US citizens only',evidenceKinds:['candidate_provided']};
    expect(briefPayloadSchema.safeParse({...payload,criteria:[c]}).success).toBe(true);
    expect(briefPayloadSchema.safeParse({...payload,criteria:[{...c,evidenceKinds:['profile_evidence']}]}).success).toBe(false);
  });
  it('preserves one-pass shipped meta decoding when disabled',()=>{
    const job={title:'Engineer',location:'Remote',originalJD:'Write &amp;lt;b&amp;gt;bold&amp;lt;/b&amp;gt; services.',description:'Legacy'};
    expect(jobMetaDescription(job,'legacy')).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(resolveJobDescription(job,'legacy').text).toBe('Write &lt;b&gt;bold&lt;/b&gt; services.');
    expect(jobMetaDescription({...job,currentJD:'Canonical prose'},'canonical')).toContain('Canonical prose');
  });
  it('never treats minimum experience as a disqualifier',()=>{
    expect(briefPayloadSchema.safeParse({...payload,criteria:[{...item,subject:'experience_years',class:'disqualifier',requirement:{kind:'minimum_years',minimum:10}}]}).success).toBe(false);
  });
  it.each(['age','disability','nationality','national origin','native-speaker','citizenship','mother tongue'])('refuses protected trait %s in labels, requirements and notes',text=>{
    for(const patch of [{label:text},{requirement:{kind:'text',value:text}},{note:text}]) {
      expect(briefPayloadSchema.safeParse({...payload,criteria:[{...item,...patch}]}).success).toBe(false);
    }
  });
  it('canonical display never resurrects legacy prose; disabled mode stays legacy',()=>{
    const row={originalJD:'Old prose',description:'{"roleTitle":"private"}',currentJD:'Current prose'};
    expect(publicJobDescription(row)).toBe('Old prose');
    expect(publicJobDescription(row,'canonical')).toBe('Current prose');
    expect(publicJobDescription({...row,currentJD:null},'canonical')).toBe('Old prose');
    for (const currentJD of ['', ' ', '{"roleTitle":"private"}', '{\\"roleTitle\\":', '<p>{"roleTitle":"private"}</p>']) {
      expect(resolveJobDescription({...row,currentJD},'canonical').resolution).toBe('unavailable');
    }
    expect(publicJobDescription({...row,currentJD:'[Remote] Build things'},'canonical')).toBe('[Remote] Build things');
  });
  it('is off by default, strict and web-only', () => {
    expect(jobBriefEnabled({})).toBe(false); expect(jobBriefEnabled({ FLOW_JOB_BRIEF_ENABLED: 'false' })).toBe(false);
    expect(jobBriefEnabled({ FLOW_JOB_BRIEF_ENABLED: 'true' })).toBe(true);
    for (const raw of ['1', '', 'TRUE', ' false']) expect(() => jobBriefEnabled({ FLOW_JOB_BRIEF_ENABLED: raw })).toThrow();
    expect(() => jobBriefEnabled({ FLOW_JOB_BRIEF_ENABLED: 'true' }, true)).toThrow('WEB_ONLY');
  });
  it('accepts exact source spans and refuses invented evidence', () => {
    const parsed = briefPayloadSchema.parse(payload); expect(() => validateSourceSpans(parsed, jd)).not.toThrow();
    expect(() => validateSourceSpans(parsed, jd + ' Changed.')).toThrow();
  });
  it('caps criteria and duplicate IDs without inventing a provider filter cap', () => {
    for (const criteria of [[], Array(13).fill(item), [item,item]]) {
      expect(briefPayloadSchema.safeParse({...payload,criteria}).success).toBe(false);
    }
    expect(briefPayloadSchema.safeParse({...payload,weights:[1]}).success).toBe(false);
    expect(briefPayloadSchema.safeParse({...payload,criteria:Array.from({length:6}, (_,i) => ({...item,id:`10000000-0000-4000-8000-00000000000${i}`}))}).success).toBe(true);
  });
  it('only accepts minimum experience and explicit supported types', () => {
    const minimum = {...item,subject:'experience_years',requirement:{kind:'minimum_years',minimum:3}};
    expect(briefPayloadSchema.safeParse({...payload,criteria:[minimum]}).success).toBe(true);
    expect(briefPayloadSchema.safeParse({...payload,criteria:[{...minimum,requirement:{...minimum.requirement,maximum:10}}]}).success).toBe(false);
    expect(briefPayloadSchema.safeParse({...payload,criteria:[{...item,subject:'age'}]}).success).toBe(false);
  });
  it('keeps unsupported evidence out of automatic criteria', () => {
    for (const subject of ['responsibility','leadership','availability','work_eligibility']) expect(briefPayloadSchema.safeParse({...payload,criteria:[{...item,subject}]}).success).toBe(false);
    for (const label of ['Overqualified','Gender','Elite college','Graduation year','Career gap']) expect(briefPayloadSchema.safeParse({...payload,criteria:[{...item,label}]}).success).toBe(false);
  });
  it('bounds bytes rather than just characters and does not trust approval input', () => {
    expect(currentJdSchema.safeParse('a'.repeat(20000)).success).toBe(true);
    expect(currentJdSchema.safeParse('😀'.repeat(5001)).success).toBe(false);
    expect(saveBriefSchema.safeParse({requestId:id,expectedRevision:0,currentJD:jd,payload,requesterKind:'recruiter',reasonCode:'other',sourceChoice:'recruiter_edit',approved:true}).success).toBe(false);
    for (const text of [' ', '{"roleTitle":"Engineer"}', '{\\"roleTitle\\":', '<p>{"roleTitle":"x"}</p>']) expect(currentJdSchema.safeParse(text).success).toBe(false);
    expect(currentJdSchema.safeParse('[Remote] Build services.').success).toBe(true);
  });
});
