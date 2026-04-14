import { fetchWithCsrf } from './csrf';
import { apiRequest } from './queryClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BatchStatus = 'queued' | 'processing' | 'ready_for_review' | 'completed' | 'failed';
export type ItemStatus = 'queued' | 'processing' | 'processed' | 'needs_review' | 'duplicate' | 'finalized' | 'failed';

export interface ResumeImportBatchDTO {
  id: number;
  organizationId: number;
  jobId: number;
  uploadedByUserId: number;
  status: BatchStatus;
  fileCount: number;
  processedCount: number;
  readyCount: number;
  needsReviewCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeImportItemDTO {
  id: number;
  batchId: number;
  originalFilename: string;
  parsedName: string | null;
  parsedEmail: string | null;
  parsedPhone: string | null;
  status: ItemStatus;
  errorReason: string | null;
  applicationId: number | null;
  canFinalize: boolean;
  reviewSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetBatchResponse {
  batch: ResumeImportBatchDTO;
  items: ResumeImportItemDTO[];
}

export interface UploadResponse {
  batch: ResumeImportBatchDTO;
  items: ResumeImportItemDTO[];
}

export interface PatchItemRequest {
  parsedName?: string | null;
  parsedEmail?: string | null;
  parsedPhone?: string | null;
}

export interface PatchItemResponse {
  item: ResumeImportItemDTO;
}

export interface AdvancedExtractResponse {
  item: ResumeImportItemDTO;
}

export interface ReprocessResponse {
  reprocessed: number;
  total: number;
}

export interface FinalizeResponse {
  batch: ResumeImportBatchDTO;
  finalized: Array<{ itemId: number; applicationId: number }>;
  duplicates: Array<{ itemId: number; applicationId?: number | null; reason: string }>;
  needsReview: Array<{ itemId: number; reason: string }>;
  syncWarnings: Array<{ itemId: number; applicationId: number; reason: string }>;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const bulkImportQueryKeys = {
  batch: (jobId: number, batchId: number) =>
    [`/api/jobs/${jobId}/bulk-resume-import/${batchId}`] as const,
} as const;

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export const bulkImportApi = {
  /** Upload resume files. Uses raw fetch because apiRequest forces Content-Type: application/json. */
  async upload(jobId: number, files: File[]): Promise<UploadResponse> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('resumes', file);
    }
    const res = await fetchWithCsrf(`/api/jobs/${jobId}/bulk-resume-import`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json();
  },

  async getBatch(jobId: number, batchId: number): Promise<GetBatchResponse> {
    const res = await fetch(`/api/jobs/${jobId}/bulk-resume-import/${batchId}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json();
  },

  async patchItem(jobId: number, itemId: number, data: PatchItemRequest): Promise<PatchItemResponse> {
    const res = await apiRequest('PATCH', `/api/jobs/${jobId}/bulk-resume-import/items/${itemId}`, data);
    return res.json();
  },

  async advancedExtract(jobId: number, itemId: number): Promise<AdvancedExtractResponse> {
    const res = await apiRequest('POST', `/api/jobs/${jobId}/bulk-resume-import/items/${itemId}/advanced-extract`, {});
    return res.json();
  },

  async reprocess(jobId: number, batchId: number): Promise<ReprocessResponse> {
    const res = await apiRequest('POST', `/api/jobs/${jobId}/bulk-resume-import/${batchId}/reprocess`, {});
    return res.json();
  },

  async finalize(jobId: number, batchId: number, itemIds?: number[]): Promise<FinalizeResponse> {
    const body = itemIds && itemIds.length > 0 ? { itemIds } : {};
    const res = await apiRequest('POST', `/api/jobs/${jobId}/bulk-resume-import/${batchId}/finalize`, body);
    return res.json();
  },
} as const;
