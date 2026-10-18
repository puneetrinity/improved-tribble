import {beforeEach,describe,expect,it,vi} from 'vitest';
import {applicantContactBlocked,readSourcingCandidateOrigin} from '../../../shared/sourcing-candidate-origin';
const findFirst=vi.hoisted(()=>vi.fn());
const orgFirst=vi.hoisted(()=>vi.fn());
vi.mock('../../db',()=>({db:{query:{jobSourcedCandidates:{findFirst},organizations:{findFirst:orgFirst}}}}));
import {canContactSourcedCandidate,canResolveSourcedContact} from '../../sourcing-authority/candidate-access';

describe('previous applicant server contact boundary',()=>{
  beforeEach(()=>{findFirst.mockReset();orgFirst.mockReset();orgFirst.mockResolvedValue({id:32});});
  it('keeps legacy absence distinct from explicit null',()=>{
    expect(readSourcingCandidateOrigin(undefined).kind).toBe('public_profile');
    for(const value of [null,{},[],{kind:'public_profile'},{version:1,kind:'public_profile',extra:true}])
      expect(readSourcingCandidateOrigin(value).kind).toBe('invalid');
  });
  it.each([null,{}, {version:1,kind:'organization_candidate',applicationId:1,applicationJobId:2},
    {version:1,kind:'organization_candidate',applicationId:null,applicationJobId:2}])('blocks private/damaged origin %j',origin=>{
    expect(applicantContactBlocked({candidateSummary:{candidateOrigin:origin}})).toBe(true);
  });
  it('blocks converted and applied public profiles',()=>{
    expect(applicantContactBlocked({candidateSummary:{},convertedApplicationId:2})).toBe(true);
    expect(applicantContactBlocked({candidateSummary:{},appliedAt:new Date()})).toBe(true);
    expect(applicantContactBlocked({candidateSummary:{}})).toBe(false);
  });
  it('uses fresh stored authority, not a cached browser eligibility flag',async()=>{
    findFirst.mockResolvedValueOnce({candidateSummary:{}}).mockResolvedValueOnce({candidateSummary:{candidateOrigin:null}});
    expect(await canContactSourcedCandidate(32,189,2)).toBe(true);
    expect(await canContactSourcedCandidate(32,189,2)).toBe(false);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
  it('refuses missing authority or malformed worker scope',async()=>{
    findFirst.mockResolvedValue(undefined);
    expect(await canResolveSourcedContact('org_32','c1','vanta:jobs:189')).toBe(false);
    orgFirst.mockResolvedValue(undefined);
    expect(await canResolveSourcedContact('unknown','c1','vanta:jobs:189')).toBe(false);
    expect(await canResolveSourcedContact('org_32','c1','189')).toBe(false);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
