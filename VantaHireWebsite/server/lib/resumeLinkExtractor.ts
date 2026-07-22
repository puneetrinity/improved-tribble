/**
 * Resume Link Extractor
 *
 * Extracts and classifies URLs found in resumes.
 * Three extraction strategies:
 * 1. PDF annotation extraction — pulls actual hyperlink targets from PDF metadata
 *    (gives the real URL, e.g. linkedin.com/in/arpit-mishra-7a1823277/)
 * 2. DOCX hyperlink extraction — converts to HTML via mammoth to get <a href> targets
 * 3. Text-based regex fallback — parses visible text for URL patterns
 *    (used for legacy DOC or when other strategies fail)
 *
 * Identifies LinkedIn, GitHub, and Medium profile URLs specifically;
 * all other URLs are grouped under otherLinks.
 */

export interface ResumeLinks {
  linkedinUrl: string | null;
  githubUrl: string | null;
  mediumUrl: string | null;
  otherLinks: string[];
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function isLinkedIn(url: string): boolean {
  return /linkedin\.com\/[a-zA-Z0-9_-]+/i.test(url) &&
    !/linkedin\.com\/(company|jobs|posts|pulse|learning|feed|messaging)\b/i.test(url);
}

function isGitHub(url: string): boolean {
  return /github\.com\/[a-zA-Z0-9_-]+/i.test(url) &&
    !/github\.com\/(orgs|enterprise|pricing|features|security)\b/i.test(url);
}

function isMedium(url: string): boolean {
  return /medium\.com\/@?[a-zA-Z0-9_-]+/i.test(url) ||
    /[a-zA-Z0-9_-]+\.medium\.com/i.test(url);
}

function isMailto(url: string): boolean {
  return /^mailto:/i.test(url);
}

/**
 * Classify a list of URLs into the ResumeLinks structure.
 * Deduplicates and picks the first match per platform.
 */
function classifyUrls(urls: string[]): ResumeLinks {
  const result: ResumeLinks = {
    linkedinUrl: null,
    githubUrl: null,
    mediumUrl: null,
    otherLinks: [],
  };

  const seen = new Set<string>();

  for (const url of urls) {
    const lower = url.toLowerCase();
    if (seen.has(lower) || isMailto(url)) continue;
    seen.add(lower);

    if (!result.linkedinUrl && isLinkedIn(url)) {
      result.linkedinUrl = url;
    } else if (!result.githubUrl && isGitHub(url)) {
      result.githubUrl = url;
    } else if (!result.mediumUrl && isMedium(url)) {
      result.mediumUrl = url;
    } else {
      result.otherLinks.push(url);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Strategy 1: PDF annotation extraction (real hyperlink targets)
// ---------------------------------------------------------------------------

/**
 * Extract actual hyperlink URLs from PDF annotations via pdf-parse's
 * pagerender callback, which exposes the underlying pdf.js page proxy.
 */
export async function extractLinksFromPdfBuffer(buffer: Buffer): Promise<string[]> {
  // pdfjs-dist with a fresh per-call document (see resumeExtractor.extractPDF:
  // the previous pdf-parse pagerender callback shares pdf.js state across
  // concurrent requests and can deliver ANOTHER request's pages to this
  // closure — link/text cross-contamination between applicants).
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const collectedUrls: string[] = [];
  try {
    const maxPages = Math.min(doc.numPages, 10);
    for (let p = 1; p <= maxPages; p++) {
      const page = await doc.getPage(p);
      const annotations = await page.getAnnotations();
      for (const annotation of annotations) {
        if (annotation.subtype === 'Link' && annotation.url) {
          collectedUrls.push(annotation.url);
        }
      }
    }
  } finally {
    await doc.destroy();
  }
  return collectedUrls;
}

// ---------------------------------------------------------------------------
// Strategy 2: DOCX hyperlink extraction (real hyperlink targets via HTML)
// ---------------------------------------------------------------------------

const HREF_REGEX = /href=["']([^"']+)["']/gi;

/**
 * Extract actual hyperlink URLs from DOCX by converting to HTML via mammoth.
 * mammoth produces <a href="..."> tags that contain real hyperlink targets.
 */
export async function extractLinksFromDocxBuffer(buffer: Buffer): Promise<string[]> {
  const mod: any = await import('mammoth');
  const convertToHtml = mod.convertToHtml || mod.default?.convertToHtml;
  const result = await convertToHtml({ buffer });
  const html: string = result.value || '';

  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = HREF_REGEX.exec(html)) !== null) {
    if (match[1]) {
      urls.push(match[1]);
    }
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Strategy 3: Text-based regex fallback
// ---------------------------------------------------------------------------

// Match http/https URLs, common bare-domain patterns, and standalone .dev/.io/.com domains
const URL_REGEX =
  /https?:\/\/[^\s,)<>\"'|]+|(?:www\.)?(?:linkedin\.com|github\.com|medium\.com)\/[^\s,)<>\"'|]+|[a-zA-Z0-9][-a-zA-Z0-9]*\.(?:dev|io|me|co|tech|app)\b/gi;

const TRAILING_JUNK = /[.\-:;!?)]+$/;

function cleanUrl(raw: string): string {
  let url = raw.replace(TRAILING_JUNK, '');
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  return url;
}

function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return matches.map(cleanUrl);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract and classify links from a resume file buffer.
 * Detects file type and uses the best strategy:
 * - PDF → annotation extraction (real hyperlink targets)
 * - DOCX → HTML conversion via mammoth (real hyperlink targets)
 * - DOC/unknown → text-based regex fallback
 *
 * Always falls back to text-based extraction if the primary strategy fails.
 */
export async function extractResumeLinksFromBuffer(
  buffer: Buffer,
  extractedText?: string,
): Promise<ResumeLinks> {
  // Detect file type from magic bytes
  const ft: any = await import('file-type');
  const detector = ft?.default?.fromBuffer || ft?.fromBuffer || ft?.fileTypeFromBuffer;
  const detected = detector ? await detector(buffer) : null;
  const mime = detected?.mime || '';
  const headerHex = buffer.slice(0, 8).toString('hex');
  const isOle2Doc = headerHex.startsWith('d0cf11e0a1b11ae1');

  // PDF: extract from annotations
  if (mime === 'application/pdf') {
    try {
      const urls = await extractLinksFromPdfBuffer(buffer);
      if (urls.length > 0) return classifyUrls(urls);
    } catch {}
  }

  // DOCX: extract from HTML conversion
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const urls = await extractLinksFromDocxBuffer(buffer);
      if (urls.length > 0) return classifyUrls(urls);
    } catch {}
  }

  // DOC (legacy OLE2) or any failure: fall back to text-based extraction
  return classifyUrls(extractUrlsFromText(extractedText || ''));
}

/**
 * Extract and classify links from resume text only.
 * Used when the file buffer is not available.
 */
export function extractResumeLinks(text: string): ResumeLinks {
  return classifyUrls(extractUrlsFromText(text));
}
