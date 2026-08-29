import {
  extractTextWithGoogleVisionIngestOcr,
  type GoogleVisionIngestOcrResult,
} from './googleVisionIngestOcrClient';
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
  reasonCode?: ResumeIngestExtractionReasonCode;
};

type ExtractionDependencies = {
  extractNative: typeof extractResumeText;
  extractOcr: (buffer: Buffer) => Promise<GoogleVisionIngestOcrResult>;
};

function sanitizeForPostgres(value: string): string {
  return value.replace(/\u0000/gu, '');
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from('%PDF-'));
}

export async function extractResumeForOrdinaryIngest(
  buffer: Buffer,
  options: { beforeOcr: () => Promise<void> },
  dependencies: ExtractionDependencies = {
    extractNative: extractResumeText,
    extractOcr: extractTextWithGoogleVisionIngestOcr,
  },
): Promise<ResumeIngestExtractionResult> {
  let nativeText = '';
  let nativeSucceeded = false;
  try {
    const native = await dependencies.extractNative(buffer);
    nativeSucceeded = native.success;
    nativeText = sanitizeForPostgres(native.text ?? '');
    if (native.success && validateResumeText(nativeText)) {
      return {
        success: true,
        text: nativeText,
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
