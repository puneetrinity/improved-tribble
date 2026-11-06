import {
  extractTextWithGoogleVisionIngestOcr,
  type GoogleVisionIngestOcrResult,
  type PdfOcrPlan,
} from './googleVisionIngestOcrClient';
import { createHash } from 'node:crypto';
import { extractResumeText, stripPII, validateResumeText } from './resumeExtractor';

export type ResumeIngestExtractionMethod = 'native_text' | 'google_vision_ocr' | 'none';

export type ResumeIngestExtractionReasonCode =
  | 'NATIVE_UNSUPPORTED_FOR_OCR'
  | 'OCR_DISABLED'
  | 'OCR_NOT_CONFIGURED'
  | 'OCR_PAGE_COUNT_REFUSED'
  | 'OCR_PAGE_CEILING_REFUSED'
  | 'OCR_AUTH_REFUSED'
  | 'OCR_TIMEOUT'
  | 'OCR_PROVIDER_REFUSED'
  | 'OCR_OUTPUT_REFUSED'
  | 'NO_EXTRACTABLE_TEXT';

export type ResumeIngestExtractionResult = {
  success: boolean;
  text: string;
  method: ResumeIngestExtractionMethod;
  providerCalls: number;
  partial?: boolean;
  reasonCode?: ResumeIngestExtractionReasonCode;
};

type ExtractionDependencies = {
  extractNative: typeof extractResumeText;
  extractOcr: (buffer: Buffer, plan?: PdfOcrPlan) => Promise<GoogleVisionIngestOcrResult>;
  analysePdf?: ((buffer:Buffer)=>Promise<string[]>)|undefined;
  ocrUnavailable?: ()=>ResumeIngestExtractionReasonCode|undefined;
};

/** Fresh parser per document; full native text, never the legacy first-10-pages slice. */
export async function analyseResumePdfPages(buffer:Buffer):Promise<string[]> {
  if(buffer.length<1||buffer.length>5*1024*1024)throw Error('OCR_PAGE_COUNT_REFUSED');
  let loading:any,document:any,timer:NodeJS.Timeout|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('OCR_TIMEOUT')),10_000);});
  const bounded=<T>(p:Promise<T>)=>Promise.race([p,timeout]);
  try{
    const pdfjs:any=await bounded(import('pdfjs-dist/legacy/build/pdf.mjs'));
    loading=pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:false});
    document=await bounded(loading.promise);
    if(!Number.isSafeInteger(document.numPages)||document.numPages<1)throw Error('OCR_PAGE_COUNT_REFUSED');
    const texts:string[]=[];let bytes=0;
    for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
      const page:any=await bounded(document.getPage(pageNumber));
      try{
        const content:any=await bounded(page.getTextContent());
        const text=sanitizeForPostgres(content.items.map((item:any)=>typeof item.str==='string'?item.str+(item.hasEOL?'\n':' '):'').join('')).trim();
        bytes+=Buffer.byteLength(text,'utf8')+2;
        if(bytes>512*1024)throw Error('OCR_OUTPUT_REFUSED');
        texts.push(text);
      }finally{page.cleanup();}
    }
    return texts;
  }finally{
    if(timer)clearTimeout(timer);
    try{void Promise.resolve(document?.destroy()).catch(()=>{});}catch{}
    try{void Promise.resolve(loading?.destroy()).catch(()=>{});}catch{}
  }
}

async function extractPdfPages(buffer:Buffer,options:{beforeOcr:(plan?:PdfOcrPlan)=>Promise<void>;requireComplete?:boolean},dependencies:ExtractionDependencies):Promise<ResumeIngestExtractionResult>{
  let pages:string[];
  try{pages=await dependencies.analysePdf!(buffer);}catch(error){
    // Spark cannot reserve an unknown page plan. Ordinary ingest retains its
    // original parser/OCR fallback; this is not a second paid attempt.
    if(!options.requireComplete)return extractResumeForOrdinaryIngest(buffer,options,{...dependencies,analysePdf:undefined});
    return {success:false,text:'',method:'none',providerCalls:0,reasonCode:error instanceof Error&&error.message==='OCR_TIMEOUT'?'OCR_TIMEOUT':'OCR_PAGE_COUNT_REFUSED'};
  }
  const nativeText=pages.join('\n\n');
  let pageNumbers=pages.flatMap((text,index)=>text.trim()?[]:[index+1]);
  if(pageNumbers.length===0&&validateResumeText(nativeText))return {success:true,text:stripPII(nativeText),method:'native_text',providerCalls:0};
  // Preserve legacy full OCR for ordinary footer-only/short-text documents.
  if(!options.requireComplete&&!validateResumeText(nativeText))pageNumbers=pages.map((_,index)=>index+1);
  if(pageNumbers.length===0)return {success:false,text:'',method:'none',providerCalls:0,reasonCode:'NO_EXTRACTABLE_TEXT'};
  // Ordinary applications previously accepted this native text without paid OCR.
  // Preserve that behaviour; Spark asks for a complete extraction explicitly.
  if(!options.requireComplete&&validateResumeText(nativeText))return {success:true,text:stripPII(nativeText),method:'native_text',providerCalls:0,partial:true};
  const failed=(reasonCode:ResumeIngestExtractionReasonCode,providerCalls=0):ResumeIngestExtractionResult=>
    !options.requireComplete&&validateResumeText(nativeText)
      ?{success:true,text:stripPII(nativeText),method:'native_text',providerCalls,partial:true,reasonCode}
      :{success:false,text:'',method:'none',providerCalls,partial:true,reasonCode};
  if(pages.length>10)return failed('OCR_PAGE_CEILING_REFUSED');
  const unavailable=dependencies.ocrUnavailable?.();
  if(unavailable)return failed(unavailable);
  const plan:PdfOcrPlan=Object.freeze({schemaVersion:1,contentHash:createHash('sha256').update(buffer).digest('hex'),totalPages:pages.length,pageNumbers:Object.freeze(pageNumbers)});
  await options.beforeOcr(plan);
  let result:GoogleVisionIngestOcrResult;
  try{result=await dependencies.extractOcr(buffer,plan);}catch{return failed('OCR_PROVIDER_REFUSED');}
  if(!result.success)return failed(result.reasonCode??'OCR_PROVIDER_REFUSED',result.providerCalls);
  const returned=result.pageTexts;
  if(!returned||returned.length!==pageNumbers.length||returned.some((p,i)=>p.pageNumber!==pageNumbers[i]||typeof p.text!=='string'))return failed('OCR_OUTPUT_REFUSED',result.providerCalls);
  const merged=[...pages];for(const p of returned)merged[p.pageNumber-1]=sanitizeForPostgres(p.text);
  const text=merged.join('\n\n');
  if(Buffer.byteLength(text,'utf8')>512*1024)return failed('OCR_OUTPUT_REFUSED',result.providerCalls);
  if(!validateResumeText(text))return failed('NO_EXTRACTABLE_TEXT',result.providerCalls);
  return {success:true,text:stripPII(text),method:'google_vision_ocr',providerCalls:result.providerCalls,partial:false};
}

function sanitizeForPostgres(value: string): string {
  return value.replace(/\u0000/gu, '');
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from('%PDF-'));
}

export async function extractResumeForOrdinaryIngest(
  buffer: Buffer,
  options: { beforeOcr: (plan?:PdfOcrPlan) => Promise<void>; requireComplete?: boolean },
  dependencies: ExtractionDependencies = {
    extractNative: extractResumeText,
    extractOcr: extractTextWithGoogleVisionIngestOcr,
    analysePdf: analyseResumePdfPages,
    ocrUnavailable:()=>process.env.GOOGLE_VISION_OCR_ENABLED!=='true'?'OCR_DISABLED'
      :!process.env.GCS_SERVICE_ACCOUNT_KEY||!process.env.GCS_PROJECT_ID?'OCR_NOT_CONFIGURED':undefined,
  },
): Promise<ResumeIngestExtractionResult> {
  if(isPdf(buffer)&&dependencies.analysePdf)return extractPdfPages(buffer,options,dependencies);
  let nativeText = '';
  let nativeSucceeded = false;
  try {
    const native = await dependencies.extractNative(buffer);
    nativeSucceeded = native.success;
    nativeText = sanitizeForPostgres(native.text ?? '');
    if (native.success && validateResumeText(nativeText)) {
      return {
        success: true,
        text: stripPII(nativeText),
        method: 'native_text',
        providerCalls: 0,
      };
    }
  } catch {
    nativeText = '';
  }

  if (!isPdf(buffer)) {
    return {
      success: false,
      text: '',
      method: 'none',
      providerCalls: 0,
      reasonCode: nativeSucceeded ? 'NO_EXTRACTABLE_TEXT' : 'NATIVE_UNSUPPORTED_FOR_OCR',
    };
  }

  const unavailable=dependencies.ocrUnavailable?.();
  if(unavailable)return {success:false,text:'',method:'none',providerCalls:0,reasonCode:unavailable};
  await options.beforeOcr();
  let ocr: GoogleVisionIngestOcrResult;
  try {
    ocr = await dependencies.extractOcr(buffer);
  } catch {
    return {
      success: false,
      text: '',
      method: 'none',
      providerCalls: 0,
      reasonCode: 'OCR_PROVIDER_REFUSED',
    };
  }
  if (!ocr.success) {
    return {
      success: false,
      text: '',
      method: 'none',
      providerCalls: ocr.providerCalls,
      reasonCode: ocr.reasonCode ?? 'OCR_PROVIDER_REFUSED',
    };
  }

  const sanitized = sanitizeForPostgres(ocr.text);
  if (!validateResumeText(sanitized)) {
    return {
      success: false,
      text: '',
      method: 'none',
      providerCalls: ocr.providerCalls,
      reasonCode: 'NO_EXTRACTABLE_TEXT',
    };
  }
  return {
    success: true,
    text: stripPII(sanitized),
    method: 'google_vision_ocr',
    providerCalls: ocr.providerCalls,
  };
}

class SparkReadingDeferred extends Error { constructor() { super('spark_reading_deferred'); } }

export type SparkUploadCheck =
  | { state: 'text'; result: ResumeIngestExtractionResult }
  | { state: 'needs_spark_reading' }
  | { state: 'failed'; result: ResumeIngestExtractionResult }
  | { state: 'unreadable' };

/** B3: library upload made for Spark. Never calls OCR, so no Vision spend can
 * happen outside Spark's budget. If Spark would need OCR, the file is accepted
 * without text and Spark's budgeted reader reads it once and saves that text
 * back to the library. If Spark cannot read the file (e.g. footer-only scan,
 * unparseable PDF), ordinary extraction runs with OCR forbidden: native text is
 * kept, and a file that would need unbudgeted OCR is refused as 'unreadable'. */
export async function checkResumeForSparkReading(
  buffer: Buffer,
  dependencies?: ExtractionDependencies,
): Promise<SparkUploadCheck> {
  const defer = async () => { throw new SparkReadingDeferred(); };
  const run = async (requireComplete: boolean) => {
    try { return await extractResumeForOrdinaryIngest(buffer, { beforeOcr: defer, requireComplete }, dependencies); }
    catch (error) { if (error instanceof SparkReadingDeferred) return null; throw error; }
  };
  const complete = await run(true);
  if (complete === null) return { state: 'needs_spark_reading' };
  if (complete.success) return { state: 'text', result: complete };
  const ordinary = await run(false);
  if (ordinary === null) return { state: 'unreadable' };
  return ordinary.success ? { state: 'text', result: ordinary } : { state: 'failed', result: ordinary };
}
