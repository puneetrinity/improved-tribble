import { Storage } from '@google-cloud/storage';
import { Request } from 'express';
import multer from 'multer';
import fileTypeMod from 'file-type';
import {createHash} from 'node:crypto';
import type {Readable} from 'node:stream';

// Initialize Google Cloud Storage
let storage: Storage | null = null;
let bucketName: string | null = null;

function parseServiceAccountKey(raw: string): Record<string, unknown> {
  // 1) direct JSON object string
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // 2) some loaders decode to a JSON string literal first
    if (typeof parsed === 'string') {
      const nested = JSON.parse(parsed);
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
      }
    }
  } catch {
    // continue to normalized parsing
  }

  // 3) handle over-escaped env formats like {\"type\":\"service_account\",...}
  const normalized = raw.replace(/\\"/g, '"').replace(/\\n/g, '\n');
  const reparsed = JSON.parse(normalized);
  if (reparsed && typeof reparsed === 'object' && !Array.isArray(reparsed)) {
    return reparsed as Record<string, unknown>;
  }
  throw new Error('Unable to parse GCS service account key');
}

try {
  const inlineKey = process.env.GCS_SERVICE_ACCOUNT_KEY;
  if (!process.env.GCS_PROJECT_ID || !process.env.GCS_BUCKET_NAME || !inlineKey) {
    console.warn('Google Cloud Storage environment variables not set. File uploads will be disabled.');
  } else {
    // Always load service account key from inline JSON env.
    const serviceAccountKey = parseServiceAccountKey(inlineKey);

    storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
      credentials: serviceAccountKey,
    });

    bucketName = process.env.GCS_BUCKET_NAME;
    console.log(`✅ Google Cloud Storage initialized: ${bucketName}`);
  }
} catch (error) {
  console.error('Error initializing Google Cloud Storage:', error);
  console.warn('File uploads will be disabled.');
}

// Multer configuration for file upload (memory storage)
const multerStorage = multer.memoryStorage();

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Basic MIME type check (can be spoofed - real validation happens in validateFileType)
  const allowed = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream', // Allow generic type, will validate with magic bytes
  ]);
  if (allowed.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOC, or DOCX files are allowed'));
  }
};

// Validate file type using magic bytes (more secure than MIME type)
async function validateFileType(buffer: Buffer): Promise<boolean> {
  try {
    const anyMod: any = fileTypeMod as any;
    const detector = anyMod?.fileTypeFromBuffer || anyMod?.fromBuffer;
    const fileType = detector ? await detector(buffer) : null;

    if (!fileType) {
      // Could be a text-based format like older DOC files
      // Check first few bytes for DOC signature
      const header = buffer.slice(0, 8).toString('hex');
      // DOC files start with D0CF11E0A1B11AE1 (OLE2 signature)
      if (header.startsWith('d0cf11e0a1b11ae1')) {
        return true;
      }
      return false;
    }

    // Allowed file types based on magic bytes
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const allowedExtensions = ['pdf', 'doc', 'docx'];

    return allowedTypes.includes(fileType.mime) || allowedExtensions.includes(fileType.ext);
  } catch (error) {
    console.error('Error validating file type:', error);
    return false;
  }
}

export const upload = multer({
  storage: multerStorage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

/**
 * Upload file to Google Cloud Storage
 * @param buffer - File buffer
 * @param originalName - Original filename
 * @returns Public GCS path (gs://bucket/path)
 */
export async function uploadToGCS(buffer: Buffer, originalName: string): Promise<string> {
  if (!storage || !bucketName) {
    throw new Error('Google Cloud Storage not configured');
  }

  // Validate file type using magic bytes (security check)
  const isValid = await validateFileType(buffer);
  if (!isValid) {
    throw new Error('Invalid file format. Only genuine PDF, DOC, or DOCX files are allowed.');
  }

  // Generate unique filename with timestamp
  const timestamp = Date.now();
  const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `resumes/${timestamp}_${sanitizedName}`;

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(filename);

  // Upload file to GCS
  await file.save(buffer, {
    metadata: {
      contentType: getContentType(originalName),
      metadata: {
        originalName: originalName,
        uploadedAt: new Date().toISOString(),
      },
    },
  });

  // Return the GCS path (we'll generate signed URLs for access)
  return `gs://${bucketName}/${filename}`;
}

/**
 * Delete file from Google Cloud Storage
 * @param gcsPath - Full GCS path (gs://bucket/path)
 */
export async function deleteFromGCS(gcsPath: string): Promise<void> {
  if (!storage) {
    throw new Error('Google Cloud Storage not configured');
  }

  // Extract bucket and filename from gs:// URL
  const match = gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error('Invalid GCS path format');
  }

  const [, bucket, filepath] = match;
  if (!bucket || !filepath) {
    throw new Error('Invalid GCS path components');
  }
  await storage.bucket(bucket).file(filepath).delete();
}

/**
 * Generate signed URL for downloading file from GCS
 * @param gcsPath - Full GCS path (gs://bucket/path)
 * @param filename - Original filename for download
 * @param expiresInMinutes - URL expiration time (default: 60 minutes)
 * @returns Signed URL for file download
 */
export async function getSignedDownloadUrl(
  gcsPath: string,
  filename?: string | null,
  expiresInMinutes: number = 60
): Promise<string> {
  if (!storage) {
    throw new Error('Google Cloud Storage not configured');
  }

  // Extract bucket and filename from gs:// URL
  const match = gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error('Invalid GCS path format');
  }

  const [, bucket, filepath] = match;
  if (!bucket || !filepath) {
    throw new Error('Invalid GCS path components');
  }
  const file = storage.bucket(bucket).file(filepath);

  // Generate signed URL valid for specified duration
  // Note: GCS SDK handles encoding of the responseDisposition parameter
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
    responseDisposition: filename
      ? `attachment; filename="${filename}"`
      : 'attachment',
  });

  return signedUrl;
}

/**
 * Generate signed URL for inline viewing from GCS
 * @param gcsPath - Full GCS path (gs://bucket/path)
 * @param expiresInMinutes - URL expiration time (default: 60 minutes)
 * @returns Signed URL for inline read (preview)
 */
export async function getSignedViewUrl(
  gcsPath: string,
  expiresInMinutes: number = 60
): Promise<string> {
  if (!storage) {
    throw new Error('Google Cloud Storage not configured');
  }

  const match = gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error('Invalid GCS path format');
  }

  const [, bucket, filepath] = match;
  if (!bucket || !filepath) {
    throw new Error('Invalid GCS path components');
  }
  const file = storage.bucket(bucket).file(filepath);

  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInMinutes * 60 * 1000,
  });

  return signedUrl;
}

/**
 * Download file buffer from GCS
 * @param gcsPath - Full GCS path (gs://bucket/path)
 * @returns File buffer
 */
export async function downloadFromGCS(gcsPath: string): Promise<Buffer> {
  if (!storage) {
    throw new Error('Google Cloud Storage not configured');
  }

  // Extract bucket and filename from gs:// URL
  const match = gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error('Invalid GCS path format');
  }

  const [, bucket, filepath] = match;
  if (!bucket || !filepath) {
    throw new Error('Invalid GCS path components');
  }

  const file = storage.bucket(bucket).file(filepath);
  const [buffer] = await file.download();
  return buffer;
}

export interface BoundApplicationResumeObject {
  bucket: string;
  object: string;
}

export function parseBoundApplicationResumeGcsPath(gcsPath: string): BoundApplicationResumeObject {
  const configuredBucket = bucketName ?? process.env.GCS_BUCKET_NAME ?? null;
  if (!configuredBucket) {
    throw new Error('GCS_RESUME_CONFIGURATION_UNAVAILABLE');
  }
  if (typeof gcsPath !== 'string' || /[\u0000-\u001f\u007f]/.test(gcsPath)) {
    throw new Error('GCS_RESUME_LOCATOR_REFUSED');
  }
  const match = /^gs:\/\/([^/]+)\/(resumes\/(.+))$/.exec(gcsPath);
  if (!match || match[1] !== configuredBucket || !match[2] || !match[3]) {
    throw new Error('GCS_RESUME_LOCATOR_REFUSED');
  }
  return { bucket: configuredBucket, object: match[2] };
}

export async function downloadBoundApplicationResumeFromGCS(gcsPath: string): Promise<Buffer> {
  if (!storage) {
    throw new Error('GCS_RESUME_CONFIGURATION_UNAVAILABLE');
  }
  const bound = parseBoundApplicationResumeGcsPath(gcsPath);
  try {
    const [buffer] = await storage.bucket(bound.bucket).file(bound.object).download();
    return buffer;
  } catch {
    throw new Error('GCS_RESUME_PROVIDER_UNAVAILABLE');
  }
}

export interface CandidateResumeBlob {
  generation:string;byteLength:number;contentHash:string;
  mediaType:'application/pdf'|'application/msword'|'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  bytes:Buffer;
}
export interface CandidateResumeBlobAccess {
  metadata(path:string):Promise<{generation:unknown;size:unknown}>;
  stream(path:string,generation:string):Readable;
}
/** Private, bounded, immutable-generation reads. Never signed/public URLs and
 * never fall back to the latest generation after a missing historical object. */
export function candidateResumeBlobReader(access:CandidateResumeBlobAccess){
  return async(path:string,expected?:{generation:string;byteLength:number;contentHash:string},timeoutMs=10_000):Promise<CandidateResumeBlob>=>{
    let timer:NodeJS.Timeout|undefined,stream:Readable|undefined;
    const deadline=Date.now()+timeoutMs;
    const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{stream?.destroy();reject(Error('source_unavailable'));},timeoutMs);});
    try{
      parseBoundApplicationResumeGcsPath(path);
      if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>10_000)throw Error('source_unavailable');
      const metadata=expected??await Promise.race([access.metadata(path),expired]);
      const generation=String(metadata.generation),size=expected?.byteLength??Number((metadata as {size:unknown}).size);
      if(!/^[0-9]+$/.test(generation)||!Number.isSafeInteger(size)||size<1||size>5*1024*1024||Date.now()>=deadline)throw Error('source_unavailable');
      stream=access.stream(path,generation);const chunks:Buffer[]=[];let bytesRead=0;
      const read=async()=>{
        for await(const chunk of stream!){
          const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
          bytesRead+=bytes.length;if(bytesRead>size||bytesRead>5*1024*1024)throw Error('source_changed');
          chunks.push(bytes);
        }
      };
      await Promise.race([read(),expired]);
      if(bytesRead!==size)throw Error('source_changed');
      const bytes=Buffer.concat(chunks,bytesRead),contentHash=createHash('sha256').update(bytes).digest('hex');
      if(expected&&expected.contentHash!==contentHash)throw Error('source_changed');
      const detector=(fileTypeMod as any).fileTypeFromBuffer??(fileTypeMod as any).fromBuffer;
      const detected=detector?await Promise.race([detector(bytes),expired]):null;
      const mime=detected?.mime??(bytes.subarray(0,8).toString('hex')==='d0cf11e0a1b11ae1'?'application/msword':null);
      if(!['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mime))throw Error('source_unavailable');
      return {generation,byteLength:bytesRead,contentHash,mediaType:mime,bytes};
    }catch(error){
      throw Error(error instanceof Error&&error.message==='source_changed'?'source_changed':'source_unavailable');
    }finally{
      if(timer)clearTimeout(timer);stream?.destroy();
    }
  };
}

export const readCandidateResumeBlob=candidateResumeBlobReader({
  async metadata(path){
    if(!storage)throw Error('source_unavailable');
    const bound=parseBoundApplicationResumeGcsPath(path);
    const [metadata]=await storage.bucket(bound.bucket).file(bound.object).getMetadata();
    return {generation:metadata.generation,size:metadata.size};
  },
  stream(path,generation){
    if(!storage)throw Error('source_unavailable');
    const bound=parseBoundApplicationResumeGcsPath(path);
    return storage.bucket(bound.bucket).file(bound.object,{generation}).createReadStream({validation:'crc32c',decompress:false});
  },
});

/**
 * Check if file exists in GCS
 * @param gcsPath - Full GCS path (gs://bucket/path)
 * @returns True if file exists
 */
export async function fileExists(gcsPath: string): Promise<boolean> {
  if (!storage) {
    return false;
  }

  try {
    const match = gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      return false;
    }

    const [, bucket, filepath] = match;
    if (!bucket || !filepath) {
      return false;
    }
    const [exists] = await storage.bucket(bucket).file(filepath).exists();
    return exists;
  } catch (error) {
    console.error('Error checking file existence:', error);
    return false;
  }
}

/**
 * Get content type based on file extension
 */
function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  const contentTypes: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return contentTypes[ext || ''] || 'application/octet-stream';
}
