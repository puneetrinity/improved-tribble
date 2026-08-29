import { describe, expect, it, vi } from 'vitest';
import { extractResumeForOrdinaryIngest } from '../resumeIngestExtraction';

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
