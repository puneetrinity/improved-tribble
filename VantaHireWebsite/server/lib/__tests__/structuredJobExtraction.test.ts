import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({configured:vi.fn(),create:vi.fn()}));
vi.mock('../groqClient',()=>({isGroqConfigured:mocks.configured,getGroqClient:()=>({chat:{completions:{create:mocks.create}}})}));
vi.mock('../aiModelConfig',()=>({getGroqModel:()=> 'synthetic-model'}));
import {extractStructuredJobPosting} from '../structuredJobExtraction';

describe('job autofill keeps extraction separate from discovery expansion',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.configured.mockReturnValue(true);vi.spyOn(console,'error').mockImplementation(()=>undefined);});
  afterEach(()=>vi.restoreAllMocks());
  const jd='Senior Backend Engineer\nPython and JavaScript required. Redis preferred. Six years of experience.';
  const response={roleTitle:'senior backend engineer',mustHaveSkills:['Python','JavaScript'],niceToHaveSkills:['Redis'],adjacentBuckets:['frontend'],experienceYears:null};
  it('never inserts adjacent tools into model-extracted skills or serialized requirements',async()=>{
    mocks.create.mockResolvedValue({choices:[{message:{content:JSON.stringify(response)}}]});
    const result=await extractStructuredJobPosting(jd);
    expect(result.extracted.mustHaveSkills).toEqual(['python','javascript']);
    expect(result.extracted.niceToHaveSkills).toEqual(['redis']);
    expect(JSON.parse(result.descriptionJson)).toEqual(result.extracted);
    expect(result.signalExpandedSkills).toEqual(expect.arrayContaining(['django','react','typescript']));
    expect(Object.values(result.extracted.skillAliases)).not.toContain('django');
    expect(result.extracted.roleTitle).toBe('Senior Backend Engineer');
    expect(result.extracted.experienceYears).toBe(6);
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it.each(['unconfigured','failed'])('does not invent fallback preferred skills (%s)',async mode=>{
    mocks.configured.mockReturnValue(mode!=='unconfigured');mocks.create.mockRejectedValue(new Error('synthetic failure'));
    const result=await extractStructuredJobPosting(jd,{title:'Senior Backend Engineer',skills:['Python'],goodToHaveSkills:['Redis']});
    expect(result.extracted.mustHaveSkills).toEqual(['python']);expect(result.extracted.niceToHaveSkills).toEqual(['redis']);
    expect(result.signalExpandedSkills).toContain('django');
    expect(JSON.parse(result.descriptionJson).niceToHaveSkills).toEqual(['redis']);
  });
  it.each([
    ['Six years of experience.',6],['Requires six years relevant experience.',6],['6+ years of professional experience.',6],
    ['Our company is six years old.',null],['Senior engineer.',null],['Five to six years of experience.',null],
    ['2.5 years of experience.',null],['-6 years of experience.',null],
    ['Six years of experience. Three years of experience with Python.',null],
    ['Six years of experience is not required.',null],['Up to six years of experience.',null],
    ['Twenty six years of experience.',null],['Six years of experience preferred.',null],
  ])('only falls back to a single explicit experience statement: %s',async(text,expected)=>{
    mocks.configured.mockReturnValue(false);
    expect((await extractStructuredJobPosting(text)).extracted.experienceYears).toBe(expected);
  });
  it('preserves explicit recruiter experience rather than overwriting it',async()=>{
    mocks.configured.mockReturnValue(false);
    expect((await extractStructuredJobPosting(jd,{experienceYears:4})).extracted.experienceYears).toBe(4);
  });
  it('escapes punctuation when recovering source title case',async()=>{
    mocks.create.mockResolvedValue({choices:[{message:{content:JSON.stringify({...response,roleTitle:'c++ engineer (backend)'})}}]});
    expect((await extractStructuredJobPosting('C++ Engineer (Backend)\nPython required.')).extracted.roleTitle).toBe('C++ Engineer (Backend)');
  });
});
