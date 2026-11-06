import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {parseProfileCommand} from './profile-contracts';
const memory=process.env.S2_MEMORY_ROOT;
const envelope={schemaVersion:2,idempotencyKey:'10000000-0000-4000-8000-000000000001',expectedDraftVersion:0,expectedProfileVersion:0,expectedPreferenceVersion:0};
const profile={displayName:'Jose\u0301',headline:'',linkedinUrl:null,currentLocation:null,skills:['Python'],employment:[],education:[],projects:[]};
const preferences={desiredRoles:['Engineer'],preferredSeniority:[],workArrangements:['remote'],locations:{mode:'anywhere'},remoteRegions:{mode:'worldwide'},relocation:{mode:'discuss',destinations:[]},employmentTypes:['permanent'],availability:{mode:'unknown'},compensation:{mode:'open_to_discussion'},strengths:{roles:'firm',location:'flexible',workArrangement:'flexible',employmentType:'firm',compensation:'flexible'}};
const draft={...envelope,action:'save_draft',payload:{profile}};
const cases=[JSON.stringify(draft),JSON.stringify({...envelope,action:'save_preferences',payload:{preferences}}),
 JSON.stringify({...envelope,action:'confirm',payload:{draftHash:'a'.repeat(64),consentVersion:0}}),
 JSON.stringify({...draft,payload:{profile:{...profile,linkedinUrl:'https://www.linkedin.com/in/synthetic/'}}}),
 JSON.stringify({...draft,payload:{profile:{...profile,displayName:'\ufeff Unicode 😀 \ufeff'}}}),
 JSON.stringify({...envelope,action:'save_preferences',payload:{preferences:{...preferences,compensation:{mode:'target',currency:'INR',period:'annual',component:'ctc',targetMin:'20.1',targetMax:'25',hardMinimum:null}}}}),
 '{"a":1,"a":2}',JSON.stringify({...draft,subjectId:'foreign'}),JSON.stringify({...draft,expectedDraftVersion:true}),
 JSON.stringify({...draft,payload:{profile:{...profile,displayName:'\ud800'}}}),JSON.stringify({...draft,payload:{profile:{...profile,linkedinUrl:'https://linkedin.com:443/in/a'}}}),
 JSON.stringify({...envelope,action:'save_preferences',payload:{preferences:{...preferences,compensation:{mode:'target',currency:[],period:'annual',component:'ctc',targetMin:'20',targetMax:'25',hardMinimum:null}}}}),
];
describe.skipIf(!memory)('S2 Flow/Memory canonical parity (requires explicit local Memory root)',()=>{
 it.each(cases.map((raw,index)=>({raw,index})))('case $index has identical validation and canonical bytes',({raw})=>{
  let expected:unknown;try{const r=parseProfileCommand(raw);expected={ok:true,canonical:r.canonical,hash:r.hash};}catch{expected={ok:false};}
  const result=spawnSync(process.env.S2_PYTHON??'python3',['-c',
   'import json,sys\nfrom activekg.candidate_profiles.profile_contracts import parse_profile_command\ntry:\n v,c,h=parse_profile_command(sys.stdin.buffer.read());print(json.dumps(dict(ok=True,canonical=c,hash=h)))\nexcept ValueError:\n print(json.dumps(dict(ok=False)))'],
   {input:raw,encoding:'utf8',env:{...process.env,PYTHONPATH:memory},timeout:5000});
  expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toEqual(expected);
 });
});
