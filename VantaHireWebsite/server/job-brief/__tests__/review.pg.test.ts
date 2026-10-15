import {readFileSync} from 'node:fs';
import {Client} from 'pg';
import {describe,it,expect} from 'vitest';

// Run only against a disposable D3 fixture DB; all D4 DDL/data rolls back.
export const SIMPLE_REVIEW_PROOF=String.raw`
DO $$ DECLARE p jsonb; s jsonb; claim jsonb; r jsonb; w jsonb; saved jsonb; approved jsonb;
 rid uuid:=gen_random_uuid(); jd text:=E'Build Python services.\n\nPune, India.\n5 years of experience.  Required.';
 h text:=encode(sha256(convert_to(jd,'UTF8')),'hex'); bad jsonb;
BEGIN
p:='{"schemaVersion":3,"compilerVersion":3,"taxonomyVersion":3,"criteria":[{"id":"10000000-0000-4000-8000-000000000001","label":"Python","class":"must_have","subject":"skill","requirement":{"kind":"accepted_skills","primary":"Python","alternatives":[]},"use":"assessment","evidenceKinds":["profile_evidence"],"provenance":{"kind":"recruiter_edit"}},{"id":"10000000-0000-4000-8000-000000000002","label":"Experience","class":"must_have","subject":"experience_years","requirement":{"kind":"minimum_years","minimum":3},"use":"assessment","evidenceKinds":["profile_evidence"],"provenance":{"kind":"recruiter_edit"}},{"id":"10000000-0000-4000-8000-000000000003","label":"Location","class":"must_have","subject":"location","requirement":{"kind":"text","value":"Bengaluru"},"use":"assessment","evidenceKinds":["profile_evidence"],"provenance":{"kind":"recruiter_edit"}}]}';
s:=jsonb_build_object('action','save_brief','currentJD',jd,'payload',p,'sourceChoice','recruiter_edit','requesterKind','recruiter','reasonCode','other');
PERFORM flow_job_brief_save(90001,90001,90001,gen_random_uuid(),0,s);
claim:=flow_job_brief_draft_claim(90001,90001,90001,gen_random_uuid(),1,h,'synthetic',h);
IF (SELECT source_hash FROM job_brief_draft_requests WHERE request_id=(claim->>'requestId')::uuid)=h THEN
 RAISE EXCEPTION 'fixture must distinguish budget fingerprint from exact JD hash'; END IF;
w:=jsonb_build_object('contractVersion',1,'extractionId',gen_random_uuid(),'sourceHash',h,'extractionLimit',true,'items',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'text','Python','quote','Python','sourceHash',h,'span',jsonb_build_object('start',6,'end',12),'proposedCriterion',p->'criteria'->0),jsonb_build_object('id',gen_random_uuid(),'text','Extra item','quote','services.','sourceHash',h,'span',NULL,'proposedCriterion',NULL)),'dispositions','[]'::jsonb);
-- Neither the budget fingerprint nor another item's source may stand in for exact provenance.
bad:=jsonb_set(w,'{sourceHash}',to_jsonb((SELECT source_hash FROM job_brief_draft_requests WHERE request_id=(claim->>'requestId')::uuid)));
BEGIN
 PERFORM flow_job_brief_draft_finish_review((claim->>'requestId')::uuid,(claim->>'lease')::uuid,jsonb_build_object('state','succeeded','result',p),bad);
 RAISE EXCEPTION 'accepted wrong workspace hash';
EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'BRIEF_INVALID_REVIEW' THEN RAISE; END IF; END;
bad:=jsonb_set(w,'{items,0,sourceHash}',to_jsonb(repeat('0',64)));
BEGIN
 PERFORM flow_job_brief_draft_finish_review((claim->>'requestId')::uuid,(claim->>'lease')::uuid,jsonb_build_object('state','succeeded','result',p),bad);
 RAISE EXCEPTION 'accepted wrong item hash';
EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'BRIEF_INVALID_REVIEW' THEN RAISE; END IF; END;
r:=flow_job_brief_draft_finish_review((claim->>'requestId')::uuid,(claim->>'lease')::uuid,jsonb_build_object('state','succeeded','result',p),w);
IF r->>'state' IS DISTINCT FROM 'review_required' THEN RAISE EXCEPTION 'settlement failed'; END IF;
r:=flow_job_brief_read(90001,90001,90001);
IF jsonb_array_length(r->'reviewWorkspace'->'items') IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'read lost items'; END IF;
saved:=flow_job_brief_save(90001,90001,90001,gen_random_uuid(),1,s);
r:=flow_job_brief_read(90001,90001,90001);
IF r->'reviewWorkspace'->>'versionId' IS DISTINCT FROM saved->>'versionId' THEN RAISE EXCEPTION 'wrong version'; END IF;
IF jsonb_array_length(r->'reviewWorkspace'->'items') IS DISTINCT FROM 2 OR (r->'reviewWorkspace'->'dispositions' @> '[{"state":"excluded"}]'::jsonb) IS DISTINCT FROM true THEN RAISE EXCEPTION 'leftover lost'; END IF;
approved:=flow_job_brief_approve(90001,90001,90001,rid,2,(saved->>'versionId')::uuid,h);
IF approved->>'approvedVersionId' IS DISTINCT FROM saved->>'versionId' THEN RAISE EXCEPTION 'ordinary approval failed'; END IF;
IF flow_job_brief_approve(90001,90001,90001,rid,2,(saved->>'versionId')::uuid,h) IS DISTINCT FROM approved THEN RAISE EXCEPTION 'replay failed'; END IF;
-- Saving the same payload still makes a NEW selection/version requiring approval.
saved:=flow_job_brief_save(90001,90001,90001,gen_random_uuid(),3,s);
IF saved->>'approvedVersionId' IS NOT NULL THEN RAISE EXCEPTION 'approval followed new version'; END IF;
IF flow_job_brief_read(90002,90001,90001) IS NOT NULL THEN RAISE EXCEPTION 'cross org leak'; END IF;
RAISE NOTICE 'simple review persistence, ordinary approval, replay, version invalidation PASS';
END $$;
`;
describe.skipIf(process.env.FLOW_BRIEF_REVIEW_DISPOSABLE!=='1')('simplified review database',()=>{
  it('persists leftovers with a version and approves without checkboxes',async()=>{
    const raw=process.env.FLOW_BRIEF_OWNER_URL??'',u=new URL(raw);
    expect(['127.0.0.1','localhost']).toContain(u.hostname);expect(u.pathname).toMatch(/_test$/);expect(u.username).toMatch(/_test$/);
    const c=new Client({connectionString:raw});await c.connect();
    try {await c.query('BEGIN');await c.query(readFileSync('server/schema-migrations/0019_brief_review_workspace.sql','utf8'));await c.query(SIMPLE_REVIEW_PROOF);}
    finally{await c.query('ROLLBACK');await c.end();}
  });
});
