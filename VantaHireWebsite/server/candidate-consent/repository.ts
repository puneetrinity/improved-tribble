import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { privacyPasswordVersion } from "../auth";
import { requireCandidatePrivacyAllowed } from "../candidate-privacy/decision";
import {
  CandidateConsentError, CONSENT_COPY, CONSENT_COPY_SHA256, CONSENT_COPY_VERSION, CONSENT_PURPOSE,
  CONSENT_SAVED_COPY, consentCommandSchema, consentIdentity, consentResumeSchema, consentProfileSchema,
  requestDigest, resumeArray, sha256, type ConsentCommand, type ConsentResume,
  type GrantRequest, type WithdrawRequest,
} from "./contracts";

export interface ConsentDb {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface ConsentClient extends ConsentDb { release(): void }
export interface ConsentPool extends ConsentDb { connect(): Promise<ConsentClient> }
export interface CandidateAuthority {
  userId: number; authVersion: number; passwordVersion: string; reauthenticatedAt: number;
}
export function recentConsentAuth(at: unknown, passwordVersion: unknown, password: string, now = Date.now()): boolean {
  return typeof at === "number" && Number.isFinite(at) && at <= now && now - at <= 600_000
    && typeof passwordVersion === "string" && passwordVersion === privacyPasswordVersion(password);
}

export async function ownedResume(db: ConsentDb, userId: number, resumeId: string, lock: boolean): Promise<ConsentResume> {
  const result = await db.query(`SELECT v.reference_id,v.resume_version_id,v.organization_id,v.application_id,
      v.job_id,v.content_sha256,v.byte_count,v.media_type,v.source_observed_at
    FROM public.application_resume_versions v
    JOIN public.organization_candidate_references r ON
      (r.reference_id,r.organization_id,r.application_id,r.job_id)=
      (v.reference_id,v.organization_id,v.application_id,v.job_id)
    JOIN public.applications a ON (a.id,a.organization_id,a.job_id)=(v.application_id,v.organization_id,v.job_id)
    WHERE v.resume_version_id=$1 AND a.user_id=$2 AND r.origin_code='candidate_applied'
    ${lock ? "FOR UPDATE OF a" : ""}`, [resumeId, userId]);
  if (!result.rows[0]) throw new CandidateConsentError("candidate_consent_source_not_found", 404);
  const row = result.rows[0];
  const resume = consentResumeSchema.parse({ ...row, source_observed_at: new Date(row.source_observed_at).toISOString() });
  const ready = await db.query("SELECT public.flow_candidate_consent_resume_ready($1,$2) AS ready", [userId, resumeId]);
  if (ready.rows[0]?.ready !== true) throw new CandidateConsentError("candidate_consent_source_pending", 409);
  return resume;
}

export async function listConsentSources(userId: number, limit: number, after: string | null, db: ConsentDb = pool) {
  const result = await db.query(`SELECT v.resume_version_id,v.content_sha256,v.captured_at
    FROM public.application_resume_versions v
    JOIN public.applications a ON (a.id,a.organization_id,a.job_id)=(v.application_id,v.organization_id,v.job_id)
    WHERE a.user_id=$1 AND ($2::uuid IS NULL OR v.resume_version_id>$2)
      AND public.flow_candidate_consent_resume_ready($1,v.resume_version_id)
    ORDER BY v.resume_version_id LIMIT $3`, [userId, after, limit + 1]);
  const rows = result.rows.slice(0, limit);
  return {
    sources: rows.map(row => ({ resume_version_id: row.resume_version_id, content_sha256: row.content_sha256,
      captured_at: new Date(row.captured_at).toISOString(), label: "Submitted resume" })),
    next_cursor: result.rows.length > limit ? rows.at(-1)?.resume_version_id : null,
  };
}

export async function getConsentStatus(userId: number, db: ConsentDb = pool) {
  const result = await db.query(`SELECT s.version,s.desired_action,s.acknowledged_version,s.acknowledged_action,
      s.delivery_status,s.last_error_code,c.profile AS desired_profile,c.resume_version_id AS desired_resume_version_id,
      c.profile_sha256 AS desired_profile_sha256,e.profile AS effective_profile,
      e.resume_version_id AS effective_resume_version_id,e.profile_sha256 AS effective_profile_sha256
    FROM public.candidate_consent_subjects s
    LEFT JOIN public.candidate_consent_sources c ON c.source_id=s.current_source_id AND c.subject_id=s.subject_id
    LEFT JOIN public.candidate_consent_sources e ON e.source_id=s.effective_source_id AND e.subject_id=s.subject_id
    WHERE s.user_id=$1`, [userId]);
  const r = result.rows[0];
  return {
    purpose: CONSENT_PURPOSE, copy_version: CONSENT_COPY_VERSION, copy: CONSENT_COPY, copy_sha256: CONSENT_COPY_SHA256,
    publication_active: false, saved_message: CONSENT_SAVED_COPY,
    version: r ? Number(r.version) : 0,
    desired: r ? { action: r.desired_action, profile: r.desired_profile ?? null,
      resume_version_id: r.desired_resume_version_id ?? null, profile_sha256: r.desired_profile_sha256 ?? null } : null,
    effective: r?.acknowledged_action ? { action: r.acknowledged_action, version: Number(r.acknowledged_version),
      profile: r.effective_profile ?? null, resume_version_id: r.effective_resume_version_id ?? null,
      profile_sha256: r.effective_profile_sha256 ?? null } : null,
    delivery_status: r?.delivery_status ?? "none", error_code: r?.last_error_code ?? null,
  };
}

export async function captureConsent(
  action: "grant" | "withdraw", request: GrantRequest | WithdrawRequest,
  authority: CandidateAuthority, database: ConsentPool = pool,
): Promise<{ eventId: string; replayed: boolean }> {
  const db = await database.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL statement_timeout='10s'");
    await db.query("SELECT pg_advisory_xact_lock(41943,$1)", [authority.userId]);
    const user = (await db.query(`SELECT id,username,password,role,email_verified,auth_version
      FROM public.users WHERE id=$1 FOR UPDATE`, [authority.userId])).rows[0];
    if (!user || user.role !== "candidate" || user.email_verified !== true
      || user.auth_version !== authority.authVersion
      || !recentConsentAuth(authority.reauthenticatedAt, authority.passwordVersion, user.password)) {
      throw new CandidateConsentError("candidate_consent_recent_auth_required", 403);
    }
    const subject = (await db.query("SELECT * FROM public.candidate_consent_subjects WHERE user_id=$1 FOR UPDATE",
      [authority.userId])).rows[0];
    const browserDigest = requestDigest(action, request);
    if (subject) {
      const prior = (await db.query(`SELECT event_id,request_sha256 FROM public.candidate_consent_events
        WHERE subject_id=$1 AND request_id=$2`, [subject.subject_id, request.request_id])).rows[0];
      if (prior) {
        if (prior.request_sha256 !== browserDigest) throw new CandidateConsentError("candidate_consent_request_conflict");
        await db.query("COMMIT");
        return { eventId: prior.event_id, replayed: true };
      }
    }
    const previousVersion = subject ? Number(subject.version) : 0;
    if (previousVersion !== request.expected_version || previousVersion >= Number.MAX_SAFE_INTEGER) {
      throw new CandidateConsentError("candidate_consent_version_conflict");
    }
    let resume: ConsentResume | null = null;
    if (action === "grant") {
      const req = request as GrantRequest;
      if (req.resume_version_id) resume = await ownedResume(db, authority.userId, req.resume_version_id, true);
      // Recheck after ownership/authority locks, before any consent insert. The frozen helper is read-only.
      await requireCandidatePrivacyAllowed({ type: "candidate_user", id: authority.userId },
        { globalUse: true, newGlobalOperation: true });
    }
    const subjectId = subject?.subject_id ?? randomUUID();
    const version = previousVersion + 1;
    const capturedAt = new Date().toISOString();
    const source = action === "grant" ? { source_id: randomUUID(), source_version: version,
      profile: consentProfileSchema.parse((request as GrantRequest).profile), resume } : null;
    const command = consentCommandSchema.parse({ schema_version: 1, subject_id: subjectId,
      event_id: randomUUID(), version, action, purpose: CONSENT_PURPOSE, purpose_version: 1,
      copy_version: CONSENT_COPY_VERSION, copy_sha256: CONSENT_COPY_SHA256, source, captured_at: capturedAt });
    const identity = consentIdentity(command);
    if (!subject) await db.query(`INSERT INTO public.candidate_consent_subjects
      (subject_id,user_id,created_at,updated_at) VALUES($1,$2,$3,$3)`, [subjectId, authority.userId, capturedAt]);
    if (source) await db.query(`INSERT INTO public.candidate_consent_sources
      (source_id,subject_id,source_version,profile,profile_sha256,resume,resume_sha256,resume_version_id,approved_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [source.source_id, subjectId, version, JSON.stringify(source.profile),
      sha256(JSON.stringify(source.profile)), resume ? JSON.stringify(resume) : null,
      resume ? sha256(JSON.stringify(resumeArray(resume))) : null, resume?.resume_version_id ?? null, capturedAt]);
    await db.query(`INSERT INTO public.candidate_consent_events
      (event_id,subject_id,version,action,source_id,purpose,schema_version,purpose_version,copy_version,copy_sha256,
       user_id,verified_email_sha256,account_auth_version,request_id,request_sha256,command_sha256,captured_at)
      VALUES($1,$2,$3,$4,$5,$6,1,1,1,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [command.event_id, subjectId, version, action, source?.source_id ?? null, CONSENT_PURPOSE, CONSENT_COPY_SHA256,
      authority.userId, source ? sha256(user.username.trim().toLowerCase()) : null,
      source ? user.auth_version : null, request.request_id, browserDigest, identity.commandDigest, capturedAt]);
    await db.query(`INSERT INTO public.candidate_consent_outbox
      (outbox_id,event_id,subject_id,version,idempotency_key,command_sha256,next_attempt_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7,$7)`,
    [randomUUID(), command.event_id, subjectId, version, identity.idempotencyKey, identity.commandDigest, capturedAt]);
    await db.query(`UPDATE public.candidate_consent_subjects SET version=$2,desired_action=$3,current_source_id=$4,
      delivery_status='pending',last_error_code=NULL,updated_at=$5 WHERE subject_id=$1`,
    [subjectId, version, action, source?.source_id ?? null, capturedAt]);
    await db.query("COMMIT");
    return { eventId: command.event_id, replayed: false };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}

export async function loadConsentCommand(eventId: string, db: ConsentDb = pool): Promise<{
  command: ConsentCommand; userId: number; emailDigest: string | null; authVersion: number | null;
}> {
  const r = (await db.query(`SELECT e.*,s.profile,s.resume FROM public.candidate_consent_events e
    LEFT JOIN public.candidate_consent_sources s ON
      (s.source_id,s.subject_id,s.source_version)=(e.source_id,e.subject_id,e.version)
    WHERE e.event_id=$1`, [eventId])).rows[0];
  if (!r) throw new CandidateConsentError("source_missing");
  const command = consentCommandSchema.parse({ schema_version: r.schema_version, subject_id: r.subject_id,
    event_id: r.event_id, version: Number(r.version), action: r.action, purpose: r.purpose,
    purpose_version: r.purpose_version, copy_version: r.copy_version, copy_sha256: r.copy_sha256,
    source: r.source_id ? { source_id: r.source_id, source_version: Number(r.version), profile: r.profile,
      resume: r.resume } : null, captured_at: new Date(r.captured_at).toISOString() });
  if (consentIdentity(command).commandDigest !== r.command_sha256) throw new CandidateConsentError("source_missing");
  return { command, userId: r.user_id, emailDigest: r.verified_email_sha256, authVersion: r.account_auth_version };
}
