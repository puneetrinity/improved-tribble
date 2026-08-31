/**
 * Shared types for Forms feature
 * Used by both client and server to maintain type safety across the API boundary
 */

// Field type enum
export const FIELD_TYPES = [
  'short_text',
  'long_text',
  'yes_no',
  'select',
  'date',
  'file',
  'email',
] as const;

export type FieldType = typeof FIELD_TYPES[number];

// Form field snapshot (immutable at invitation time)
export interface FormFieldSnapshot {
  readonly id: number;
  readonly type: FieldType;
  readonly label: string;
  readonly required: boolean;
  readonly options?: string | null;
  readonly order: number;
}

// Complete form snapshot stored in invitation
export interface FormSnapshot {
  readonly formName: string;
  readonly formDescription?: string | null;
  readonly fields: ReadonlyArray<FormFieldSnapshot>;
}

// Form answer (submitted by candidate)
export interface FormAnswer {
  fieldId: number;
  value?: string;
  fileUrl?: string;
  filename?: string;
  size?: number;
}

// File upload response
export interface FileUploadResult {
  fileUrl: string;
  filename: string;
  size: number;
}

// DTOs for API responses

export interface FormTemplateDTO {
  id: number;
  name: string;
  description?: string | null;
  isPublished: boolean;
  ownershipScope: 'organization' | 'personal' | 'legacy_private';
  canManage: boolean;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  fields: Array<{
    id: number;
    formId: number;
    type: FieldType;
    label: string;
    required: boolean;
    options?: string | null;
    order: number;
  }>;
}

export interface FormInvitationDTO {
  id: number;
  applicationId: number;
  formId: number;
  token: string;
  expiresAt: string;
  status: 'pending' | 'sent' | 'failed' | 'viewed' | 'answered' | 'expired';
  sentAt?: string | null;
  viewedAt?: string | null;
  answeredAt?: string | null;
  sentBy: number;
  customMessage?: string | null;
  fieldSnapshot: string; // JSON string
  form: {
    id: number;
    name: string;
  };
}

export interface FormResponseSummaryDTO {
  id: number;
  formName: string;
  submittedAt: string;
  invitationId: number;
  answeredAt?: string | null;
}

export interface FormResponseDetailDTO {
  id: number;
  formName: string;
  formDescription?: string | null;
  submittedAt: string;
  candidateName: string;
  candidateEmail: string;
  questionsAndAnswers: Array<{
    fieldId: number;
    question: string;
    fieldType: string;
    answer: string;
    fileUrl?: string;
  }>;
}

export interface PublicFormDTO {
  formName: string;
  formDescription?: string | null;
  fields: FormFieldSnapshot[];
  expiresAt: string;
}

// Error response types
export interface FormError {
  status: number;
  code: string;
  message: string;
}

// Type guards

export function isValidFieldType(type: string): type is FieldType {
  return FIELD_TYPES.includes(type as FieldType);
}

export function isFormSnapshot(obj: unknown): obj is FormSnapshot {
  if (typeof obj !== 'object' || obj === null) return false;
  const snapshot = obj as FormSnapshot;
  return (
    typeof snapshot.formName === 'string' &&
    Array.isArray(snapshot.fields) &&
    snapshot.fields.every(
      (f) =>
        typeof f.id === 'number' &&
        isValidFieldType(f.type) &&
        typeof f.label === 'string' &&
        typeof f.required === 'boolean' &&
        typeof f.order === 'number'
    )
  );
}

export function parseFormSnapshot(json: string): FormSnapshot {
  const parsed = JSON.parse(json);
  if (!isFormSnapshot(parsed)) {
    throw new Error('Invalid form snapshot structure');
  }
  return parsed;
}

/**
 * Parse select field options safely from TEXT/JSON storage
 * Returns empty array if parsing fails or input is invalid
 *
 * NOTE: Future optimization - Consider migrating to JSONB column type
 * to reduce parsing overhead and enable better query capabilities
 */
export function parseSelectOptions(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Normalize yes/no input to standard values
 * Handles various input types (string, boolean, number)
 */
export function normalizeYesNoValue(value: unknown): 'yes' | 'no' | null {
  const normalized = String(value).toLowerCase();
  if (['yes', 'true', '1'].includes(normalized)) return 'yes';
  if (['no', 'false', '0'].includes(normalized)) return 'no';
  return null;
}
