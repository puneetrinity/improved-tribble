// Server-only parsing and hashing; browser and server share the exact schemas.
import {parseProfileJson,canonicalProfileJson} from './profile-contracts';
import {createHash} from 'node:crypto';
import {consentCaptureSchema,commandSchema,receiptSchema,storageReadSchema,consentProjectionSchema,saveResolutionRequestSchema,resumeTransferSchema,sourceReceiptSchema} from '../../shared/candidate-spark-v3';
export * from '../../shared/candidate-spark-v3';

export function parseSaveResolution(raw:string){
 if(Buffer.byteLength(raw,'utf8')>4096)throw Error('payload_too_large');
 const value=saveResolutionRequestSchema.parse(parseProfileJson(raw,4096));
 const canonical=canonicalProfileJson(value);
 return {value,canonical,hash:createHash('sha256').update(canonical).digest('hex')};
}

export function parseConsentCapture(raw:string){
 if(Buffer.byteLength(raw,'utf8')>4096)throw Error('payload_too_large');
 const value=consentCaptureSchema.parse(parseProfileJson(raw));
 const canonical=canonicalProfileJson(value);
 return {value,canonical,hash:createHash('sha256').update(canonical).digest('hex')};
}

export function parseCommand(raw:string) {
 const value=commandSchema.parse(parseProfileJson(raw));
 const canonical=canonicalProfileJson(value);
 if(Buffer.byteLength(canonical,'utf8')>384*1024)throw Error('payload_too_large');
 if(value.action==='save_draft'&&Buffer.byteLength(canonicalProfileJson(value.payload.profile),'utf8')>256*1024)throw Error('payload_too_large');
 if(value.action==='save_preference_section'&&Buffer.byteLength(canonicalProfileJson(value.payload),'utf8')>32*1024)throw Error('payload_too_large');
 return {value,canonical,hash:createHash('sha256').update(canonical).digest('hex')};
}

export function parseResponse(raw:string,kind:'receipt'|'storage_read') {
 const value=(kind==='receipt'?receiptSchema:storageReadSchema).parse(parseProfileJson(raw,600*1024));
 return {value,canonical:canonicalProfileJson(value)};
}

export function parseConsentProjection(raw:string) {
 const value=consentProjectionSchema.parse(parseProfileJson(raw,4096));
 const canonical=canonicalProfileJson(value);
 return {value,canonical,hash:createHash('sha256').update(canonical).digest('hex')};
}

function validateSourceTransfer(input:unknown,kind:'resume'|'professional_lookup'){
 const value=resumeTransferSchema.parse(input),proposal=value.proposal;
 const canonical=canonicalProfileJson(value);
 if(Buffer.byteLength(canonical,'utf8')>2*1024*1024||Buffer.byteLength(value.text,'utf8')>512*1024)throw Error('payload_too_large');
 if(createHash('sha256').update(value.text,'utf8').digest('hex')!==value.textHash)throw Error('text_hash_mismatch');
 if(proposal.sourceKind!==kind||proposal.sourceId!==value.sourceId||proposal.sourceVersion!==value.sourceVersion)throw Error('source_mismatch');
 if(kind!=='professional_lookup'&&proposal.facts.some(f=>f.kind==='photo'))throw Error('source_mismatch');
 if(kind==='professional_lookup'){
  if(value.policyVersion!=='rc-profile-v1'||value.contentHash!==value.textHash)throw Error('source_mismatch');
  const entries=proposal.facts.map(f=>({kind:f.kind,value:f.value}));
  if(canonicalProfileJson(entries)!==value.text)throw Error('lookup_evidence_mismatch');
  for(const fact of proposal.facts){
   if(fact.targetRowId!==null||fact.evidence.length!==1||fact.evidence[0]!.quote!==canonicalProfileJson({kind:fact.kind,value:fact.value}))throw Error('lookup_evidence_mismatch');
  }
 }
 const {proposalHash,...body}=proposal;
 if(createHash('sha256').update(canonicalProfileJson(body),'utf8').digest('hex')!==proposalHash)throw Error('proposal_hash_mismatch');
 for(const fact of proposal.facts)for(const evidence of fact.evidence){
  if(evidence.sourceId!==value.sourceId||evidence.sourceVersion!==value.sourceVersion||evidence.contentHash!==value.contentHash)throw Error('evidence_mismatch');
  const match=/^text:(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(evidence.locator);
  if(!match)throw Error('invalid_evidence_locator');
  const start=Number(match[1]),length=Number(match[2]);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||length<1||start+length>value.text.length||value.text.slice(start,start+length)!==evidence.quote)throw Error('quote_mismatch');
 }
 return {value,canonical,hash:createHash('sha256').update(canonical,'utf8').digest('hex')};
}

export const validateResumeTransfer=(input:unknown)=>validateSourceTransfer(input,'resume');
export const validateLookupTransfer=(input:unknown)=>validateSourceTransfer(input,'professional_lookup');
export const parseLookupTransfer=(raw:string)=>validateLookupTransfer(parseProfileJson(raw,2*1024*1024));

export function parseResumeTransfer(raw:string){
 return validateResumeTransfer(parseProfileJson(raw,2*1024*1024));
}

export function validateSourceReceipt(request:unknown,input:unknown,kind:'resume'|'professional_lookup'='resume'){
 const transfer=validateSourceTransfer(request,kind),value=sourceReceiptSchema.parse(input);
 for(const key of ['commandId','subjectId','bindingId','sourceId','sourceVersion'] as const)
  if(value[key]!==transfer.value[key])throw Error('receipt_mismatch');
 if(value.commandHash!==transfer.hash||value.proposalId!==transfer.value.proposal.proposalId||value.proposalHash!==transfer.value.proposal.proposalHash)throw Error('receipt_mismatch');
 return value;
}
