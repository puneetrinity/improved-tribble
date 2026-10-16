import {describe,it,expect} from 'vitest';
import {assembleReviewWorkspace,validateReviewSelection,REQUIREMENT_EXTRACTION_PROMPT} from '../review';
import {reviewConfirmationSchema,requirementExtractionSchema,type ExtractedRequirement} from '../../../shared/brief-review';
import {sourceHash} from '../contracts';
import {BRIEF_PROVIDER_TIMEOUT_MS,BRIEF_DRAFT_LEASE_MS,BRIEF_SETTLEMENT_SQL_MS,BRIEF_SETTLEMENT_MARGIN_MS,providerBudgetMs,poolConnectWaitMs} from '../draft';
import {readFileSync} from 'node:fs';
const item=(text:string,topic:ExtractedRequirement['topic']='skill'):ExtractedRequirement=>({text,topic,priority:'required',quote:text,
  terms:topic==='skill'?[text]:[],minimum:null,maximum:null,relation:'single',capability:null,
  ...(topic==='location'&&text.includes('Bengaluru, India')?{location:{scope:'city' as const,city:'Bengaluru',country:'India',workArrangement:text.includes('hybrid')?'hybrid, three days a week in office':null}}:{})});
const run=(items:ExtractedRequirement[],overflow=false,jd=items.map(x=>x.quote).join('\n'))=>assembleReviewWorkspace(JSON.stringify({items,overflow}),jd);
describe('D4 extraction and review primitives',()=>{
  it('binds multiline quotes to the exact JD, not its attempt-budget fingerprint',()=>{
    const jd='Backend engineer\n\nPython  required.\r\nPune, India.';
    const w=run([item('Python')],false,jd);
    expect(w.sourceHash).toBe(sourceHash(jd));
    expect(w.sourceHash).not.toBe(sourceHash(jd.trim().replace(/\s+/g,' ')));
    expect(w.items[0]!.sourceHash).toBe(w.sourceHash);
    expect(w.items[0]!.span).toEqual({start:jd.indexOf('Python'),end:jd.indexOf('Python')+6});
    expect(w.proposal!.criteria[0]!.provenance).toMatchObject({sourceHash:w.sourceHash});
  });
  it('a drafted location scores the place and keeps hybrid/office wording in the note (job 188 case)',()=>{
    const text='Bengaluru, India (hybrid, three days a week in office)';
    const w=run([item(text,'location'),item('Python')]);
    const loc=w.proposal!.criteria.find(c=>c.subject==='location')!;
    expect(loc.requirement).toEqual({kind:'text',value:'Bengaluru, India'});
    expect(loc.note).toBe('hybrid, three days a week in office');
    expect(loc.label).toBe('Location');
  });
  it('a location with no country is never guessed: it stays visible for the recruiter',()=>{
    const w=run([item('Bengaluru','location'),item('Python')]);
    expect(w.proposal!.criteria.some(c=>c.subject==='location')).toBe(false);
    const visible=w.items.find(i=>i.topic==='location')!;
    expect(visible.proposedCriterion).toBeNull();
    expect(w.dispositions.find(d=>d.itemId===visible.id)!.state).toBe('unresolved');
  });
  it.each(['Bengaluru or Pune, India','Lahore, Punjab'])('drafting never broadens or guesses %s: it stays visible for the recruiter',text=>{
    const w=run([item(text,'location'),item('Python')]);
    expect(w.proposal!.criteria.some(c=>c.subject==='location')).toBe(false);
    const visible=w.items.find(i=>i.topic==='location')!;
    expect(visible.proposedCriterion).toBeNull();expect(visible.text).toBe(text);
  });
  it('assigns structure and retains every item beyond twelve',()=>{
    const w=run([item('Bengaluru, India','location'),{...item('6–8 years','overall_experience'),minimum:6,maximum:8},
      ...Array.from({length:14},(_,i)=>item('Tool'+i))]);
    expect(w.items).toHaveLength(16);expect(w.proposal!.criteria).toHaveLength(12);
    expect(w.dispositions.filter(x=>x.state==='excluded')).toHaveLength(4);
    expect(w.proposal!.criteria[0]!.requirement).toEqual({kind:'experience_range',minimum:6,maximum:8});
    expect(w.exclusionsConfirmed).toBe(false);expect(w.reviewHash).toBeNull();
    expect(w.items.every(i=>i.id && i.span && i.sourceHash)).toBe(true);
  });
  it('reserves two foundation slots even when not stated',()=>{
    const w=run(Array.from({length:12},(_,i)=>item('Tool'+i)));
    expect(w.proposal!.criteria).toHaveLength(10);expect(w.proposal!.criteria.some(c=>c.subject==='location')).toBe(false);
  });
  it('keeps either/or together without inventing aliases',()=>{
    const w=run([{...item('AWS or Azure'),terms:['AWS','Azure'],relation:'any_of'}]);
    expect(w.proposal!.criteria[0]).toMatchObject({label:'Any one of: AWS, Azure',requirement:{primary:'AWS',alternatives:['Azure']}});
  });
  it.each(['Fluent German','Led at least two major launches','At least 2 years teaching'])('preserves full text: %s',text=>{
    const w=run([item(text,text==='Fluent German'?'language':'relevant_work')]);
    expect(w.proposal!.criteria[0]!.requirement).toEqual({kind:'text',value:text});
  });
  it('does not fabricate provenance for shortened quotes',()=>{
    const w=run([item('Python ... required')],false,'Python and Java are required');
    expect(w.items[0]).toMatchObject({span:null,reason:'quote_not_found',proposedCriterion:null});
    expect(w.dispositions[0]!.state).toBe('unresolved');expect(w.proposal).toBeNull();
  });
  it('first exact quote uses UTF16 offsets',()=>{
    const w=run([item('Python')],false,'😀 Python Python');expect(w.items[0]!.span).toEqual({start:3,end:9});
  });
  it('keeps conflicting foundations visible rather than choosing',()=>{
    const w=run([item('Chennai','location'),item('On-site','location')]);
    expect(w.items.every(x=>x.reason==='conflicting_foundation')).toBe(true);expect(w.proposal).toBeNull();
  });
  it('keeps unclear items visible',()=>{
    const w=run([{...item('Relevant background','other'),priority:'unclear'}]);
    expect(w.items[0]!.reason).toBe('needs_clarification');
  });
  it('flags inconsistent typed fields without losing other useful items',()=>{
    const w=run([{...item('Python'),minimum:3},item('Java')]);
    expect(w.items[0]!.reason).toBe('unsupported_mapping');expect(w.proposal!.criteria).toHaveLength(1);
  });
  it('checks complete and owned selection coverage',()=>{
    const w=run([item('Python'),item('Java')]), selection={extractionId:w.extractionId,dispositions:w.dispositions};
    expect(validateReviewSelection(w,selection,w.proposal!)).toEqual(selection);
    expect(()=>validateReviewSelection(w,{...selection,dispositions:w.dispositions.slice(1)},w.proposal!)).toThrow('BRIEF_INVALID_REVIEW');
    expect(()=>validateReviewSelection(w,{...selection,dispositions:[w.dispositions[0],w.dispositions[0]]},w.proposal!)).toThrow('BRIEF_INVALID_REVIEW');
    expect(()=>validateReviewSelection(w,{...selection,extractionId:'10000000-0000-4000-8000-000000000001'},w.proposal!)).toThrow('BRIEF_INVALID_REVIEW');
  });
  it('allows overflow without extra confirmation while retaining inventory',()=>{
    const w=run([item('Python')],true), selection={extractionId:w.extractionId,dispositions:w.dispositions};
    expect(validateReviewSelection(w,selection,w.proposal!,true)).toEqual(selection);
    expect(()=>validateReviewSelection(w,{...selection,manualReview:{reason:'ai_inventory_incomplete',explanation:''}},w.proposal!,true)).toThrow();
    const before=JSON.stringify(w);
    expect(validateReviewSelection(w,{...selection,manualReview:{reason:'ai_inventory_incomplete',explanation:'I reviewed the complete JD.'}},w.proposal!,true).manualReview).toBeDefined();
    expect(JSON.stringify(w)).toBe(before);
  });
  it('keeps unresolved items visible without blocking ordinary approval',()=>{
    const w=run([item('Python'),item('Unknown','other')],true);
    expect(validateReviewSelection(w,{extractionId:w.extractionId,dispositions:w.dispositions},w.proposal!,true).dispositions).toEqual(w.dispositions);
  });
  it('rejects malformed envelopes and >64 rather than truncating',()=>{
    expect(()=>run(Array.from({length:65},(_,i)=>item('Tool'+i)))).toThrow();
    expect(()=>assembleReviewWorkspace('{broken','JD')).toThrow();
    expect(requirementExtractionSchema.safeParse({items:[{...item('Python'),id:'model'}],overflow:false}).success).toBe(false);
  });
  it('confirmation requires explicit yes and no duplicate exclusions',()=>{
    const id='10000000-0000-4000-8000-000000000001', base={reviewHash:'a'.repeat(64),excludedItemIds:[id],acknowledged:true};
    expect(reviewConfirmationSchema.safeParse(base).success).toBe(true);
    expect(reviewConfirmationSchema.safeParse({...base,acknowledged:false}).success).toBe(false);
    expect(reviewConfirmationSchema.safeParse({...base,excludedItemIds:[id,id]}).success).toBe(false);
  });
  describe('how the skill names in a line relate',()=>{
    const skill=(w:ReturnType<typeof run>)=>w.proposal?.criteria.find(c=>c.subject==='skill')?.requirement;
    it('parts and sub-skills never become substitutes, even if the model calls them a choice',()=>{
      const sql=run([{...item('Strong SQL skills, including window functions and query tuning'),terms:['SQL','window functions','query tuning'],relation:'any_of'}]);
      expect(skill(sql)).toEqual({kind:'accepted_skills',primary:'SQL',alternatives:[]});
      const aws=run([{...item('Familiarity with AWS (S3, Glue, IAM)'),terms:['AWS','S3','Glue','IAM'],relation:'any_of'}]);
      expect(skill(aws)).toEqual({kind:'accepted_skills',primary:'AWS',alternatives:[]});
      const single=run([{...item('Go, including concurrency'),terms:['Go','concurrency']}]);
      expect(skill(single)).toEqual({kind:'accepted_skills',primary:'Go',alternatives:[]});
    });
    it('explicit either/or stays a choice',()=>{
      for(const [q,terms] of [['Experience with Apache Airflow or Dagster',['Apache Airflow','Dagster']],['Snowflake/BigQuery',['Snowflake','BigQuery']],['One of Go, Rust',['Go','Rust']]] as const){
        const w=run([{...item(q),terms:[...terms],relation:'any_of'}]);
        expect(skill(w)).toEqual({kind:'accepted_skills',primary:terms[0],alternatives:terms.slice(1)});
      }
    });
    it('a capability with example tools never requires one specific product',()=>{
      const q='Data quality testing with Great Expectations or similar tools';
      const ok=run([{...item(q),terms:['Great Expectations'],relation:'examples_of',capability:'data quality testing'}]);
      expect(skill(ok)).toEqual({kind:'accepted_skills',primary:'data quality testing',alternatives:['Great Expectations']});
      // Mislabelled by the model: the JD's "or similar" wording still yields the capability, never the tool alone.
      for(const relation of ['single','any_of'] as const){
        expect(skill(run([{...item(q),terms:['Great Expectations'],relation}])))
          .toEqual({kind:'accepted_skills',primary:'Data quality testing',alternatives:['Great Expectations']});
      }
      expect(skill(run([{...item('Observability tools such as Prometheus'),terms:['Prometheus']}])))
        .toEqual({kind:'accepted_skills',primary:'Observability tools',alternatives:['Prometheus']});
      expect(skill(run([{...item('Cloud experience (e.g. AWS)'),terms:['AWS']}])))
        .toEqual({kind:'accepted_skills',primary:'Cloud experience',alternatives:['AWS']});
      // No capability stated before the tool: never a hard requirement for it; the recruiter decides.
      const eq=run([{...item('Terraform or equivalent'),terms:['Terraform']}]);
      expect(eq.proposal).toBeNull();expect(eq.items[0]!.reason).toBe('unsupported_mapping');
      // examples_of without a capability takes it from the JD wording; an invented parent never replaces the named skill.
      expect(skill(run([{...item(q),terms:['Great Expectations'],relation:'examples_of'}])))
        .toEqual({kind:'accepted_skills',primary:'Data quality testing',alternatives:['Great Expectations']});
      expect(skill(run([{...item('Great Expectations'),relation:'examples_of',capability:'data quality'}])))
        .toEqual({kind:'accepted_skills',primary:'Great Expectations',alternatives:[]});
    });
    it('parts labelled as examples require the named parent alone',()=>{
      for(const [q,cap,parts] of [['Experience with GCP (Cloud Run, Firestore)','GCP',['Cloud Run','Firestore']],
        ['Strong CSS, including Flexbox and Grid','CSS',['Flexbox','Grid']],['Android SDK, including Room and WorkManager','Android SDK',['Room','WorkManager']]] as const){
        const w=run([{...item(q),terms:[...parts],relation:'examples_of',capability:cap}]);
        expect(skill(w)).toEqual({kind:'accepted_skills',primary:cap,alternatives:[]});
      }
    });
    it('a capability with a stated choice of tools accepts any of them',()=>{
      const w=run([{...item('Service mesh experience (Istio or Linkerd)'),terms:['Istio','Linkerd'],relation:'examples_of',capability:'Service mesh'}]);
      expect(skill(w)).toEqual({kind:'accepted_skills',primary:'Service mesh experience',alternatives:['Istio','Linkerd']});
    });
    it('takes the parent or capability from the JD wording when the model gives none or invents one',()=>{
      const aws=run([{...item('Experience with AWS (EC2, RDS, SQS)'),terms:['EC2','RDS','SQS'],relation:'examples_of',capability:'AWS services'}]);
      expect(skill(aws)).toEqual({kind:'accepted_skills',primary:'AWS',alternatives:[]});
      const awsSingle=run([{...item('Experience with AWS (EC2, RDS, SQS)'),terms:['EC2','RDS','SQS']}]);
      expect(skill(awsSingle)).toEqual({kind:'accepted_skills',primary:'AWS',alternatives:[]});
      const ml=run([{...item('MLOps tools such as MLflow or Kubeflow'),terms:['MLflow','Kubeflow'],relation:'examples_of'}]);
      expect(skill(ml)).toEqual({kind:'accepted_skills',primary:'MLOps tools',alternatives:['MLflow','Kubeflow']});
      const bullet=run([{...item('- MLOps tools such as MLflow'),terms:['MLflow'],relation:'examples_of',capability:'- MLOps tools'}]);
      expect(skill(bullet)).toMatchObject({primary:'MLOps tools'});
      const hris=run([{...item('Experience with an HRIS such as Workday or SuccessFactors'),terms:['Workday','SuccessFactors']}]);
      expect(skill(hris)).toEqual({kind:'accepted_skills',primary:'HRIS',alternatives:['Workday','SuccessFactors']});
      // A parent the JD names before its own skill list is not invented: SQL stays the skill.
      const sql=run([{...item('Strong SQL skills, including window functions'),terms:['SQL','window functions']}]);
      expect(skill(sql)).toEqual({kind:'accepted_skills',primary:'SQL',alternatives:[]});
    });
    it('a slash inside a name is not a choice',()=>{
      const net=run([{...item('Networking fundamentals, including DNS, TCP/IP and load balancing'),terms:['DNS','TCP/IP','load balancing'],relation:'examples_of',capability:'Networking fundamentals'}]);
      expect(skill(net)).toEqual({kind:'accepted_skills',primary:'Networking fundamentals',alternatives:[]});
      expect(skill(run([{...item('CI/CD pipelines'),terms:['CI/CD']}]))).toEqual({kind:'accepted_skills',primary:'CI/CD',alternatives:[]});
      // A name the JD does not contain (model added Jenkins) is unverifiable: the recruiter decides.
      expect(run([{...item('CI/CD pipelines'),terms:['CI/CD','Jenkins'],relation:'any_of'}]).proposal).toBeNull();
      const real=run([{...item('Snowflake/BigQuery'),terms:['Snowflake','BigQuery'],relation:'any_of'}]);
      expect(skill(real)).toEqual({kind:'accepted_skills',primary:'Snowflake',alternatives:['BigQuery']});
    });
    it('a one-letter name does not break choice wording',()=>{
      const w=run([{...item('R or Julia'),terms:['R','Julia'],relation:'any_of'}]);
      expect(skill(w)).toEqual({kind:'accepted_skills',primary:'R',alternatives:['Julia']});
    });
    it('a one-skill line with no listed name keeps the JD wording',()=>{
      expect(skill(run([{...item('Jetpack Compose'),terms:[]}]))).toEqual({kind:'accepted_skills',primary:'Jetpack Compose',alternatives:[]});
      expect(skill(run([{...item('Observability tools such as Prometheus'),terms:[]}])))
        .toEqual({kind:'accepted_skills',primary:'Observability tools',alternatives:[]});
    });
    it('a stated choice stays a choice even when the model forgets to label it',()=>{
      const w=run([{...item('Experience with Ahrefs or Semrush'),terms:['Ahrefs','Semrush']}]);
      expect(skill(w)).toEqual({kind:'accepted_skills',primary:'Ahrefs',alternatives:['Semrush']});
      const sk=run([{...item('Basic SEO knowledge, including keyword research and on-page optimisation'),terms:[]}]);
      expect(skill(sk)).toEqual({kind:'accepted_skills',primary:'SEO knowledge',alternatives:[]});
    });
    it('Codex review: choice wording elsewhere in the line does not join required skills',()=>{
      const q='Python and SQL required; Java or Kotlin preferred';
      expect(skill(run([{...item(q),terms:['Python','SQL'],relation:'any_of'}]))).toEqual({kind:'accepted_skills',primary:'Python',alternatives:[]});
      expect(skill(run([{...item(q),terms:['Java','Kotlin'],relation:'any_of'}]))).toEqual({kind:'accepted_skills',primary:'Java',alternatives:['Kotlin']});
      // The model lumping everything together is ambiguous: the recruiter decides.
      const all=run([{...item(q),terms:['Python','SQL','Java','Kotlin'],relation:'any_of'}]);
      expect(all.proposal).toBeNull();expect(all.items[0]!.reason).toBe('unsupported_mapping');
      expect(run([{...item('Python and SQL or R'),terms:['Python','SQL','R']}]).proposal).toBeNull();
    });
    it('Codex review: negated wording never becomes a requirement',()=>{
      for(const q of ['Neither Java nor Python is required','Java is not required','No Python experience needed',
        "Kubernetes isn't required",'No need for prior AWS experience']){
        const w=run([{...item(q),terms:['Java','Python'],relation:'any_of'}],false,q);
        expect(w.proposal).toBeNull();
      }
      const lang=run([{...item('Hindi is not required','language')}]);expect(lang.proposal).toBeNull();
      // "Not limited to" is not a negation of the requirement.
      expect(skill(run([{...item('Cloud platforms including but not limited to AWS'),terms:['AWS']}]))).toBeDefined();
    });
    it('Codex review: a capability the JD does not state is never accepted from the model',()=>{
      const tf=run([{...item('Terraform or equivalent'),terms:['Terraform'],relation:'examples_of',capability:'Infrastructure as code'}]);
      expect(tf.proposal).toBeNull();expect(tf.items[0]!.reason).toBe('unsupported_mapping');
      const iac=run([{...item('Infrastructure as code with Terraform or similar tools'),terms:['Terraform'],relation:'examples_of',capability:'IaC tooling'}]);
      expect(skill(iac)).toEqual({kind:'accepted_skills',primary:'Infrastructure as code',alternatives:['Terraform']});
    });
    it('a name the JD does not contain makes the joining unverifiable',()=>{
      expect(run([{...item('PostgreSQL or MySQL'),terms:['Postgres','MySQL'],relation:'any_of'}]).proposal).toBeNull();
    });
    it('a choice the JD wording does not support falls back to the main skill',()=>{
      const w=run([{...item('Kubernetes and Docker'),terms:['Kubernetes','Docker'],relation:'any_of'}]);
      expect(skill(w)).toEqual({kind:'accepted_skills',primary:'Kubernetes',alternatives:[]});
    });
  });
  it('a stated location or experience counts even if the model marks it unclear',()=>{
    const w=run([{...item('Location: Bengaluru, India','location'),priority:'unclear'},
      {...item('3 to 6 years','overall_experience'),priority:'unclear',minimum:3,maximum:6}]);
    const subjects=w.proposal!.criteria.map(c=>[c.subject,c.class]);
    expect(subjects).toEqual([['experience_years','must_have'],['location','must_have']]);
    expect(w.items.every(i=>i.reason===null)).toBe(true);
  });
  it('a sub-condition on the same line is not a conflicting experience',()=>{
    const jd='Requirements\n- 8+ years of HR experience, including at least 3 years as an HR business partner\n- Labour law';
    const a={...item('8+ years of HR experience','overall_experience'),minimum:8};
    const b={...item('at least 3 years as an HR business partner','overall_experience'),minimum:3};
    const w=run([a,b],false,jd);
    expect(w.proposal!.criteria.filter(c=>c.subject==='experience_years').map(c=>c.requirement)).toEqual([{kind:'minimum_years',minimum:8}]);
    expect(w.proposal!.criteria.find(c=>c.subject==='relevant_work')!.requirement).toEqual({kind:'text',value:'at least 3 years as an HR business partner'});
    expect(w.items.every(i=>i.reason===null)).toBe(true);
    // On different lines they still conflict and the recruiter chooses.
    const w2=run([a,b],false,'8+ years of HR experience\nat least 3 years as an HR business partner');
    expect(w2.items.every(i=>i.reason==='conflicting_foundation')).toBe(true);
  });
  it('a skill with a years figure becomes relevant-experience text',()=>{
    const w=run([{...item('At least 2 years leading a team'),terms:[],minimum:2}]);
    expect(run([{...item('At least two years leading a team'),terms:[],minimum:2}]).proposal!.criteria[0]!.subject).toBe('relevant_work');
    expect(w.proposal!.criteria[0]).toMatchObject({subject:'relevant_work',requirement:{kind:'text',value:'At least 2 years leading a team'}});
  });
  it('a missing empty field never fails the whole draft',()=>{
    const {minimum,maximum,...bare}=item('Python');
    const w=assembleReviewWorkspace(JSON.stringify({items:[bare],overflow:false}),'Python');
    expect(w.proposal!.criteria).toHaveLength(1);
    expect(()=>assembleReviewWorkspace(JSON.stringify({items:[{...bare,minimum:'two'}],overflow:false}),'Python')).toThrow();
  });
  it('keeps a numbered sub-condition as text instead of dropping it',()=>{
    const w=run([{...item('At least 3 years selling to manufacturing companies','relevant_work'),minimum:3}]);
    expect(w.proposal!.criteria[0]!.requirement).toEqual({kind:'text',value:'At least 3 years selling to manufacturing companies'});
  });
  it('text requirements keep their wording even when the model lists terms',()=>{
    const w=run([{...item('Good written and spoken English','language'),terms:['English']},
      {...item("Bachelor's degree in computer science or a related field",'education'),terms:['computer science']},
      {...item('AWS Solutions Architect certification','certification'),terms:['AWS']},
      {...item('Experience in a logistics or e-commerce company','relevant_work'),priority:'preferred',terms:['logistics']}]);
    expect(w.proposal!.criteria.map(c=>[c.subject,c.requirement])).toEqual([
      ['language',{kind:'text',value:'Good written and spoken English'}],
      ['education_requirement',{kind:'text',value:"Bachelor's degree in computer science or a related field"}],
      ['certification',{kind:'text',value:'AWS Solutions Architect certification'}],
      ['relevant_work',{kind:'text',value:'Experience in a logistics or e-commerce company'}]]);
  });
  it('fills slots with skills before free-text requirements of the same priority',()=>{
    const w=run([item('Fluent English','language'),...Array.from({length:10},(_,i)=>item('Tool'+i))]);
    expect(w.proposal!.criteria.every(c=>c.subject==='skill')).toBe(true);
    expect(w.items[0]!.reason).toBe('capacity');
  });
  it('the provider budget is derived from the real lease, settlement limits and pool connection wait',()=>{
    // Constants in code must equal the deployed SQL and pool defaults they stand for.
    const claim=readFileSync('server/schema-migrations/0017_approved_skill_alternatives.sql','utf8');
    const lease=Number(/'dispatched',gen_random_uuid\(\),clock_timestamp\(\)\+interval '(\d+) seconds'/.exec(claim)![1])*1000;
    const finish=readFileSync('server/schema-migrations/0019_brief_review_workspace.sql','utf8');
    const head=/FUNCTION public\.flow_job_brief_draft_finish_review[\s\S]*?SET lock_timeout='(\d+)s' SET statement_timeout='(\d+)s'/.exec(finish)!;
    const pool=Number(/PGPOOL_CONNECT_TIMEOUT_MS \|\| '(\d+)'/.exec(readFileSync('server/db.ts','utf8'))![1]);
    expect(BRIEF_DRAFT_LEASE_MS).toBe(lease);
    expect(BRIEF_SETTLEMENT_SQL_MS).toBe((Number(head[1])+Number(head[2]))*1000);
    expect(poolConnectWaitMs({})).toBe(pool);
    // Provider + connection wait + settlement + margin never exceeds the lease.
    for(const wait of [pool,5_000,20_000]) {
      const budget=providerBudgetMs(0,wait);
      expect(budget+wait+BRIEF_SETTLEMENT_SQL_MS+BRIEF_SETTLEMENT_MARGIN_MS).toBeLessThanOrEqual(lease);
      expect(budget).toBeLessThanOrEqual(BRIEF_PROVIDER_TIMEOUT_MS);
    }
    expect(providerBudgetMs(0,pool)).toBe(40_000);
    expect(providerBudgetMs(0,20_000)).toBe(30_000);
    expect(providerBudgetMs(15_000,pool)).toBe(25_000);   // time already spent shrinks it
    // pg treats 0 as "wait forever": unbounded, so no provider time at all.
    expect(poolConnectWaitMs({PGPOOL_CONNECT_TIMEOUT_MS:'0'})).toBe(Infinity);
    expect(providerBudgetMs(0,Infinity)).toBeLessThan(0);
  });
  it('uses a short JSON extraction contract without application fields',()=>{
    expect(REQUIREMENT_EXTRACTION_PROMPT).toContain('Return JSON');expect(REQUIREMENT_EXTRACTION_PROMPT.length).toBeLessThan(3000);
  });
});
