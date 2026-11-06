import { describe, expect, it, vi } from 'vitest';
import { extractResumeForOrdinaryIngest,analyseResumePdfPages,checkResumeForSparkReading } from '../resumeIngestExtraction';
import PDFDocument from 'pdfkit';
import {createHash} from 'node:crypto';

const validText = 'Experienced software engineer delivering reliable distributed systems with testing and ownership.';
const pdf = Buffer.from('%PDF-1.7\nsynthetic');
const doc = Buffer.from('D0CF synthetic doc');
const docx = Buffer.from('PK synthetic docx');

function native(input: { success: boolean; text?: string; error?: string }) {
  return vi.fn(async () => ({ text: input.text ?? '', success: input.success, error: input.error }));
}

function ocr(input: { success: boolean; text?: string; reasonCode?: any; providerCalls?: number }) {
  return vi.fn(async () => ({
    success: input.success,
    text: input.text ?? '',
    providerCalls: input.providerCalls ?? 2,
    reasonCode: input.reasonCode,
  }));
}

describe('ordinary-ingest native-to-OCR extraction', () => {
  it('restores full OCR for footer-only ordinary PDFs and reports empty Spark text explicitly',async()=>{
    const beforeOcr=vi.fn(),extractOcr=vi.fn(async()=>({success:true,text:validText,providerCalls:2,pageTexts:[{pageNumber:1,text:validText}]}));
    const dependencies={extractNative:native({success:false}),analysePdf:async()=>['Page 1'],extractOcr};
    expect(await extractResumeForOrdinaryIngest(pdf,{beforeOcr},dependencies)).toMatchObject({success:true,text:validText});
    expect(beforeOcr.mock.calls[0][0].pageNumbers).toEqual([1]);
    expect(await extractResumeForOrdinaryIngest(pdf,{beforeOcr,requireComplete:true},dependencies)).toMatchObject({success:false,reasonCode:'NO_EXTRACTABLE_TEXT'});
  });
  it('preserves the legacy parser fallback on page analysis failure for ordinary applications only',async()=>{
    const extractNative=native({success:true,text:validText});
    const dependencies={extractNative,analysePdf:async()=>{throw Error('broken parser');},extractOcr:ocr({success:false})};
    expect(await extractResumeForOrdinaryIngest(pdf,{beforeOcr:vi.fn()},dependencies)).toMatchObject({success:true,text:validText});
    extractNative.mockClear();
    expect(await extractResumeForOrdinaryIngest(pdf,{beforeOcr:vi.fn(),requireComplete:true},dependencies)).toMatchObject({success:false,reasonCode:'OCR_PAGE_COUNT_REFUSED'});
    expect(extractNative).not.toHaveBeenCalled();
  });
  it.each(['OCR_DISABLED','OCR_NOT_CONFIGURED'] as const)('does not reserve a paid slot when %s',async reason=>{
    const beforeOcr=vi.fn(),extractOcr=ocr({success:false});
    const result=await extractResumeForOrdinaryIngest(pdf,{beforeOcr,requireComplete:true},{extractNative:native({success:false}),analysePdf:async()=>[''],extractOcr,ocrUnavailable:()=>reason});
    expect(result.reasonCode).toBe(reason);expect(beforeOcr).not.toHaveBeenCalled();expect(extractOcr).not.toHaveBeenCalled();
  });
  it('applies the existing PII setting to complete and partial native PDF paths',async()=>{
    vi.stubEnv('AI_STRIP_PII','true');
    try{
      vi.resetModules();
      const {extractResumeForOrdinaryIngest:extract}=await import('../resumeIngestExtraction');
      for(const pages of [[validText+' a@example.com https://linkedin.com/in/a'],[validText+' a@example.com','']]){
        const result=await extract(pdf,{beforeOcr:vi.fn()},{extractNative:native({success:false}),analysePdf:async()=>pages,extractOcr:ocr({success:false})});
        expect(result.text).not.toContain('a@example.com');expect(result.text).toContain('[EMAIL]');
      }
    }finally{vi.unstubAllEnvs();vi.resetModules();}
  });
  it('selects only empty pages, reserves the exact plan and merges in document order',async()=>{
    const beforeOcr=vi.fn(async()=>undefined),extractOcr=vi.fn(async()=>({success:true,text:'unused',providerCalls:2,
      pageTexts:[{pageNumber:2,text:'Scanned role with Go systems'}]}));
    const result=await extractResumeForOrdinaryIngest(pdf,{beforeOcr,requireComplete:true},{extractNative:native({success:false}),
      analysePdf:async()=>[validText,'','Final native page'],extractOcr});
    const plan={schemaVersion:1,contentHash:createHash('sha256').update(pdf).digest('hex'),totalPages:3,pageNumbers:[2]};
    expect(beforeOcr).toHaveBeenCalledWith(plan);expect(extractOcr).toHaveBeenCalledWith(pdf,plan);
    expect(result).toMatchObject({success:true,partial:false,text:[validText,'Scanned role with Go systems','Final native page'].join('\n\n')});
  });
  it('preserves ordinary native text as partial without adding a paid call',async()=>{
    const beforeOcr=vi.fn(),extractOcr=ocr({success:false});
    expect(await extractResumeForOrdinaryIngest(pdf,{beforeOcr},{extractNative:native({success:false}),analysePdf:async()=>[validText,''],extractOcr}))
      .toMatchObject({success:true,partial:true,text:validText+'\n\n',providerCalls:0});
    expect(beforeOcr).not.toHaveBeenCalled();expect(extractOcr).not.toHaveBeenCalled();
  });
  it('complete Spark extraction refuses partial text after OCR failure',async()=>{
    const result=await extractResumeForOrdinaryIngest(pdf,{beforeOcr:async()=>{},requireComplete:true},
      {extractNative:native({success:false}),analysePdf:async()=>[validText,''],extractOcr:ocr({success:false,reasonCode:'OCR_TIMEOUT'})});
    expect(result).toMatchObject({success:false,partial:true,text:'',reasonCode:'OCR_TIMEOUT'});
  });
  it('a short text-bearing page is not selected for OCR',async()=>{
    const beforeOcr=vi.fn();
    const result=await extractResumeForOrdinaryIngest(pdf,{beforeOcr,requireComplete:true},
      {extractNative:native({success:false}),analysePdf:async()=>['Short',validText],extractOcr:ocr({success:false})});
    expect(result.success).toBe(true);expect(beforeOcr).not.toHaveBeenCalled();
  });
  it('refuses a mixed PDF above ten pages before a paid call',async()=>{
    const beforeOcr=vi.fn(),extractOcr=ocr({success:false});
    const result=await extractResumeForOrdinaryIngest(pdf,{beforeOcr,requireComplete:true},
      {extractNative:native({success:false}),analysePdf:async()=>[...Array(10).fill(validText),''],extractOcr});
    expect(result).toMatchObject({success:false,reasonCode:'OCR_PAGE_CEILING_REFUSED'});expect(beforeOcr).not.toHaveBeenCalled();expect(extractOcr).not.toHaveBeenCalled();
  });
  it('all-native PDFs read past page ten with fresh independent parser documents',async()=>{
    const makePdf=async(label:string)=>{
      const document=new PDFDocument({autoFirstPage:false}),chunks:Buffer[]=[];
      const done=new Promise<Buffer>((resolve,reject)=>{document.on('data',b=>chunks.push(b));document.on('end',()=>resolve(Buffer.concat(chunks)));document.on('error',reject);});
      for(let n=1;n<=11;n++){document.addPage();document.text(`${label} ${n} ${validText}`);}
      document.end();return done;
    };
    const [a,b]=await Promise.all([makePdf('ALPHA'),makePdf('BETA')]);
    const [first,second]=await Promise.all([analyseResumePdfPages(a),analyseResumePdfPages(b)]);
    expect(first).toHaveLength(11);expect(first[10]).toContain('ALPHA 11');expect(first.join('')).not.toContain('BETA');
    expect(second[10]).toContain('BETA 11');expect(second.join('')).not.toContain('ALPHA');
    const beforeOcr=vi.fn();const result=await extractResumeForOrdinaryIngest(a,{beforeOcr,requireComplete:true});
    expect(result.success).toBe(true);expect(result.text).toContain('ALPHA 11');expect(beforeOcr).not.toHaveBeenCalled();
  });
  it.each([
    ['PDF', pdf],
    ['DOCX', docx],
  ])('returns valid native %s text without privacy-provider or OCR work', async (_label, buffer) => {
    const beforeOcr = vi.fn(async () => undefined);
    const extractOcr = ocr({ success: true, text: validText });
    const result = await extractResumeForOrdinaryIngest(buffer, { beforeOcr }, {
      extractNative: native({ success: true, text: validText }),
      extractOcr,
    });
    expect(result).toEqual({ success: true, text: validText, method: 'native_text', providerCalls: 0 });
    expect(beforeOcr).not.toHaveBeenCalled();
    expect(extractOcr).not.toHaveBeenCalled();
  });

  it('uses OCR once when native PDF extraction throws', async () => {
    const beforeOcr = vi.fn(async () => undefined);
    const extractOcr = ocr({ success: true, text: validText });
    const result = await extractResumeForOrdinaryIngest(pdf, { beforeOcr }, {
      extractNative: vi.fn(async () => { throw new Error('secret native parser detail'); }),
      extractOcr,
    });
    expect(result).toEqual({
      success: true,
      text: validText,
      method: 'google_vision_ocr',
      providerCalls: 2,
    });
    expect(beforeOcr).toHaveBeenCalledTimes(1);
    expect(extractOcr).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('removes only embedded NUL from native text', async () => {
    const text = `${validText}\u0000\nUnicode résumé\tretained`;
    const result = await extractResumeForOrdinaryIngest(pdf, { beforeOcr: async () => undefined }, {
      extractNative: native({ success: true, text }),
      extractOcr: ocr({ success: false }),
    });
    expect(result.text).toBe(text.replace(/\u0000/gu, ''));
    expect(result.text).toContain('\nUnicode résumé\tretained');
  });

  it.each([
    { label: 'empty', nativeText: '' },
    { label: 'sub-threshold', nativeText: 'short' },
  ])('uses OCR once after a fresh privacy callback for native-$label PDF', async ({ nativeText }) => {
    const order: string[] = [];
    const extractOcr = vi.fn(async () => {
      order.push('ocr');
      return { success: true, text: validText, providerCalls: 2 };
    });
    const result = await extractResumeForOrdinaryIngest(pdf, {
      beforeOcr: async () => { order.push('privacy'); },
    }, {
      extractNative: native({ success: true, text: nativeText }),
      extractOcr,
    });
    expect(order).toEqual(['privacy', 'ocr']);
    expect(result).toEqual({
      success: true,
      text: validText,
      method: 'google_vision_ocr',
      providerCalls: 2,
    });
  });

  it('never invokes OCR for an invalid non-PDF', async () => {
    const beforeOcr = vi.fn(async () => undefined);
    const extractOcr = ocr({ success: true, text: validText });
    const result = await extractResumeForOrdinaryIngest(doc, { beforeOcr }, {
      extractNative: native({ success: true, text: 'short' }),
      extractOcr,
    });
    expect(result).toMatchObject({ success: false, method: 'none', providerCalls: 0, reasonCode: 'NO_EXTRACTABLE_TEXT' });
    expect(result.text).toBe('');
    expect(beforeOcr).not.toHaveBeenCalled();
    expect(extractOcr).not.toHaveBeenCalled();
  });

  it('distinguishes an unsupported native type without OCR', async () => {
    const result = await extractResumeForOrdinaryIngest(doc, { beforeOcr: async () => undefined }, {
      extractNative: native({ success: false, error: 'secret unsupported detail' }),
      extractOcr: ocr({ success: true, text: validText }),
    });
    expect(result).toEqual({
      success: false,
      text: '',
      method: 'none',
      providerCalls: 0,
      reasonCode: 'NATIVE_UNSUPPORTED_FOR_OCR',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('records native-plus-OCR no-text truthfully', async () => {
    const result = await extractResumeForOrdinaryIngest(pdf, { beforeOcr: async () => undefined }, {
      extractNative: native({ success: false }),
      extractOcr: ocr({ success: true, text: '' }),
    });
    expect(result).toEqual({
      success: false,
      text: '',
      method: 'none',
      providerCalls: 2,
      reasonCode: 'NO_EXTRACTABLE_TEXT',
    });
  });

  it('removes only embedded NUL from OCR text and preserves tabs, newlines, and Unicode', async () => {
    const text = `${validText}\u0000\nUnicode résumé\tretained`;
    const result = await extractResumeForOrdinaryIngest(pdf, { beforeOcr: async () => undefined }, {
      extractNative: native({ success: false }),
      extractOcr: ocr({ success: true, text }),
    });
    expect(result.success).toBe(true);
    expect(result.text).toBe(text.replace(/\u0000/gu, ''));
    expect(result.text).toContain('\nUnicode résumé\tretained');
  });

  it.each([
    'OCR_DISABLED',
    'OCR_NOT_CONFIGURED',
    'OCR_PAGE_COUNT_REFUSED',
    'OCR_PAGE_CEILING_REFUSED',
    'OCR_AUTH_REFUSED',
    'OCR_TIMEOUT',
    'OCR_PROVIDER_REFUSED',
    'OCR_OUTPUT_REFUSED',
  ])('preserves constant OCR failure %s', async (reasonCode) => {
    const result = await extractResumeForOrdinaryIngest(pdf, { beforeOcr: async () => undefined }, {
      extractNative: native({ success: false }),
      extractOcr: ocr({ success: false, reasonCode, providerCalls: 1 }),
    });
    expect(result).toMatchObject({ success: false, text: '', method: 'none', providerCalls: 1, reasonCode });
  });

  it('collapses arbitrary OCR exceptions and never leaks their message', async () => {
    const result = await extractResumeForOrdinaryIngest(pdf, { beforeOcr: async () => undefined }, {
      extractNative: native({ success: false }),
      extractOcr: async () => { throw new Error('secret provider body and candidate text'); },
    });
    expect(result.reasonCode).toBe('OCR_PROVIDER_REFUSED');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('propagates a privacy refusal before provider work', async () => {
    const extractOcr = ocr({ success: true, text: validText });
    await expect(extractResumeForOrdinaryIngest(pdf, {
      beforeOcr: async () => { throw new Error('candidate_privacy_restricted'); },
    }, {
      extractNative: native({ success: false }),
      extractOcr,
    })).rejects.toThrow('candidate_privacy_restricted');
    expect(extractOcr).not.toHaveBeenCalled();
  });
});

describe('B3 Spark library upload check: never OCRs', () => {
  const okOcr = () => vi.fn(async () => ({ success: true, text: validText, providerCalls: 1, pageTexts: [{ pageNumber: 2, text: validText }] }));
  it.each([
    ['fully scanned PDF', async () => ['', ''], 'needs_spark_reading'],
    ['mixed PDF (would be partial text for ordinary ingest)', async () => [validText, ''], 'needs_spark_reading'],
    ['native PDF', async () => [validText], 'text'],
    // Ordinary ingest would pay full unbudgeted OCR for these two; a Spark upload refuses instead.
    ['footer-only scan Spark cannot read', async () => ['Page 1'], 'unreadable'],
    ['PDF the parser cannot open', async () => { throw Error('broken parser'); }, 'unreadable'],
    ['over the 10-page ceiling keeps its native text', async () => [...Array(10).fill(validText), ''], 'text'],
  ])('%s', async (_label, analysePdf, state) => {
    const extractOcr = okOcr();
    const result = await checkResumeForSparkReading(pdf, { extractNative: native({ success: false }), analysePdf, extractOcr });
    expect(result.state).toBe(state);
    if (result.state === 'text') expect(result.result).toMatchObject({ success: true, method: 'native_text', providerCalls: 0 });
    expect(extractOcr).not.toHaveBeenCalled();
  });
  it('OCR switched off keeps the ordinary failure and makes no call', async () => {
    const extractOcr = okOcr();
    expect(await checkResumeForSparkReading(pdf, { extractNative: native({ success: false }), analysePdf: async () => [''],
      extractOcr, ocrUnavailable: () => 'OCR_DISABLED' })).toMatchObject({ state: 'failed', result: { success: false, reasonCode: 'OCR_DISABLED', providerCalls: 0 } });
    expect(extractOcr).not.toHaveBeenCalled();
  });
  it('the upload route never reaches the OCR-capable ordinary extraction for a Spark upload', async () => {
    const { readFileSync } = await import('node:fs');
    const route = readFileSync(new URL('../../ai.routes.ts', import.meta.url), 'utf8');
    const spark = route.slice(route.indexOf('if (sparkReading) {'), route.indexOf('if (!extractionResult) {'));
    // Every Spark outcome assigns a result, so the ordinary (OCR) call below is skipped.
    for (const anchor of ["check.state === 'needs_spark_reading') extractionResult =", "check.state === 'unreadable') extractionResult =", 'else extractionResult = check.result;'])
      expect(spark).toContain(anchor);
    expect(spark).not.toContain('extractResumeForOrdinaryIngest');
  });
  it('a Word file with text is read natively; an empty one keeps the ordinary failure', async () => {
    const extractOcr = okOcr();
    expect((await checkResumeForSparkReading(docx, { extractNative: native({ success: true, text: validText }), extractOcr })).state).toBe('text');
    expect(await checkResumeForSparkReading(docx, { extractNative: native({ success: true, text: '' }), extractOcr }))
      .toMatchObject({ state: 'failed', result: { reasonCode: 'NO_EXTRACTABLE_TEXT', providerCalls: 0 } });
    expect(extractOcr).not.toHaveBeenCalled();
  });
});
