// Default-résumé rules for the candidate library. Exactly one default per candidate (the partial
// unique index enforces at most one); changes are serialized per candidate with an advisory lock
// so concurrent uploads and make-default calls decide from the rows as they are now.
import { and, eq, sql } from 'drizzle-orm';
import { candidateResumes, applications } from '../../shared/schema';

/** Remove only an owned library row. Application snapshots and storage objects are retained. */
export async function removeLibraryResume(db: any, userId: number, resumeId: number): Promise<boolean> {
  return db.transaction(async (tx: any) => {
    // Same ordering as source workers, then library upload/default operations.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(41943, ${userId}::integer)`);
    await lockCandidateResumeDefault(tx, userId);
    const own = await tx.select({ id: candidateResumes.id }).from(candidateResumes)
      .where(and(eq(candidateResumes.userId, userId), eq(candidateResumes.id, resumeId))).limit(1);
    if (!own.length) return false;
    await tx.update(applications).set({ resumeId: null })
      .where(and(eq(applications.resumeId, resumeId), eq(applications.userId, userId)));
    await tx.delete(candidateResumes).where(and(eq(candidateResumes.id, resumeId), eq(candidateResumes.userId, userId)));
    const remaining = await tx.select({ id: candidateResumes.id, isDefault: candidateResumes.isDefault }).from(candidateResumes)
      .where(eq(candidateResumes.userId, userId)).orderBy(candidateResumes.id);
    if (remaining.length && !remaining.some((r: any) => r.isDefault))
      await tx.update(candidateResumes).set({ isDefault: true }).where(eq(candidateResumes.id, remaining[0].id));
    return true;
  });

}

export const CANDIDATE_RESUME_DEFAULT_LOCK = 0x52534d44; // "RSMD"

export async function lockCandidateResumeDefault(tx: any, userId: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${CANDIDATE_RESUME_DEFAULT_LOCK}::integer, ${userId}::integer)`);
}

export type NewLibraryResume = { userId: number; label: string; gcsPath: string; extractedText: string; requestDefault: boolean };

/** Insert a library résumé. It becomes the default when asked, or when the candidate has none.
 * Runs in one transaction: an insert failure leaves the previous default untouched. */
export async function insertLibraryResume(db: any, r: NewLibraryResume) {
  return db.transaction(async (tx: any) => {
    await lockCandidateResumeDefault(tx, r.userId);
    const current = await tx.select({ id: candidateResumes.id }).from(candidateResumes)
      .where(and(eq(candidateResumes.userId, r.userId), eq(candidateResumes.isDefault, true as any))).limit(1);
    const makeDefault = r.requestDefault || current.length === 0;
    if (makeDefault) await tx.update(candidateResumes).set({ isDefault: false }).where(eq(candidateResumes.userId, r.userId));
    const [row] = await tx.insert(candidateResumes)
      .values({ userId: r.userId, label: r.label, gcsPath: r.gcsPath, extractedText: r.extractedText, isDefault: makeDefault })
      .returning();
    return row;
  });
}

/** Make one of the candidate's own résumés the default. False when it isn't theirs (or doesn't exist). */
export async function makeLibraryResumeDefault(db: any, userId: number, resumeId: number): Promise<boolean> {
  return db.transaction(async (tx: any) => {
    await lockCandidateResumeDefault(tx, userId);
    const own = await tx.select({ id: candidateResumes.id }).from(candidateResumes)
      .where(and(eq(candidateResumes.id, resumeId), eq(candidateResumes.userId, userId))).limit(1);
    if (!own.length) return false;
    await tx.update(candidateResumes).set({ isDefault: false }).where(eq(candidateResumes.userId, userId));
    await tx.update(candidateResumes).set({ isDefault: true })
      .where(and(eq(candidateResumes.id, resumeId), eq(candidateResumes.userId, userId)));
    return true;
  });
}
