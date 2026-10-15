import type Groq from 'groq-sdk';
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions';
import { ZodError } from 'zod';
import { getGroqClient, isGroqConfigured } from '../lib/groqClient';
import { getGroqModel } from '../lib/aiModelConfig';
import { draftBriefSchema, canonicalJson, sourceHash, jobBriefAutoDraftEnabled } from './contracts';
import { readBrief } from './commands';
import { assembleExtractedBrief, EXTRACTION_PROMPT, ExtractionError } from './extraction';
import { assembleReviewWorkspace, REQUIREMENT_EXTRACTION_PROMPT, BriefReviewError } from './review';
import { BriefError, BriefRepository, scopeParameters, type BriefScope } from './repository';

/**
 * One time budget, derived from the database lease (never raise one value alone). After the provider answers, the
 * attempt still needs: a pool connection (PGPOOL_CONNECT_TIMEOUT_MS, default 10 s), the finish_review lock wait 2 s and
 * statement 5 s, and a safety margin. The provider gets what is left of the lease, capped at 40 s (provisional).
 * Defaults: 60 - 10 - 7 - 3 = 40 s. If the database lease is missed anyway, the database refuses the late settlement
 * and a replay of the same request reports "unknown" — never a second paid call.
 * A failed or timed-out attempt is never retried automatically; the recruiter can ask once more (attempt limit 2).
 */
export const BRIEF_DRAFT_LEASE_MS=60_000;          // migration 0017 claim: lease_deadline = clock_timestamp()+60 s
export const BRIEF_SETTLEMENT_SQL_MS=7_000;        // migration 0019 finish_review: lock_timeout 2 s + statement_timeout 5 s
export const BRIEF_SETTLEMENT_MARGIN_MS=3_000;
export const BRIEF_PROVIDER_TIMEOUT_MS=40_000;     // provisional ceiling
export const BRIEF_MIN_PROVIDER_MS=10_000;         // below this, do not start (and do not spend) an attempt
/** The pool's connection wait; 0 or invalid means unbounded (pg treats 0 as "wait forever"). */
export function poolConnectWaitMs(env:Record<string,string|undefined>=process.env):number {
  const raw=env.PGPOOL_CONNECT_TIMEOUT_MS; const n=raw===undefined||raw===''?10_000:Number(raw);
  return Number.isFinite(n) && n>0 ? n : Infinity;
}
/** Provider time available `elapsedMs` after the claim started, leaving room to settle inside the lease. */
export function providerBudgetMs(elapsedMs=0,connectWaitMs=poolConnectWaitMs()):number {
  return Math.min(BRIEF_PROVIDER_TIMEOUT_MS,
    BRIEF_DRAFT_LEASE_MS-connectWaitMs-BRIEF_SETTLEMENT_SQL_MS-BRIEF_SETTLEMENT_MARGIN_MS-elapsedMs);
}

type Claim={requestId:string;state:string;lease?:string;currentJD?:string;sourceHash?:string;model?:string;result?:unknown;code?:string};

/** A transport failure is settled once; an ambiguous DB failure is never retried here. */
export async function draftBrief(repository:BriefRepository,scope:BriefScope,input:unknown,
  dependencies:{client?:Groq;model?:string;signal?:AbortSignal}={}) {
  const command=draftBriefSchema.parse(input);
  if(command.mode==='automatic' && !jobBriefAutoDraftEnabled())return {state:'skipped'};
  if (!dependencies.client && !isGroqConfigured()) throw new BriefError('BRIEF_MODEL_UNAVAILABLE',503);
  const current=await readBrief(repository,scope);
  if (!current.currentJD || !current.sourceHash) throw new BriefError('BRIEF_SOURCE_REQUIRED',409);
  const model=dependencies.model??getGroqModel();
  const client=dependencies.client??getGroqClient();
  // Refuse before claiming if settlement could not fit in the lease: no attempt is spent, no paid call is made.
  if(!(providerBudgetMs(0)>=BRIEF_MIN_PROVIDER_MS)) throw new BriefError('BRIEF_MODEL_UNAVAILABLE',503);
  const claimStarted=Date.now(); // the lease starts during the claim, so this is a conservative clock
  const claim=await repository.call<Claim>('claim',[...scopeParameters(scope),command.requestId,command.expectedRevision,
    current.sourceHash,model,sourceHash(canonicalJson(command)),command.mode??'manual']);
  if (!claim.lease) return claim;
  let outcome:Record<string,unknown>;
  let workspace:ReturnType<typeof assembleReviewWorkspace>|undefined;
  const started=Date.now();
  let phase='claim', category='internal_failure', finishReason='unknown';
  let httpStatus:number|undefined;
  let deadline:AbortSignal|undefined;
  const usage:{inputTokens?:number;outputTokens?:number}={};
  const diagnostic=(settlement:string)=>{
    // Never log provider objects, content, reasoning, exception messages or schema paths.
    try { console.info('brief_draft_diagnostic', {requestId:command.requestId,
      model:model==='openai/gpt-oss-120b'?'gpt-oss-120b':'other',elapsedMs:Date.now()-started,
      phase,category,finishReason,httpStatus,...usage,settlement,usage_invalid:category==='usage_invalid'}); } catch { /* Logging cannot change settlement. */ }
  };
  try {
    if (!claim.currentJD || !claim.sourceHash || claim.model!==model) throw new Error('Invalid private claim');
    // The abort is the same budget as the provider wait, measured from the claim; nothing larger.
    const budget=providerBudgetMs(Date.now()-claimStarted);
    if(budget<=0) throw new BriefError('BRIEF_MODEL_TIMEOUT',504);
    deadline=AbortSignal.timeout(budget);
    const signal=dependencies.signal?AbortSignal.any([deadline,dependencies.signal]):deadline;
    phase='provider';
    const request:ChatCompletionCreateParamsNonStreaming & {reasoning_effort?:'medium';max_completion_tokens?:number}={
      model,messages:[{role:'system',content:REQUIREMENT_EXTRACTION_PROMPT},
        {role:'user',content:JSON.stringify({sourceHash:claim.sourceHash,currentJD:claim.currentJD})}],
      temperature:0,...(model==='openai/gpt-oss-120b'
        ? {reasoning_effort:'medium' as const,max_completion_tokens:4096} : {max_tokens:4096}),response_format:{type:'json_object'},
    };
    const completion=await client.chat.completions.create(request,{maxRetries:0,timeout:budget,signal});
    phase='response';
    for(const [key,value,max] of [['inputTokens',completion.usage?.prompt_tokens,2147483647],
      ['outputTokens',completion.usage?.completion_tokens,4096]] as const) {
      if(value===undefined || value===null) continue;
      if(!Number.isSafeInteger(value) || value<0 || value>max) {
        delete usage.inputTokens;delete usage.outputTokens;category='usage_invalid';
        throw new BriefError('BRIEF_MODEL_FAILED',502);
      }
      usage[key]=value;
    }
    const choice=completion.choices[0];
    finishReason=choice && ['stop','length','tool_calls','function_call'].includes(choice.finish_reason)?choice.finish_reason:'unknown';
    if(finishReason==='length') {category='output_length';throw new BriefError('BRIEF_MODEL_TRUNCATED',502);}
    if(!choice || finishReason!=='stop') {category='unexpected_finish';throw new BriefError('BRIEF_MODEL_FAILED',502);}
    if(!choice.message.content?.trim()) {category='empty_output';throw new BriefError('BRIEF_MODEL_INVALID',502);}
    if(Buffer.byteLength(choice.message.content,'utf8')>65536) {category='output_oversize';throw new BriefError('BRIEF_MODEL_INVALID',502);}
    phase='validation';
    workspace=assembleReviewWorkspace(choice.message.content??'',claim.currentJD);
    category='success';outcome={state:'succeeded',result:workspace.proposal,...usage};
  } catch (error) {
    if(!(error instanceof BriefError)) {
      // Our own deadline firing is a timeout, whatever error class the SDK wraps it in.
      if(deadline?.aborted || (error instanceof Error && (/Timeout|Abort/.test(error.name) || /Timeout|Abort/.test(error.constructor?.name??'')))) category='timeout';
      else if(phase==='provider') {
        const status=(error as {status?:unknown}|null)?.status;
        if(typeof status==='number' && Number.isInteger(status) && status>=100 && status<=599) {httpStatus=status;category='provider_http';}
        else category='provider_transport';
      } else if(phase==='validation') category=error instanceof BriefReviewError?'extraction_invalid':error instanceof ExtractionError?error.category:error instanceof SyntaxError?'json_invalid':error instanceof ZodError?'schema_invalid':
        error instanceof Error && error.message==='BRIEF_INVALID_SOURCE_SPAN'?'source_span_invalid':'internal_failure';
    }
    const code=error instanceof BriefError?error.code:
      category==='timeout'?'BRIEF_MODEL_TIMEOUT':
      ['extraction_invalid','extraction_incomplete','quote_missing','final_validation_invalid','json_invalid','schema_invalid','source_span_invalid'].includes(category)?'BRIEF_MODEL_INVALID':'BRIEF_MODEL_FAILED';
    outcome={state:'failed',code,...usage};
  }
  // Claim's transaction ended before the provider call. No lease/token leaves this module.
  try {
    const result=await (workspace ? repository.call('finishReview',[claim.requestId,claim.lease,outcome,workspace])
      : repository.call('finish',[claim.requestId,claim.lease,outcome])) as {state?:string};
    diagnostic(['succeeded','review_required','failed','stale','unknown'].includes(result.state??'')?result.state!:'unknown');
    return result;
  } catch(error) {phase='settlement';category='settlement_unconfirmed';diagnostic('unconfirmed');throw error;}
}
