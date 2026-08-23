import { randomUUID } from "node:crypto";
import { pool } from "../db";
import {
  decisionForRemote,
  type FlowPrivacyDecision,
  type MemoryChange,
  type MemoryDirectiveResponse,
  type MemorySnapshotDirective,
  type MinimalPrivacyRequest,
  type PrivacyAction,
  type PrivacyAuthority,
  type PrivacyIdentifier,
  type PrivacyReason,
  type RemotePrivacyDecision,
} from "./models";

export class CandidatePrivacyConflict extends Error {}
export class CandidatePrivacyUnavailable extends Error {}
export class CandidatePrivacySubjectNotFound extends Error {}

type SubjectType =
  | "candidate_user"
  | "application"
  | "candidate_resume"
  | "talent_pool"
  | "job_sourced_candidate";

export interface SubjectAnchor {
  type: SubjectType;
  id: number;
}

export interface ClaimedOutbox {
  outboxId: string;
  requestId: string;
  leaseToken: string;
  action: PrivacyAction;
  authorityType: PrivacyAuthority;
  evidenceRef: string;
  reasonCode: PrivacyReason;
}

export interface CandidatePrivacyPg {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
  release?(): void;
}

async function withTransaction<T>(run: (client: CandidatePrivacyPg) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    client.release();
  }
}

function rowToMinimal(row: any): MinimalPrivacyRequest {
  return {
    requestId: String(row.request_id),
    action: row.action,
    state: row.state,
    effectiveAt: new Date(row.effective_at).toISOString(),
    deliveryStatus: row.last_delivery_status,
    directiveId: row.directive_id ? String(row.directive_id) : null,
    remoteState: row.remote_state ?? null,
    decision: row.remote_decision ?? null,
  };
}

async function resolveRootSubject(
  client: CandidatePrivacyPg,
  anchor: SubjectAnchor,
): Promise<{ userId: number | null; email: string | null; organizationId: number | null }> {
  const statements: Record<SubjectType, string> = {
    candidate_user: `SELECT u.id AS user_id, lower(u.username) AS email, NULL::integer AS organization_id
                       FROM users u WHERE u.id=$1 AND u.role='candidate'`,
    application: `SELECT a.user_id, lower(a.email) AS email, a.organization_id
                    FROM applications a WHERE a.id=$1`,
    candidate_resume: `SELECT r.user_id, lower(u.username) AS email, NULL::integer AS organization_id
                         FROM candidate_resumes r JOIN users u ON u.id=r.user_id WHERE r.id=$1`,
    talent_pool: `SELECT NULL::integer AS user_id, lower(t.email) AS email, t.organization_id
                    FROM talent_pool t WHERE t.id=$1`,
    job_sourced_candidate: `SELECT NULL::integer AS user_id, lower(s.found_email) AS email, s.organization_id
                              FROM job_sourced_candidates s WHERE s.id=$1`,
  };
  const row = (await client.query(statements[anchor.type], [anchor.id])).rows[0];
  if (!row) throw new CandidatePrivacySubjectNotFound("candidate_privacy_subject_not_found");
  return {
    userId: row.user_id == null ? null : Number(row.user_id),
    email: row.email ? String(row.email) : null,
    organizationId: row.organization_id == null ? null : Number(row.organization_id),
  };
}

async function materializeSubjectLinks(
  client: CandidatePrivacyPg,
  requestId: string,
  anchor: SubjectAnchor,
): Promise<void> {
  const root = await resolveRootSubject(client, anchor);
  const values: Array<[SubjectType, number, number | null]> = [[anchor.type, anchor.id, root.organizationId]];
  if (root.userId !== null && !(anchor.type === "candidate_user" && anchor.id === root.userId)) {
    values.push(["candidate_user", root.userId, null]);
  }

  const applications = await client.query(
    `SELECT id, organization_id FROM applications
      WHERE ($1::integer IS NOT NULL AND user_id=$1)
         OR ($2::text IS NOT NULL AND lower(email)=$2)`,
    [root.userId, root.email],
  );
  for (const row of applications.rows) values.push(["application", Number(row.id), row.organization_id]);

  if (root.userId !== null) {
    const resumes = await client.query(
      "SELECT id FROM candidate_resumes WHERE user_id=$1",
      [root.userId],
    );
    for (const row of resumes.rows) values.push(["candidate_resume", Number(row.id), null]);
  }
  if (root.email) {
    const pooled = await client.query(
      "SELECT id, organization_id FROM talent_pool WHERE lower(email)=$1",
      [root.email],
    );
    for (const row of pooled.rows) values.push(["talent_pool", Number(row.id), row.organization_id]);
    const sourced = await client.query(
      "SELECT id, organization_id FROM job_sourced_candidates WHERE lower(found_email)=$1",
      [root.email],
    );
    for (const row of sourced.rows) values.push(["job_sourced_candidate", Number(row.id), row.organization_id]);
  }

  const unique = new Map(values.map((value) => [`${value[0]}:${value[1]}`, value]));
  for (const [subjectType, id, organizationId] of unique.values()) {
    const columns: Record<SubjectType, string> = {
      candidate_user: "candidate_user_id",
      application: "application_id",
      candidate_resume: "candidate_resume_id",
      talent_pool: "talent_pool_id",
      job_sourced_candidate: "job_sourced_candidate_id",
    };
    const column = columns[subjectType];
    await client.query(
      `INSERT INTO candidate_privacy_subject_links
         (link_id, request_id, subject_type, ${column}, organization_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), requestId, subjectType, id, organizationId],
    );
  }
}

export async function createLocalPrivacyRequest(input: {
  requestId: string;
  action: PrivacyAction;
  authorityType: PrivacyAuthority;
  actorUserId: number;
  evidenceRef: string;
  reasonCode: PrivacyReason;
  anchor: SubjectAnchor;
}): Promise<MinimalPrivacyRequest> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [input.requestId]);
    const existing = (await client.query(
      `SELECT r.*, p.state AS remote_state, p.decision AS remote_decision,
              accepted.evidence_ref AS accepted_evidence_ref
         FROM candidate_privacy_requests r
         LEFT JOIN candidate_privacy_remote_projection p ON p.request_id=r.request_id
         LEFT JOIN LATERAL (
           SELECT e.evidence_ref
             FROM candidate_privacy_request_events e
            WHERE e.request_id=r.request_id AND e.event_type='accepted'
            ORDER BY e.occurred_at, e.event_id LIMIT 1
         ) accepted ON true
        WHERE r.request_id=$1`,
      [input.requestId],
    )).rows[0];
    if (existing) {
      const exact = existing.action === input.action
        && existing.authority_type === input.authorityType
        && Number(existing.actor_user_id) === input.actorUserId
        && String(existing.accepted_evidence_ref) === input.evidenceRef
        && existing.reason_code === input.reasonCode;
      if (!exact) throw new CandidatePrivacyConflict("candidate_privacy_request_conflict");
      return rowToMinimal(existing);
    }

    // Resolve and link the complete current local subject set before exposing
    // success. Any lookup failure rolls back the request and outbox together.
    await client.query(
      `INSERT INTO candidate_privacy_requests
         (request_id, action, authority_type, actor_user_id, reason_code,
          state, version, last_delivery_status)
       VALUES ($1,$2,$3,$4,$5,'delivery_pending',1,'pending')`,
      [
        input.requestId,
        input.action,
        input.authorityType,
        input.actorUserId,
        input.reasonCode,
      ],
    );
    await materializeSubjectLinks(client, input.requestId, input.anchor);
    await client.query(
      `INSERT INTO candidate_privacy_request_events
         (event_id, request_id, event_type, action, authority_type, actor_user_id,
          evidence_ref, reason_code, prior_state, resulting_state, expected_version, resulting_version)
       VALUES ($1,$2,'accepted',$3,$4,$5,$6,$7,NULL,'delivery_pending',NULL,1)`,
      [
        randomUUID(), input.requestId, input.action, input.authorityType,
        input.actorUserId, input.evidenceRef, input.reasonCode,
      ],
    );
    await client.query(
      `INSERT INTO candidate_privacy_outbox (outbox_id, request_id)
       VALUES ($1,$2)`,
      [randomUUID(), input.requestId],
    );
    const created = (await client.query(
      `SELECT r.*, NULL::text AS remote_state, NULL::text AS remote_decision
         FROM candidate_privacy_requests r WHERE request_id=$1`,
      [input.requestId],
    )).rows[0];
    return rowToMinimal(created);
  });
}

export async function getCandidatePrivacyStatus(userId: number): Promise<MinimalPrivacyRequest[]> {
  const result = await pool.query(
    `SELECT r.*, p.state AS remote_state, p.decision AS remote_decision
       FROM candidate_privacy_requests r
       JOIN candidate_privacy_subject_links l ON l.request_id=r.request_id
       LEFT JOIN candidate_privacy_remote_projection p ON p.request_id=r.request_id
      WHERE l.subject_type='candidate_user' AND l.candidate_user_id=$1
      ORDER BY r.created_at DESC`,
    [userId],
  );
  return result.rows.map(rowToMinimal);
}

export async function getOperatorPrivacyStatus(requestId: string): Promise<MinimalPrivacyRequest | null> {
  const row = (await pool.query(
    `SELECT r.*, p.state AS remote_state, p.decision AS remote_decision
       FROM candidate_privacy_requests r
       LEFT JOIN candidate_privacy_remote_projection p ON p.request_id=r.request_id
      WHERE r.request_id=$1`,
    [requestId],
  )).rows[0];
  return row ? rowToMinimal(row) : null;
}

export async function claimPrivacyOutbox(leaseMs: number): Promise<ClaimedOutbox | null> {
  return withTransaction(async (client) => {
    const leaseToken = randomUUID();
    const row = (await client.query(
      `WITH candidate AS (
         SELECT outbox_id FROM candidate_privacy_outbox
          WHERE (state IN ('pending','retry') AND available_at <= now())
             OR (state='leased' AND lease_expires_at <= now())
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE candidate_privacy_outbox o
          SET state='leased', lease_token=$1,
              lease_expires_at=now()+($2::integer * interval '1 millisecond'),
              attempt_count=attempt_count+1, last_error_code=NULL, updated_at=now()
         FROM candidate c WHERE o.outbox_id=c.outbox_id
       RETURNING o.outbox_id, o.request_id, o.lease_token`,
      [leaseToken, leaseMs],
    )).rows[0];
    if (!row) return null;
    const request = (await client.query(
      `SELECT r.action, r.authority_type, r.reason_code, accepted.evidence_ref
         FROM candidate_privacy_requests r
         JOIN LATERAL (
           SELECT e.evidence_ref
             FROM candidate_privacy_request_events e
            WHERE e.request_id=r.request_id AND e.event_type='accepted'
            ORDER BY e.occurred_at, e.event_id LIMIT 1
         ) accepted ON true
        WHERE r.request_id=$1 FOR UPDATE OF r`,
      [row.request_id],
    )).rows[0];
    if (!request) throw new CandidatePrivacyUnavailable("candidate_privacy_request_missing");
    return {
      outboxId: String(row.outbox_id),
      requestId: String(row.request_id),
      leaseToken: String(row.lease_token),
      action: request.action,
      authorityType: request.authority_type,
      evidenceRef: String(request.evidence_ref),
      reasonCode: request.reason_code,
    };
  });
}

export async function transientIdentifiersForRequest(requestId: string): Promise<PrivacyIdentifier[]> {
  const result = await pool.query(
    `SELECT identifier_type, value FROM (
       SELECT 'email'::text AS identifier_type, lower(u.username)::text AS value
         FROM candidate_privacy_subject_links l JOIN users u ON u.id=l.candidate_user_id
        WHERE l.request_id=$1 AND l.candidate_user_id IS NOT NULL
       UNION
       SELECT 'vantahire_application_id', a.id::text
         FROM candidate_privacy_subject_links l JOIN applications a ON a.id=l.application_id
        WHERE l.request_id=$1 AND l.application_id IS NOT NULL
       UNION
       SELECT 'email', lower(a.email)
         FROM candidate_privacy_subject_links l JOIN applications a ON a.id=l.application_id
        WHERE l.request_id=$1 AND l.application_id IS NOT NULL
       UNION
       SELECT 'vantahire_resume_id', r.id::text
         FROM candidate_privacy_subject_links l JOIN candidate_resumes r ON r.id=l.candidate_resume_id
        WHERE l.request_id=$1 AND l.candidate_resume_id IS NOT NULL
       UNION
       SELECT 'email', lower(t.email)
         FROM candidate_privacy_subject_links l JOIN talent_pool t ON t.id=l.talent_pool_id
        WHERE l.request_id=$1 AND l.talent_pool_id IS NOT NULL
       UNION
       SELECT 'signal_candidate_id', s.signal_candidate_id
         FROM candidate_privacy_subject_links l JOIN job_sourced_candidates s ON s.id=l.job_sourced_candidate_id
        WHERE l.request_id=$1 AND l.job_sourced_candidate_id IS NOT NULL
     ) identities
     WHERE value IS NOT NULL AND value <> ''
     ORDER BY identifier_type, value
     LIMIT 8`,
    [requestId],
  );
  if (result.rows.length === 0) {
    throw new CandidatePrivacyUnavailable("candidate_privacy_subject_unavailable");
  }
  return result.rows;
}

export async function markOutboxRetry(
  claim: ClaimedOutbox,
  errorCode: string,
  retryable: boolean,
): Promise<void> {
  const attempt = (await pool.query(
    "SELECT attempt_count FROM candidate_privacy_outbox WHERE outbox_id=$1 AND lease_token=$2",
    [claim.outboxId, claim.leaseToken],
  )).rows[0]?.attempt_count;
  const terminal = !retryable || Number(attempt ?? 0) >= 12;
  const seconds = Math.min(900, Math.max(5, 2 ** Math.min(Number(attempt ?? 1), 8)));
  await pool.query(
    `UPDATE candidate_privacy_outbox
        SET state=$3, lease_token=NULL, lease_expires_at=NULL,
            available_at=now()+($4::integer * interval '1 second'),
            last_error_code=$5, updated_at=now()
      WHERE outbox_id=$1 AND lease_token=$2`,
    [claim.outboxId, claim.leaseToken, terminal ? "terminal" : "retry", seconds, errorCode],
  );
}

export async function markOutboxDelivered(
  claim: ClaimedOutbox,
  remote: MemoryDirectiveResponse,
): Promise<void> {
  await withTransaction(async (client) => {
    const locked = (await client.query(
      `SELECT r.*, accepted.evidence_ref AS accepted_evidence_ref
         FROM candidate_privacy_requests r
         JOIN LATERAL (
           SELECT e.evidence_ref
             FROM candidate_privacy_request_events e
            WHERE e.request_id=r.request_id AND e.event_type='accepted'
            ORDER BY e.occurred_at, e.event_id LIMIT 1
         ) accepted ON true
        WHERE r.request_id=$1 FOR UPDATE OF r`,
      [claim.requestId],
    )).rows[0];
    if (!locked) throw new CandidatePrivacyUnavailable("candidate_privacy_request_missing");
    const expectedScope = locked.action === "request_erasure" ? "active_profile" : "global_matching";
    const expectedDecision = decisionForRemote(remote.state, remote.action);
    if (remote.request_id !== claim.requestId
      || remote.action !== locked.action
      || remote.scope !== expectedScope
      || remote.decision !== expectedDecision) {
      throw new CandidatePrivacyConflict("candidate_privacy_remote_contract_conflict");
    }
    if (locked.directive_id && String(locked.directive_id) !== remote.directive_id) {
      throw new CandidatePrivacyConflict("candidate_privacy_directive_conflict");
    }
    const updated = await client.query(
      `UPDATE candidate_privacy_outbox
          SET state='succeeded', lease_token=NULL, lease_expires_at=NULL,
              last_error_code=NULL, updated_at=now()
        WHERE outbox_id=$1 AND lease_token=$2 AND state='leased'
        RETURNING outbox_id`,
      [claim.outboxId, claim.leaseToken],
    );
    if (!updated.rowCount) throw new CandidatePrivacyConflict("candidate_privacy_lease_lost");
    const resultingState = remote.state === "needs_review" ? "needs_review" : "memory_active";
    const newVersion = Number(locked.version) + 1;
    await client.query(
      `UPDATE candidate_privacy_requests
          SET directive_id=$2, state=$3, version=$4, last_delivery_status='delivered',
              last_error_code=NULL, updated_at=now()
        WHERE request_id=$1 AND version=$5`,
      [claim.requestId, remote.directive_id, resultingState, newVersion, locked.version],
    );
    await client.query(
      `INSERT INTO candidate_privacy_remote_projection
         (directive_id, request_id, action, scope, state, decision, version, effective_at, generation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)
       ON CONFLICT (directive_id) DO UPDATE SET
         state=EXCLUDED.state, decision=EXCLUDED.decision, version=EXCLUDED.version,
         effective_at=EXCLUDED.effective_at, updated_at=now()
       WHERE candidate_privacy_remote_projection.version < EXCLUDED.version
          OR (candidate_privacy_remote_projection.version = EXCLUDED.version
              AND candidate_privacy_remote_projection.state = EXCLUDED.state
              AND candidate_privacy_remote_projection.decision = EXCLUDED.decision)`,
      [
        remote.directive_id, claim.requestId, remote.action, remote.scope, remote.state,
        remote.decision, remote.version, remote.effective_at,
      ],
    );
    await client.query(
      `INSERT INTO candidate_privacy_request_events
         (event_id,request_id,event_type,action,authority_type,actor_user_id,evidence_ref,
          reason_code,prior_state,resulting_state,expected_version,resulting_version)
       VALUES ($1,$2,'delivery_succeeded',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        randomUUID(), claim.requestId, locked.action, locked.authority_type, locked.actor_user_id,
        locked.accepted_evidence_ref, locked.reason_code, locked.state, resultingState, locked.version, newVersion,
      ],
    );
  });
}

export async function applyMemoryChanges(events: MemoryChange[]): Promise<number> {
  const outcome = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('flow-candidate-privacy-feed'))");
    const sync = (await client.query(
      "SELECT * FROM candidate_privacy_sync_state WHERE consumer_name='flow' FOR UPDATE",
    )).rows[0];
    let cursor = Number(sync?.cursor ?? 0);
    let conflictCode: string | null = null;
    for (const event of events) {
      if (event.cursor <= cursor) continue;
      if (event.cursor !== cursor + 1) {
        conflictCode = "candidate_privacy_cursor_gap";
        break;
      }
      const current = (await client.query(
        `SELECT p.*, r.action AS request_action FROM candidate_privacy_remote_projection p
          JOIN candidate_privacy_requests r ON r.request_id=p.request_id
         WHERE p.directive_id=$1 FOR UPDATE`,
        [event.directive_id],
      )).rows[0];
      if (!current) {
        conflictCode = "candidate_privacy_unknown_directive";
        break;
      }
      const expectedScope = current.request_action === "request_erasure"
        ? "active_profile"
        : "global_matching";
      if (event.action !== current.request_action || event.scope !== expectedScope) {
        conflictCode = "candidate_privacy_authority_conflict";
        break;
      }
      const expectedDecision = decisionForRemote(event.state, event.action);
      if (event.version < Number(current.version)) {
        cursor = event.cursor;
        continue;
      }
      if (event.version === Number(current.version)) {
        if (current.state !== event.state || current.decision !== expectedDecision) {
          conflictCode = "candidate_privacy_projection_conflict";
          break;
        }
        cursor = event.cursor;
        continue;
      }
      if (event.version !== Number(current.version) + 1) {
        conflictCode = "candidate_privacy_version_gap";
        break;
      }
      await client.query(
        `UPDATE candidate_privacy_remote_projection
            SET state=$2,decision=$3,version=$4,effective_at=$5,updated_at=now()
          WHERE directive_id=$1`,
        [event.directive_id, event.state, expectedDecision, event.version, event.effective_at],
      );
      cursor = event.cursor;
    }
    if (conflictCode) {
      await client.query(
        `INSERT INTO candidate_privacy_sync_state
           (consumer_name,cursor,status,last_error_code,updated_at)
         VALUES ('flow',$1,'needs_reconciliation',$2,now())
         ON CONFLICT (consumer_name) DO UPDATE
           SET cursor=EXCLUDED.cursor,status='needs_reconciliation',last_error_code=EXCLUDED.last_error_code,
               updated_at=now()`,
        [cursor, conflictCode],
      );
      return { cursor, conflictCode };
    }
    await client.query(
      `INSERT INTO candidate_privacy_sync_state
         (consumer_name,cursor,status,last_success_at,last_error_code,updated_at)
       VALUES ('flow',$1,'healthy',now(),NULL,now())
       ON CONFLICT (consumer_name) DO UPDATE
         SET cursor=EXCLUDED.cursor,status='healthy',last_success_at=now(),last_error_code=NULL,updated_at=now()`,
      [cursor],
    );
    return { cursor, conflictCode: null };
  });
  if (outcome.conflictCode) throw new CandidatePrivacyConflict(outcome.conflictCode);
  return outcome.cursor;
}

export async function replaceProjectionFromSnapshot(input: {
  highWaterCursor: number;
  directives: MemorySnapshotDirective[];
}): Promise<void> {
  const conflictCode = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('flow-candidate-privacy-feed'))");
    const nextGeneration = Number((await client.query(
      "SELECT COALESCE(active_generation,0)+1 AS generation FROM candidate_privacy_sync_state WHERE consumer_name='flow' FOR UPDATE",
    )).rows[0]?.generation ?? 1);
    const mapped: Array<{ directive: MemorySnapshotDirective; requestId: string }> = [];
    for (const directive of input.directives) {
      const request = (await client.query(
        "SELECT request_id,action FROM candidate_privacy_requests WHERE directive_id=$1",
        [directive.directive_id],
      )).rows[0];
      if (!request) {
        await client.query(
          `INSERT INTO candidate_privacy_sync_state
             (consumer_name,cursor,status,last_error_code,updated_at)
           VALUES ('flow',$1,'needs_reconciliation','unknown_directive',now())
           ON CONFLICT (consumer_name) DO UPDATE
             SET status='needs_reconciliation',last_error_code='unknown_directive',updated_at=now()`,
          [input.highWaterCursor],
        );
        return "candidate_privacy_unknown_directive";
      }
      const expectedScope = request.action === "request_erasure" ? "active_profile" : "global_matching";
      if (directive.action !== request.action || directive.scope !== expectedScope) {
        await client.query(
          `INSERT INTO candidate_privacy_sync_state
             (consumer_name,cursor,status,last_error_code,updated_at)
           VALUES ('flow',$1,'needs_reconciliation','authority_conflict',now())
           ON CONFLICT (consumer_name) DO UPDATE
             SET status='needs_reconciliation',last_error_code='authority_conflict',updated_at=now()`,
          [input.highWaterCursor],
        );
        return "candidate_privacy_authority_conflict";
      }
      mapped.push({ directive, requestId: String(request.request_id) });
    }
    for (const item of mapped) {
      const { directive, requestId } = item;
      await client.query(
        `INSERT INTO candidate_privacy_remote_projection
           (directive_id,request_id,action,scope,state,decision,version,effective_at,generation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (directive_id) DO UPDATE SET
           action=EXCLUDED.action,scope=EXCLUDED.scope,state=EXCLUDED.state,
           decision=EXCLUDED.decision,version=EXCLUDED.version,
           effective_at=EXCLUDED.effective_at,generation=EXCLUDED.generation,updated_at=now()`,
        [
          directive.directive_id, requestId, directive.action, directive.scope,
          directive.state, decisionForRemote(directive.state, directive.action),
          directive.version, directive.effective_at, nextGeneration,
        ],
      );
    }
    await client.query(
      "DELETE FROM candidate_privacy_remote_projection WHERE generation<>$1",
      [nextGeneration],
    );
    await client.query(
      `INSERT INTO candidate_privacy_sync_state
         (consumer_name,cursor,active_generation,status,last_success_at,last_snapshot_at,last_error_code,updated_at)
       VALUES ('flow',$1,$2,'healthy',now(),now(),NULL,now())
       ON CONFLICT (consumer_name) DO UPDATE SET
         cursor=EXCLUDED.cursor,active_generation=EXCLUDED.active_generation,status='healthy',
         last_success_at=now(),last_snapshot_at=now(),last_error_code=NULL,updated_at=now()`,
      [input.highWaterCursor, nextGeneration],
    );
    return null;
  });
  if (conflictCode) throw new CandidatePrivacyConflict(conflictCode);
}

export async function privacyDecisionForAnchor(
  anchor: SubjectAnchor,
  options: { globalUse: boolean; newGlobalOperation?: boolean },
): Promise<FlowPrivacyDecision> {
  if (options.newGlobalOperation) {
    const sync = (await pool.query(
      "SELECT status,last_success_at FROM candidate_privacy_sync_state WHERE consumer_name='flow'",
    )).rows[0];
    const staleMs = Number(process.env.FLOW_CANDIDATE_PRIVACY_STALE_MS ?? 120_000);
    if (!sync || sync.status !== "healthy" || !sync.last_success_at
      || Date.now() - new Date(sync.last_success_at).getTime() > staleMs) {
      return "review";
    }
  }
  const columns: Record<SubjectType, string> = {
    candidate_user: "candidate_user_id",
    application: "application_id",
    candidate_resume: "candidate_resume_id",
    talent_pool: "talent_pool_id",
    job_sourced_candidate: "job_sourced_candidate_id",
  };
  const column = columns[anchor.type];
  const rows = (await pool.query(
    `SELECT r.action,r.state,p.decision AS remote_decision
       FROM candidate_privacy_subject_links l
       JOIN candidate_privacy_requests r ON r.request_id=l.request_id
       LEFT JOIN candidate_privacy_remote_projection p ON p.request_id=r.request_id
      WHERE l.subject_type=$1 AND l.${column}=$2
        AND r.state IN ('accepted_local','delivery_pending','memory_active','needs_review')`,
    [anchor.type, anchor.id],
  )).rows;
  let result: FlowPrivacyDecision = "allow_existing_org_workflow";
  for (const row of rows) {
    const remote: RemotePrivacyDecision | null = row.remote_decision ?? null;
    const decision: RemotePrivacyDecision = row.state === "needs_review"
      ? "review"
      : remote ?? (row.action === "request_erasure" ? "block_all" : "block_global");
    if (decision === "review") return "review";
    if (decision === "block_all") result = "block_all";
    if (decision === "block_global" && options.globalUse && result !== "block_all") result = "block_global";
  }
  return result;
}

export async function syncCursor(): Promise<number> {
  return Number((await pool.query(
    "SELECT cursor FROM candidate_privacy_sync_state WHERE consumer_name='flow'",
  )).rows[0]?.cursor ?? 0);
}
