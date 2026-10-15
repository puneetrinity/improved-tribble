import {describe,it,expect} from 'vitest';
import {assembleExtractedBrief, EXTRACTION_PROMPT} from '../extraction';
const jd='Python is required. Kubernetes is preferred.';
const criterion={label:'Python',class:'must_have',subject:'skill',requirement:{kind:'accepted_skills',primary:'Python',alternatives:[]},quote:'Python is required.'};
const input={criteria:[criterion],unrepresented:[]};
const run=(value:unknown,source=jd)=>assembleExtractedBrief(JSON.stringify(value),source);
describe('model extraction boundary',()=>{
  it('assigns mechanical fields and exact source positions without changing input',()=>{
    const before=JSON.stringify(input),out=run(input);expect(JSON.stringify(input)).toBe(before);
    expect(out.criteria[0]).toMatchObject({label:'Python',use:'assessment',evidenceKinds:['profile_evidence'],provenance:{kind:'jd',start:0,end:19}});
    expect(out.criteria[0]!.id).toMatch(/^[0-9a-f-]{36}$/);expect(out.schemaVersion).toBe(3);
  });
  it('uses first exact repeated quote',()=>expect(run(input,jd+' '+jd).criteria[0]!.provenance).toMatchObject({start:0,end:19}));
  it('does not invent foundations',()=>expect(run(input).criteria.map(c=>c.subject)).toEqual(['skill']));
  it.each([{...input,approved:true},{...input,criteria:[{...criterion,id:'model-id'}]},
    {...input,criteria:[{...criterion,quote:'python is required.'}]},
    {...input,criteria:[]},{...input,unrepresented:[{quote:criterion.quote,reason:'capacity'}]},
    {...input,criteria:Array(13).fill(criterion)},
    {...input,criteria:[{...criterion,requirement:{kind:'text',value:'Python'}}]},
  ])('refuses invalid/incomplete extraction %#',value=>expect(()=>run(value)).toThrow());
  it('preserves UTF-16 offsets',()=>expect(run(input,'😀\r\n'+jd).criteria[0]!.provenance).toMatchObject({start:4,end:23}));
  it('accepts twelve independent criteria',()=>{
    const criteria=Array.from({length:12},(_,n)=>({...criterion,label:'Skill'+n,requirement:{kind:'accepted_skills',primary:'Skill'+n,alternatives:[]}}));
    expect(run({criteria,unrepresented:[]}).criteria).toHaveLength(12);
  });
  it('keeps semantic validation',()=>expect(()=>run({...input,criteria:[{...criterion,subject:'experience_years'}]})).toThrow('final_validation_invalid'));
  it('bounds response bytes',()=>expect(()=>assembleExtractedBrief(' '.repeat(65537),jd)).toThrow());
  it('preserves explicit either/or as one accepted-choice criterion',()=>{
    const quote='AWS or Azure is required.';
    const requirement={kind:'accepted_skills',primary:'AWS',alternatives:['Azure']};
    const out=run({criteria:[{...criterion,label:'Any one of: AWS, Azure',requirement,quote}],unrepresented:[]},quote);
    expect(out.criteria).toHaveLength(1);
    expect(out.criteria[0]!.requirement).toEqual(requirement);
  });
  it.each([
    ['relevant_work','Led at least two launches','Led at least two launches is required.'],
    ['language','Fluent German','Fluent German is required.'],
    ['location','Bengaluru, hybrid three days per week','Bengaluru, hybrid three days per week is required.'],
  ])('preserves specific text for %s', (subject,value,quote)=>{
    const requirement={kind:'text',value};
    const out=run({criteria:[{...criterion,label:value,subject,requirement,quote}],unrepresented:[]},quote);
    expect(out.criteria[0]!.requirement).toEqual(requirement);
    expect(out.criteria[0]!.label).toBe(value);
  });
  it('preserves both ends of an experience range',()=>{
    const quote='8–12 years of experience required.';
    const requirement={kind:'experience_range',minimum:8,maximum:12};
    const out=run({criteria:[{...criterion,label:'8–12 years',subject:'experience_years',requirement,quote}],unrepresented:[]},quote);
    expect(out.criteria[0]!.requirement).toEqual(requirement);
  });
  it('refuses a reported omission even when twelve other criteria fit',()=>{
    const quote='Kafka is preferred.';
    const criteria=Array.from({length:12},(_,n)=>({...criterion,label:'Skill'+n,requirement:{kind:'accepted_skills',primary:'Skill'+n,alternatives:[]}}));
    expect(()=>run({criteria,unrepresented:[{quote,reason:'capacity'}]},jd+' '+quote)).toThrow('extraction_incomplete');
  });
  it('instructs the model about choices, conjunctions, numbers, languages and omissions',()=>{
    for(const instruction of ['Respond in JSON','ANY ONE','AWS and Terraform and dbt','never alternatives',
      'comparator, units and context','Fluent German','never boolean yes','Never silently omit'])expect(EXTRACTION_PROMPT).toContain(instruction);
  });
});
