/**
 * Resume text extraction with PDF/DOCX parsing, timeouts, and PII stripping
 *
 * Features:
 * - PDF parsing via pdf-parse (dynamic import for CJS/ESM compatibility)
 * - DOCX parsing via mammoth (dynamic import)
 * - 30s timeout with graceful fallback
 * - 5MB file size limit
 * - Optional PII stripping (controlled by AI_STRIP_PII env var)
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const EXTRACTION_TIMEOUT_MS = 30_000; // 30 seconds
const STRIP_PII = process.env.AI_STRIP_PII === 'true';

export interface ExtractionResult {
  text: string;
  success: boolean;
  error?: string;
  piiStripped?: boolean;
}

export interface ExtractResumeTextOptions {
  stripPii?: boolean;
}

/**
 * Strip PII from resume text while preserving performance metrics
 *
 * Removes:
 * - Emails
 * - Phone numbers (context-aware)
 * - SSN patterns
 * - Script tags and URLs
 *
 * Preserves:
 * - Percentages (35%)
 * - Monetary values ($2M)
 * - Date ranges (2018-2023)
 * - Metrics (10,000 TPS)
 */
export function stripPII(text: string): string {
  if (!STRIP_PII) {
    return text;
  }

  return text
    // Remove emails
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
    // Remove phone numbers (context-aware - only near phone indicators)
    .replace(/\b(phone|mobile|tel|cell|contact):\s*\d{3}[-.]?\d{3}[-.]?\d{4}\b/gi, '$1: [PHONE]')
    .replace(/\b(phone|mobile|tel|cell|contact)\s*\d{3}[-.]?\d{3}[-.]?\d{4}\b/gi, '$1 [PHONE]')
    // Remove SSN patterns (XXX-XX-XXXX)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]')
    // Remove script tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove URLs
    .replace(/https?:\/\/[^\s]+/g, '[URL]')
    .trim();
}

/**
 * Extract text from PDF buffer
 */
async function extractPDF(buffer: Buffer): Promise<string> {
  // pdfjs-dist with a FRESH document per call. The previous library
  // (pdf-parse-debugging-disabled) shares internal pdf.js state across
  // invocations and cross-contaminates text between requests — application B
  // stored applicant A's resume text, which then propagated into the talent
  // graph (wrong resume attached to the wrong canonical person). Repro:
  // concurrent extracts returned the same document's text for 3 of 5 files.
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  try {
    const maxPages = Math.min(doc.numPages, 10);
    const pages: string[] = [];
    for (let p = 1; p <= maxPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      pages.push(tc.items.map((i: any) => i.str).join(' '));
    }
    return pages.join('\n');
  } finally {
    await doc.destroy();
  }
}

/**
 * Extract text from DOCX buffer
 */
async function extractDOCX(buffer: Buffer): Promise<string> {
  const mod: any = await import('mammoth');
  // mammoth exports extractRawText as both named export and on default
  const extractFn = mod.extractRawText || mod.default?.extractRawText;
  const result = await extractFn({ buffer });
  return result.value;
}

/**
 * Extract text from legacy DOC buffer via word-extractor
 */
async function extractDOC(buffer: Buffer): Promise<string> {
  const mod: any = await import('word-extractor');
  const WordExtractor = mod?.default || mod;
  const extractor = new WordExtractor();

  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `vh_doc_${Date.now()}_${Math.random().toString(36).slice(2)}.doc`);
  await fs.writeFile(tmpPath, buffer);
  try {
    const doc = await extractor.extract(tmpPath);
    const body = typeof doc.getBody === 'function' ? doc.getBody() : '';
    return String(body || '').trim();
  } finally {
    try { await fs.unlink(tmpPath); } catch {}
  }
}

/**
 * Extract text from resume file with timeout
 *
 * @param buffer - File buffer
 * @returns Extraction result with text and metadata
 */
async function extractResumeTextInternal(
  buffer: Buffer,
  options?: ExtractResumeTextOptions,
): Promise<ExtractionResult> {
  // Check file size
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      text: '',
      success: false,
      error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
    };
  }

  try {
    // Detect file type (support both CJS and ESM variations via dynamic import)
    const ft: any = await import('file-type');
    // file-type exports fromBuffer on default object in ESM
    const detector = ft?.default?.fromBuffer || ft?.fromBuffer || ft?.fileTypeFromBuffer;
    const detectedType = detector ? await detector(buffer) : null;
    const mimeType = detectedType?.mime || '';
    const headerHex = buffer.slice(0, 8).toString('hex');
    const isOle2Doc = headerHex.startsWith('d0cf11e0a1b11ae1');

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Extraction timeout after 30s')), EXTRACTION_TIMEOUT_MS);
    });

    // Create extraction promise
    let extractionPromise: Promise<string>;

    if (mimeType === 'application/pdf') {
      extractionPromise = extractPDF(buffer);
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      extractionPromise = extractDOCX(buffer);
    } else if (mimeType === 'application/msword' || isOle2Doc) {
      extractionPromise = extractDOC(buffer);
    } else {
      return {
        text: '',
        success: false,
        error: `Unsupported file type: ${mimeType || 'unknown'}. Only PDF, DOC, and DOCX are supported.`,
      };
    }

    // Race between extraction and timeout
    const rawText = await Promise.race([extractionPromise, timeoutPromise]);

    const shouldStripPii = options?.stripPii ?? STRIP_PII;
    const text = shouldStripPii ? stripPII(rawText) : rawText;

    return {
      text,
      success: true,
      piiStripped: shouldStripPii,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      text: '',
      success: false,
      error: `Extraction failed: ${errorMessage}`,
    };
  }
}

export async function extractResumeText(
  buffer: Buffer,
  options?: ExtractResumeTextOptions,
): Promise<ExtractionResult> {
  return extractResumeTextInternal(buffer, options);
}

export async function extractResumeTextRaw(buffer: Buffer): Promise<ExtractionResult> {
  return extractResumeTextInternal(buffer, { stripPii: false });
}

/**
 * Validate resume text quality
 *
 * Checks:
 * - Minimum 50 characters
 * - Not just whitespace/newlines
 * - Contains some alphabetic characters
 */
export function validateResumeText(text: string): boolean {
  if (!text || text.length < 50) {
    return false;
  }

  const trimmed = text.trim();
  if (trimmed.length < 50) {
    return false;
  }

  // Must contain at least some alphabetic characters
  const alphaCount = (text.match(/[a-zA-Z]/g) || []).length;
  return alphaCount >= 20;
}
