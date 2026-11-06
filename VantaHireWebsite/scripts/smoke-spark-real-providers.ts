/** Real-provider smoke test (Claude, 4 Nov 2026, user-approved). Uses Flow's own adapters with keys read from
 * a private local file (SMOKE_KEYS, mode 600). Never prints key values. One small paid call per provider:
 * Groq (tiny chat), Google Vision (OCR of a synthetic scanned page), GCS (write/read/delete one smoke object),
 * Brevo SMTP (one email to SMOKE_EMAIL), ReverseContact (one lookup of SMOKE_EMAIL, the user's own address).
 * Output: pass/fail per provider and only non-identifying shapes (counts, formats), never personal values. */
import {readFileSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';

const keysFile=process.env.SMOKE_KEYS!,email=process.env.SMOKE_EMAIL!;
if(!keysFile||!email)throw Error('SMOKE_KEYS and SMOKE_EMAIL required');
if((statSync(keysFile).mode&0o077)!==0)throw Error('keys_file_must_be_private');
const keys=JSON.parse(readFileSync(keysFile,'utf8')) as Record<string,string>;
Object.assign(process.env,keys,{EMAIL_PROVIDER:'brevo',GOOGLE_VISION_OCR_ENABLED:'true'});
const only=(process.env.SMOKE_ONLY??'groq,vision,gcs,email,rc').split(',');
const results:Record<string,unknown>={};
const run=async(name:string,fn:()=>Promise<unknown>)=>{if(!only.includes(name))return;
  const t=Date.now();try{results[name]={ok:true,ms:Date.now()-t,...(await fn() as object)};results[name]={...(results[name] as object),ms:Date.now()-t};}
  catch(e){results[name]={ok:false,ms:Date.now()-t,error:String((e as Error)?.message??e).replace(/[A-Za-z0-9_\-]{24,}/g,'[redacted]').slice(0,300)};}
  console.log('SMOKE',name,JSON.stringify(results[name]));};

await run('groq',async()=>{
  const {getGroqClient}=await import('../server/lib/groqClient');
  const r=await getGroqClient().chat.completions.create({model:process.env.GROQ_MODEL!,messages:[{role:'user',content:'Reply with exactly: OK'}],max_tokens:300,temperature:0});
  const text=r.choices[0]?.message?.content??'';
  if(!/ok/i.test(text))throw Error('unexpected_reply');
  return {model:process.env.GROQ_MODEL,usage:r.usage?{in:r.usage.prompt_tokens,out:r.usage.completion_tokens}:null};
});

await run('vision',async()=>{
  // Image-only PDF (no text layer) rendered locally, so the ingest path must OCR it.
  const dir=mkdtempSync('/tmp/spark-smoke-');const pdf=`${dir}/scanned.pdf`;
  execFileSync('/home/ews/active-graph-kg/venv/bin/python',['-c',`
from PIL import Image,ImageDraw,ImageFont
img=Image.new('RGB',(1240,1754),'white');d=ImageDraw.Draw(img)
try: f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',36)
except Exception: f=ImageFont.load_default()
for i,l in enumerate(['Synthetic Candidate','Senior Backend Engineer','Skills: Kafka, Terraform, PostgreSQL','Acme Payments 2019 - Present: built the payouts service']):
  d.text((80,120+i*70),l,fill='black',font=f)
img.save('${pdf}','PDF',resolution=150)`]);
  const {extractResumeForOrdinaryIngest}=await import('../server/lib/resumeIngestExtraction');
  const r=await extractResumeForOrdinaryIngest(readFileSync(pdf),{beforeOcr:async()=>{}});
  if(!r.success||r.method!=='google_vision_ocr'||!/Kafka/i.test(r.text))throw Error(`ocr_${r.method}_${r.reasonCode??''}`);
  return {method:r.method,providerCalls:r.providerCalls,chars:r.text.length};
});

await run('gcs',async()=>{
  const gcs=await import('../server/gcs-storage');
  // The upload path only accepts genuine PDF/DOC/DOCX, so the smoke object is a tiny real PDF.
  const PDFDocument=(await import('pdfkit')).default;
  const body=await new Promise<Buffer>(ok=>{const d=new PDFDocument();const parts:Buffer[]=[];d.on('data',c=>parts.push(c));d.on('end',()=>ok(Buffer.concat(parts)));
    d.text(`claude smoke test ${new Date().toISOString()}`);d.end();});
  const path=await gcs.uploadToGCS(body,'claude-smoke-test.pdf');
  try{
    const back=await gcs.downloadFromGCS(path);
    if(!back.equals(body))throw Error('read_mismatch');
  }finally{await gcs.deleteFromGCS(path);}
  if(await gcs.fileExists(path))throw Error('delete_failed');
  return {wroteReadDeleted:true,prefix:path.split('/').slice(3,4)[0]};
});

await run('email',async()=>{
  const {getEmailService}=await import('../server/simpleEmailService');
  const svc=await getEmailService();if(!svc)throw Error('no_email_service');
  const r=await svc.sendEmailWithReceipt({to:email,subject:'ealana smoke test (Claude)',
    text:'This is a one-off smoke test of ealana email delivery (Brevo SMTP), sent on request. No action needed.'});
  if(!r.sent)throw Error(r.uncertain?'send_uncertain':'send_refused');
  return {sent:true,hasMessageId:!!r.messageId};
});

await run('rc',async()=>{
  const {lookupProfessionalProfile}=await import('../server/candidate-product/source-adapters');
  const {buildLookupTransfer}=await import('../server/candidate-product/source-contracts');
  const r=await lookupProfessionalProfile({kind:'email',email},{apiKey:process.env.REVERSECONTACT_API_KEY!});
  const shape:Record<string,unknown>={outcome:r.outcome,credits:r.creditsConsumed,partial:r.partial,alternatives:r.alternativeCount};
  if(r.person){
    const jobs=r.person.experience??[];
    shape.jobs=jobs.length;shape.jobsWithStart=jobs.filter(j=>j.startEndDate?.start).length;
    shape.jobsEndNull=jobs.filter(j=>j.startEndDate&&j.startEndDate.end===null).length;
    shape.startFormats=[...new Set(jobs.map(j=>(j.startEndDate?.start??'').replace(/\d/g,'9')))].slice(0,4);
    // B4 on real RC data: the mapped facts keep dates and mark current jobs.
    const u=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const t=buildLookupTransfer(r,{commandId:u(1),subjectId:u(2),bindingId:u(3),sourceId:u(4),sourceVersion:1,consentRevision:1,
      originalDraftVersion:0,originalProfileVersion:0,originalPreferenceVersion:0,originalPreferenceDraftRevision:0,expiresAt:new Date(Date.now()+3600_000).toISOString()});
    const emp=t.value.proposal.facts.filter((f:any)=>f.kind==='employment').map((f:any)=>f.value);
    shape.mappedJobs=emp.length;shape.mappedWithStart=emp.filter((e:any)=>e.start).length;shape.mappedCurrent=emp.filter((e:any)=>e.current).length;
    shape.datePrecision=[...new Set(emp.map((e:any)=>e.start?.precision).filter(Boolean))];
  }
  return shape;
});

const failed=Object.entries(results).filter(([,v])=>!(v as any).ok).map(([k])=>k);
console.log(failed.length?'SMOKE_FAIL':'SMOKE_PASS',JSON.stringify({ran:Object.keys(results),failed}));
process.exitCode=failed.length?1:0;
