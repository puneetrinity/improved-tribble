import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/use-auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Plus, X } from 'lucide-react';
import { AlsoInJd, initialCriteria, selectionFor } from './brief-review-workspace';
import { useJobBrief, jobIntentRequest, readBriefCapability, type JobBrief, type BriefReviewWorkspace } from '../lib/job-brief';
import { readSourcing, readSourcingCapability, type SourcingPreview } from '../lib/sourcing-authority';
import type { BriefPayload } from '../../../server/job-brief/contracts';
import { acceptedSkillsShape, duplicateSkillNames, overlappingSkillCriteria, skillAlternativesFromEditor } from '../../../shared/skill-alternatives';
import { locationProblemText, locationValueProblem, splitLocation } from '../../../shared/brief-location';

type Criterion = BriefPayload['criteria'][number];
export const MAX_CRITERIA = 12;
export const BRIEF_SCHEMA = 4 as const;
const empty: BriefPayload = { schemaVersion: BRIEF_SCHEMA, compilerVersion: BRIEF_SCHEMA, taxonomyVersion: BRIEF_SCHEMA, criteria: [] };

/** Values the recruiter already entered on the Details step. Used only as labelled suggestions. */
export type CriteriaDetails = { title: string; location: string; experienceYears: string; skills: string[]; goodToHaveSkills: string[] };

const recruiter = { kind: 'recruiter_edit' } as const;
const JUDGED = ['responsibility', 'leadership', 'availability'];
/** Same rule as the server's AI draft: judged criteria stay recruiter-only, work eligibility keeps its own rule,
 * everything else can be met by a profile or by what the candidate provided (a previous applicant's resume). */
const evidenceFor = (subject: Criterion['subject']): Criterion['evidenceKinds'] =>
  JUDGED.includes(subject) ? ['recruiter_judgement']
    : subject === 'work_eligibility' ? ['candidate_provided'] : ['profile_evidence', 'candidate_provided'];
/** Explicit save of an older brief only. Never applied on load: an approved older brief stays as approved. */
export function upgradedPayload(p: BriefPayload): BriefPayload {
  if (p.schemaVersion >= BRIEF_SCHEMA) return p;
  return { ...p, schemaVersion: BRIEF_SCHEMA, compilerVersion: BRIEF_SCHEMA, taxonomyVersion: BRIEF_SCHEMA,
    criteria: p.criteria.map(c => c.evidenceKinds.includes('profile_evidence') && !c.evidenceKinds.includes('candidate_provided')
      && !JUDGED.includes(c.subject) && c.subject !== 'work_eligibility'
      ? { ...c, evidenceKinds: [...c.evidenceKinds, 'candidate_provided'] } : c) };
}
export function skillCriterion(name: string, cls: 'must_have' | 'preferred'): Criterion {
  return { id: crypto.randomUUID(), label: name, class: cls, subject: 'skill', use: 'assessment', evidenceKinds: evidenceFor('skill'),
    requirement: { kind: 'accepted_skills', primary: name, alternatives: [] }, provenance: recruiter };
}
function experienceCriterion(minimum: number): Criterion {
  return { id: crypto.randomUUID(), label: 'Experience', class: 'must_have', subject: 'experience_years', use: 'assessment',
    evidenceKinds: evidenceFor('experience_years'), requirement: { kind: 'minimum_years', minimum }, provenance: recruiter };
}
/** Scored place in the value ("City, Country" or "Country"); hybrid/remote/office wording in the note. Never invents a
 * place: without a country the recruiter's wording stays in the field and the screen asks for the country. */
function locationCriterion(raw: string): Criterion {
  const { place, note } = splitLocation(raw);
  return { id: crypto.randomUUID(), label: 'Location', class: 'must_have', subject: 'location', use: 'assessment',
    evidenceKinds: evidenceFor('location'), requirement: { kind: 'text', value: place ?? raw.trim() }, provenance: recruiter,
    ...(place && note ? { note } : {}) };
}
function otherCriterion(): Criterion {
  return { id: crypto.randomUUID(), label: '', class: 'preferred', subject: 'relevant_work', use: 'assessment',
    evidenceKinds: evidenceFor('relevant_work'), requirement: { kind: 'text', value: '' }, provenance: recruiter };
}

/**
 * The AI can leave out location or experience (e.g. it parks "Location: …" with the leftovers). Those two slots are
 * always reserved, so fill a missing one from the Details values the recruiter already confirmed. Never overwrites.
 */
export function withDetailFoundations(p: BriefPayload, d: CriteriaDetails, ws?: BriefReviewWorkspace | null): BriefPayload {
  // If the JD itself states conflicting values, the recruiter chooses; Details must not quietly pick one.
  const conflicted = new Set<string>((ws?.items ?? []).filter((i) => i.reason === 'conflicting_foundation'
    || (i.topic === 'location' && !i.proposedCriterion))
    .map((i) => (i.topic === 'overall_experience' ? 'experience_years' : i.topic)));
  const has = (subject: string) => conflicted.has(subject) || p.criteria.some((c) => c.subject === subject);
  const add: Criterion[] = [];
  const years = Number(d.experienceYears);
  if (!has('experience_years') && d.experienceYears.trim() !== '' && Number.isFinite(years) && years >= 0) add.push(experienceCriterion(years));
  if (!has('location') && d.location.trim()) add.push(locationCriterion(d.location.trim()));
  return add.length ? { ...p, criteria: [...add, ...p.criteria] } : p;
}

/** Starter criteria built only from Details values. Never presented as a complete or checked brief. */
export function starterCriteria(d: CriteriaDetails): BriefPayload {
  const criteria: Criterion[] = [];
  const years = Number(d.experienceYears);
  if (d.experienceYears.trim() !== '' && Number.isFinite(years) && years >= 0) criteria.push(experienceCriterion(years));
  if (d.location.trim()) criteria.push(locationCriterion(d.location.trim()));
  const seen = new Set<string>();
  for (const [names, cls] of [[d.skills, 'must_have'], [d.goodToHaveSkills, 'preferred']] as const) {
    for (const raw of names) { const name = raw.trim(); const key = name.toLowerCase();
      if (name && !seen.has(key)) { seen.add(key); criteria.push(skillCriterion(name, cls)); } }
  }
  return { ...empty, criteria };
}

export type Suggestion = { name: string; cls: 'must_have' | 'preferred' };
/**
 * Starter plan from Details. If everything fits in 12 it is prefilled (still labelled as suggestions).
 * If not, only experience and location are prefilled and every skill stays listed as a suggestion for the
 * recruiter to pick — nothing is silently truncated or dropped.
 */
export function starterPlan(d: CriteriaDetails): { payload: BriefPayload; suggestions: Suggestion[] } {
  const full = starterCriteria(d);
  if (usedSlots(full) <= MAX_CRITERIA) return { payload: full, suggestions: [] };
  const s = sections(full);
  const suggestions = [...s.must, ...s.nice].flatMap(c => c.requirement.kind === 'accepted_skills'
    ? [{ name: c.requirement.primary, cls: c.class === 'must_have' ? 'must_have' as const : 'preferred' as const }] : []);
  return { payload: { ...full, criteria: [...s.experience, ...s.location] }, suggestions };
}

export type Sections = { experience: Criterion[]; location: Criterion[]; must: Criterion[]; nice: Criterion[]; other: Criterion[] };
export function sections(payload: BriefPayload): Sections {
  const s: Sections = { experience: [], location: [], must: [], nice: [], other: [] };
  for (const c of payload.criteria) {
    if (c.subject === 'experience_years') s.experience.push(c);
    else if (c.subject === 'location') s.location.push(c);
    else if (c.subject === 'skill' && c.class === 'must_have') s.must.push(c);
    else if (c.subject === 'skill' && c.class === 'preferred') s.nice.push(c);
    else s.other.push(c);
  }
  return s;
}
/** Experience and location always occupy two of the twelve slots, filled or not. */
export function usedSlots(payload: BriefPayload): number {
  const s = sections(payload);
  return 2 + s.must.length + s.nice.length + s.other.length;
}
export function foundationsReady(payload: BriefPayload): boolean {
  const s = sections(payload);
  const exp = s.experience[0]?.requirement; const loc = s.location[0]?.requirement;
  return s.experience.length === 1 && s.location.length === 1 && !!exp && 'minimum' in exp && Number.isFinite(exp.minimum) && exp.minimum >= 0
    && (exp.kind !== 'experience_range' || (Number.isFinite(exp.maximum) && exp.maximum >= exp.minimum))
    && !!loc && loc.kind === 'text' && locationValueProblem(loc.value) === null;
}
function cleaned(payload: BriefPayload): BriefPayload {
  return { ...payload, criteria: payload.criteria.map(c => {
    if (c.requirement.kind === 'accepted_skills') {
      const primary = c.requirement.primary.trim();
      return { ...c, label: c.label.trim() || primary, requirement: { ...c.requirement, primary, alternatives: skillAlternativesFromEditor(c.requirement.alternatives.join('\n')) } };
    }
    if (c.requirement.kind === 'text') return { ...c, label: c.label.trim() || c.requirement.value.trim().slice(0, 120), requirement: { kind: 'text' as const, value: c.requirement.value.trim() } };
    return c;
  }) };
}
function namesValid(payload: BriefPayload): boolean {
  return !payload.criteria.some(c => c.requirement.kind === 'accepted_skills' && (!acceptedSkillsShape.safeParse(c.requirement).success || duplicateSkillNames(c.requirement)))
    && overlappingSkillCriteria(payload.criteria).length === 0
    && payload.criteria.every(c => c.requirement.kind !== 'text' || c.requirement.value.length > 0);
}

function draftFailureMessage(code: unknown): string {
  const known: Record<string, string> = {
    BRIEF_MODEL_INVALID: 'We could not build a complete, valid draft from this JD.',
    BRIEF_MODEL_TRUNCATED: 'The AI answer was incomplete.', BRIEF_MODEL_TIMEOUT: 'AI drafting timed out.',
    BRIEF_MODEL_FAILED: 'AI drafting was unavailable.', BRIEF_MODEL_UNKNOWN: 'The AI drafting outcome is unknown.',
    BRIEF_DRAFT_STALE: 'The JD changed while the AI was drafting.',
  };
  const found = typeof code === 'string' ? /\bBRIEF_[A-Z_]+\b/.exec(code)?.[0] : undefined;
  if (found === 'BRIEF_DRAFT_LIMIT') return 'The AI drafting limit for this JD is reached. Edit the criteria yourself.';
  return (found && Object.hasOwn(known, found) ? known[found] : 'No usable AI draft is available.') + ' Review the JD and edit the criteria below.';
}
function actionError(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  if (text === 'SKILL_NAMES_INVALID') return 'Fix the skill names: no blanks, duplicates or names shared between skills.';
  if (/\bBRIEF_FOUNDATIONS_REQUIRED\b/.test(text)) return 'Add the experience and location criteria, then approve again. Your edits are kept.';
  if (/\bBRIEF_DRAFT_LIMIT\b/.test(text)) return 'The AI drafting limit for this JD is reached. Edit the criteria yourself.';
  if (/BRIEF_UPDATED_APPROVAL_REQUIRED/.test(text)) return 'The criteria changed. Review and approve again. Your edits are kept.';
  if (/\bBRIEF_REVIEW_REQUIRED\b/.test(text)) return 'Decide on every requirement left out, confirm you reviewed them, then approve again.';
  if (/\bBRIEF_REVIEW_CONFLICT\b/.test(text)) return 'The requirement list changed. Load the latest version, review it, then approve again.';
  if (/\bBRIEF_INVALID_REVIEW\b/.test(text)) return 'The review could not be saved. Reload the page and try again. Your edits are kept until you reload.';
  if (/\bBRIEF_(REVISION|SOURCE|REQUEST)_CONFLICT\b/.test(text)) return 'These criteria were changed in another tab or by a teammate. Reload the page to see the latest version, then approve again.';
  return 'The change was not confirmed. Your edits are kept. Retry, or reload the saved criteria after a conflict.';
}

function PoolCard({ jobId, actorId, brief, outdated }: { jobId: number; actorId: number; brief: JobBrief; outdated: boolean }) {
  const capability = useQuery({ queryKey: ['sourcing-capability', actorId], queryFn: readSourcingCapability, retry: false });
  const approved = !!brief.approvedVersionId;
  const enabled = approved && capability.data?.sourcingEnabled === true;
  const preview = useQuery({ queryKey: ['sourcing-preview', actorId, jobId], enabled,
    queryFn: ({ signal }) => readSourcing<SourcingPreview>(jobId, 'preview', signal), retry: false,
    refetchInterval: q => (q.state.data?.state === 'complete' ? false : 4000) });
  const p = preview.data;
  let body: JSX.Element;
  if (!approved) body = <p>Available after you approve the criteria.</p>;
  else if (capability.data && !capability.data.sourcingEnabled) body = <p>Pool size isn't available for your workspace yet. This doesn't stop you posting the job.</p>;
  else if (preview.isError) body = <><p className="font-medium">We couldn't check the pool size right now.</p>
    <p className="text-sm text-muted-foreground">This doesn't stop you posting the job.</p>
    <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => void preview.refetch()}>Try again</Button></>;
  else if (p?.state === 'complete' && p.count !== null) {
    const stale = outdated || p.stale;
    body = <>
      <p className="text-3xl font-bold tabular-nums">{p.countRelation === 'gte' ? 'At least ' : 'About '}{p.count.toLocaleString()}</p>
      {stale && <p className="text-sm font-medium text-warning-foreground">Out of date — the criteria changed. Approve again to refresh.</p>}
      <p>profiles in the pool match the search filters prepared from your approved brief. When you start sourcing from Find candidates, we'll search this pool for candidates.</p>
      <p className="text-sm text-muted-foreground">Estimate — not the number of candidates you will receive. No sourcing has started.</p>
      {p.observedAt && <p className="text-xs text-muted-foreground">Checked {new Date(p.observedAt).toLocaleString()}</p>}
    </>;
  } else if (p && (p.preparation === 'failed' || p.preparation === 'unknown')) body = <p>We couldn't prepare the pool check for this brief. You can still post the job and check again from Find candidates.</p>;
  else body = <p className="flex items-center gap-2"><span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none" />Checking matching profiles…</p>;
  return <aside aria-live="polite" aria-label="Pool size" className="space-y-2 rounded-lg border bg-muted/40 p-4 lg:sticky lg:top-4">
    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Pool size for your approved brief</h3>{body}
  </aside>;
}

function SkillRow({ c, onChange, onRemove }: { c: Criterion; onChange: (c: Criterion) => void; onRemove: () => void }) {
  if (c.requirement.kind !== 'accepted_skills') return null;
  const req = c.requirement;
  return <div className="grid items-end gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">Skill
      <Input className="min-h-[44px] text-sm text-foreground" value={req.primary} maxLength={120} aria-invalid={!req.primary.trim()}
        onChange={e => onChange({ ...c, label: e.target.value, provenance: recruiter, requirement: { ...req, primary: e.target.value } })} /></label>
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">Also accepted (any one counts, comma-separated)
      <Input className="min-h-[44px] text-sm text-foreground" placeholder="e.g. K8s" value={req.alternatives.join(', ')}
        onChange={e => onChange({ ...c, provenance: recruiter, requirement: { ...req, alternatives: e.target.value.split(',').map(v => v.trimStart()) } })} /></label>
    <Button type="button" variant="ghost" className="min-h-[44px]" aria-label={`Remove ${req.primary || 'this skill'}`} onClick={onRemove}><X className="h-4 w-4" aria-hidden />Remove</Button>
  </div>;
}

export function HiringCriteriaStep({ jobId, actorId, details, onSubmitted, jobStatus = 'draft' }: { jobId: number; actorId: number; details: CriteriaDetails; onSubmitted: () => void; jobStatus?: string | undefined }) {
  const query = useJobBrief(jobId, actorId, true);
  const cache = useQueryClient();
  const briefCapability = useQuery({ queryKey: ['job-brief-capability'], queryFn: readBriefCapability });
  const [payload, setPayload] = useState<BriefPayload>(empty);
  const [origin, setOrigin] = useState<'saved' | 'ai' | 'starter' | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // A failed AI draft may be retried once more by a deliberate click (server limit: 2 attempts per JD); never on reload.
  const [retryable, setRetryable] = useState(false);
  const draftFailed = (code: unknown) => { setNotice(draftFailureMessage(code)); setRetryable(!/\bBRIEF_DRAFT_LIMIT\b/.test(String(code ?? ''))); };
  const autoTried = useRef(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // The exact server version (and revision) the criteria on screen came from. Save and approve are bound to it,
  // so a change made in another tab can never be approved without being shown here first.
  const [base, setBase] = useState<{ versionId: string | null; revision: string } | null>(null);
  const workspaceFor = (b: typeof query.data) => b?.reviewWorkspace && b.reviewWorkspace.sourceHash === b.sourceHash ? b.reviewWorkspace : null;
  const applyStarter = () => { const plan = starterPlan(details); setPayload(plan.payload); setSuggestions(plan.suggestions); setOrigin('starter');
    setBase({ versionId: null, revision: query.data?.revision ?? '0' }); };
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  // Warn before a reload or closing the tab would lose unsaved criteria edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Initial content: saved brief, else a returned AI draft, else labelled starter suggestions.
  useEffect(() => {
    const brief = query.data; if (!brief || dirty || origin !== null || briefCapability.isPending) return;
    const ws = workspaceFor(brief);
    if (ws) {
      // Server-backed review: restore saved decisions for the version on screen, else start from the AI's proposal.
      const savedHere = !!brief.latest && ws.versionId === brief.latest.version_id;
      const start = savedHere ? brief.latest!.payload
        : withDetailFoundations(brief.draft?.result ?? { ...empty, criteria: initialCriteria(ws) }, details, ws);
      setPayload(start); setOrigin(savedHere ? 'saved' : 'ai'); setSuggestions([]);
      setBase({ versionId: savedHere ? brief.latest!.version_id : null, revision: brief.revision });
      return;
    }
    if (brief.latest) { setPayload(brief.latest.payload); setOrigin('saved'); setBase({ versionId: brief.latest.version_id, revision: brief.revision }); return; }
    if (brief.draft?.state === 'succeeded' && brief.draft.result) { setPayload(withDetailFoundations(brief.draft.result, details)); setOrigin('ai'); setBase({ versionId: null, revision: brief.revision }); return; }
    const pending = brief.draft?.state === 'dispatched';
    const autoOn = briefCapability.data?.autoDraftEnabled === true;
    if (!brief.draft && autoOn && !autoTried.current) return; // automatic draft below decides
    if (pending) return;
    applyStarter();
    if (brief.draft && ['failed', 'stale', 'unknown'].includes(brief.draft.state)) draftFailed(brief.draft.code);
  }, [query.data, dirty, origin, briefCapability.data, details]);

  // Automatic first draft: once, only when the server switch is on. The database decides whether it may run.
  useEffect(() => {
    const brief = query.data;
    if (!brief || autoTried.current || briefCapability.data?.autoDraftEnabled !== true || brief.latest || brief.draft) return;
    autoTried.current = true; setDrafting(true);
    void (async () => {
      try {
        const result = await jobIntentRequest(actorId, jobId, 'draft-automatic', `/api/jobs/${jobId}/brief/draft`, { expectedRevision: Number(brief.revision), mode: 'automatic' }, 'POST');
        if (result.state === 'succeeded' && result.result) {
          if (dirtyRef.current) setNotice('An AI draft arrived. Your edits were kept.');
          else { setPayload(withDetailFoundations(result.result, details)); setOrigin('ai'); setBase({ versionId: null, revision: brief.revision }); }
        } else if (result.state === 'skipped' || result.state === 'review_required') { await query.refetch(); }
        else { if (!dirtyRef.current) applyStarter(); draftFailed(result.code); }
      } catch (e) { if (!dirtyRef.current) applyStarter(); draftFailed(e instanceof Error ? e.message : undefined); }
      finally { setDrafting(false); }
    })();
  }, [query.data, briefCapability.data]);

  // Deliberate retry after a failed draft. One click = one request. The request id is only replaced after the server
  // CONFIRMS a terminal outcome (a finished HTTP 200 result; jobIntentRequest keeps it for 'dispatched'). Every error — unavailable,
  // retry-same-request, lost response — keeps it, so the next click replays the same request: never a second paid call.
  const retryDraft = async () => {
    const brief = query.data; if (!brief || drafting) return;
    const body = { expectedRevision: Number(brief.revision), mode: 'manual' as const };
    setDrafting(true); setError('');
    try {
      const result = await jobIntentRequest(actorId, jobId, 'draft-retry', `/api/jobs/${jobId}/brief/draft`, body, 'POST');
      if (['succeeded', 'review_required', 'skipped', 'dispatched'].includes(result.state)) {
        // dispatched = a replay found the earlier request still running: wait for it like any in-flight draft.
        await query.refetch(); setRetryable(false); setNotice(''); setDirty(false); setOrigin(null);
      } else draftFailed(result.code);
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
      if (/\bBRIEF_DRAFT_LIMIT\b/.test(text)) draftFailed('BRIEF_DRAFT_LIMIT');
      else if (/\bBRIEF_DRAFT_INFLIGHT\b/.test(text)) { await query.refetch(); setRetryable(false); setNotice(''); setDirty(false); setOrigin(null); }
      else setNotice('We could not confirm whether the AI draft ran. Trying again checks the same request and will not start a second one.');
    } finally { setDrafting(false); }
  };

  const inFlight = query.data?.draft?.state === 'dispatched' && origin === null;
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => { void query.refetch(); }, 3000);
    return () => clearInterval(timer);
  }, [inFlight]);

  if (query.isPending || ((drafting || inFlight) && origin === null)) return <div className="space-y-2" role="status">
    <p className="flex items-center gap-2"><span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none" />
      {drafting || inFlight ? 'Drafting the hiring criteria from your JD…' : 'Loading the hiring criteria…'}</p>
    {(drafting || inFlight) && <p className="text-sm text-muted-foreground">Usually a few seconds. Nothing is approved until you approve it.</p>}
  </div>;
  if (query.isError || !query.data) return <p role="alert">The hiring criteria are unavailable. Your job draft is saved. <Button type="button" variant="outline" onClick={() => void query.refetch()}>Retry</Button></p>;
  const brief = query.data;
  if (jobStatus !== 'draft') return <section aria-label="Hiring criteria" className="space-y-3">
    <p role="status" className="rounded-md bg-success/10 p-3 text-sm"><strong>Sent for admin approval.</strong> This job and its criteria are waiting for admin approval. It becomes visible to candidates once approved and published.</p>
    <Button type="button" className="min-h-[44px]" onClick={onSubmitted}>Open the job</Button>
  </section>;
  const s = sections(payload);
  const used = usedSlots(payload);
  const approvedCurrent = !!brief.approvedVersionId && !dirty && !!base?.versionId && base.versionId === brief.approvedVersionId
    && brief.latest?.version_id === base.versionId;
  // Someone (another tab or teammate) saved a newer version than the one on screen.
  const changedElsewhere = !!base && (brief.latest?.version_id ?? null) !== base.versionId && Number(brief.revision) !== Number(base.revision);
  const reloadLatest = () => { setDirty(false); setOrigin(null); setBase(null); setSuggestions([]); setNotice(''); setError(''); };
  const olderFormat = payload.schemaVersion < BRIEF_SCHEMA;
  const ready = foundationsReady(payload) && used <= MAX_CRITERIA && namesValid(cleaned(payload)) && payload.criteria.length > 0;

  const ws = workspaceFor(brief);
  const edit = (next: Criterion[]) => {
    const nextPayload = { ...payload, criteria: next };
    setPayload(nextPayload); setDirty(true); setError('');
  };
  const replace = (id: string, c: Criterion) => edit(payload.criteria.map(x => x.id === id ? c : x));
  const remove = (id: string) => edit(payload.criteria.filter(x => x.id !== id));
  const add = (c: Criterion) => { if (used < MAX_CRITERIA) edit([...payload.criteria, c]); };
  const setExperienceMax = (raw: string) => {
    const current = s.experience[0]; if (!current || !('minimum' in current.requirement)) return;
    const minimum = current.requirement.minimum;
    replace(current.id, { ...current, provenance: recruiter, requirement: raw === '' ? { kind: 'minimum_years', minimum } : { kind: 'experience_range', minimum, maximum: Number(raw) } });
  };
  const setExperience = (raw: string) => {
    const minimum = raw === '' ? NaN : Number(raw);
    const current = s.experience[0];
    if (!current) { edit([...payload.criteria, experienceCriterion(minimum)]); return; }
    replace(current.id, { ...current, provenance: recruiter, requirement: current.requirement.kind === 'experience_range' ? { ...current.requirement, minimum } : { kind: 'minimum_years', minimum } });
  };
  const setLocation = (value: string) => {
    const current = s.location[0];
    if (!current) { edit([...payload.criteria, locationCriterion(value)]); return; }
    replace(current.id, { ...current, provenance: recruiter, requirement: { kind: 'text', value } });
  };
  const setArrangement = (value: string) => {
    const current = s.location[0];
    if (!current) return;
    const { note: _old, ...rest } = current;
    replace(current.id, { ...rest, provenance: recruiter, ...(value.trim() ? { note: value.slice(0, 300) } : {}) });
  };

  const approve = async () => {
    if (!base) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const historical = payload.schemaVersion < BRIEF_SCHEMA;
      const saved = cleaned(upgradedPayload(payload));
      if (!namesValid(saved)) throw Error('SKILL_NAMES_INVALID');
      let target = { versionId: base.versionId, revision: base.revision };
      if (dirty || !base.versionId || historical) {
        // Save exactly what is on screen against the revision it was loaded from; a newer revision conflicts.
        const result = await jobIntentRequest(actorId, jobId, 'save-brief', `/api/jobs/${jobId}/brief`, { currentJD: brief.currentJD, sourceChoice: 'current_jd',
          requesterKind: 'recruiter', reasonCode: 'other', expectedRevision: Number(base.revision), payload: saved,
          ...(ws ? { reviewSelection: { extractionId: ws.extractionId, dispositions: selectionFor(ws, saved) } } : {}) });
        if (typeof result?.versionId !== 'string' || result?.revision === undefined) throw Error('BRIEF_UPDATED_APPROVAL_REQUIRED');
        target = { versionId: result.versionId, revision: String(result.revision) };
        setBase(target); setDirty(false); setOrigin('saved');
      }
      const approved = await jobIntentRequest(actorId, jobId, 'approve-brief', `/api/jobs/${jobId}/brief/approve`,
        { expectedRevision: Number(target.revision), versionId: target.versionId }, 'POST');
      setBase({ versionId: target.versionId, revision: String(approved?.revision ?? target.revision) });
      setDirty(false); setOrigin('saved');
      await cache.invalidateQueries({ queryKey: ['job-brief', actorId, jobId] });
      await cache.invalidateQueries({ queryKey: ['sourcing-preview', actorId, jobId] });
      setNotice('Criteria approved. No sourcing has started.');
    } catch (e) { setError(actionError(e)); } finally { setBusy(false); }
  };


  const submit = async () => {
    setSubmitting(true); setError(''); setNotice('');
    try {
      // Same request identity is reused after an uncertain response; never navigate before confirmation.
      await jobIntentRequest(actorId, jobId, 'submit-brief', `/api/jobs/${jobId}/brief/submit`, { expectedRevision: Number(brief.revision) }, 'POST');
      await cache.invalidateQueries({ queryKey: ['job-brief', actorId, jobId] });
      onSubmitted();
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
 if (/\bBRIEF_SUBMISSION_REQUIRED\b/.test(text)) { onSubmitted(); return; } // already sent: an earlier attempt succeeded
      setError(/\bBRIEF_(APPROVAL_REQUIRED|UPDATED_APPROVAL_REQUIRED)\b/.test(text) ? 'Approve the current criteria before posting the job.'
        : /\bBRIEF_FOUNDATIONS_REQUIRED\b/.test(text) ? 'Add the experience and location criteria, then approve again.'
        : /\bBRIEF_REVISION_CONFLICT\b/.test(text) ? 'This job changed in another tab. Reload the page, check the criteria, then post again.'
        : 'We couldn’t confirm the job was posted. Try Post job again — it won’t be sent twice.');
    } finally { setSubmitting(false); }
  };
  const expReq = s.experience[0]?.requirement;
  const locReq = s.location[0]?.requirement;
  const expMissing = !expReq || !('minimum' in expReq) || !Number.isFinite(expReq.minimum);
  const locProblem = !locReq || locReq.kind !== 'text' ? 'empty' as const : locationValueProblem(locReq.value);
  const locMissing = locProblem !== null;
  const locNote = s.location[0]?.note ?? '';
  const expRangeInvalid = expReq?.kind === 'experience_range' && (!Number.isFinite(expReq.maximum) || expReq.maximum < expReq.minimum);
  const sectionHead = (title: string, note: string) => <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title} <span className="font-normal normal-case tracking-normal">· {note}</span></h3>;

  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
    <section aria-label="Hiring criteria" className="min-w-0 space-y-5">
      <p role="status" className="rounded-md bg-success/10 p-3 text-sm"><strong>Draft saved.</strong> Not sent to admin yet — that happens when you post the job.</p>
      <p className="text-muted-foreground">These decide who we look for. Edit anything, then approve.</p>
      {origin === 'starter' && <p role="status" className="rounded-md bg-warning/10 p-3 text-sm"><strong>From your job details — not checked against the JD.</strong> These come only from the fields you filled in, so they can miss requirements. Review them against the JD.</p>}
      {origin === 'ai' && <p role="status" className="rounded-md bg-primary/10 p-3 text-sm"><strong>Drafted by AI from your JD.</strong> Check every line before approving.</p>}
      {changedElsewhere && !busy && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        <span><strong>These criteria were changed in another tab or by a teammate.</strong> Load the latest version before approving.{dirty ? ' Your unsaved edits here will be replaced.' : ''}</span>
        <Button type="button" variant="outline" className="min-h-[44px]" onClick={reloadLatest}>Load latest version</Button></div>}
      {payload.schemaVersion === 3 && !dirty && <p role="status" className="rounded-md bg-muted/40 p-3 text-sm">To include previous applicants, review these requirements, then save and approve them again.</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {retryable && !dirty && <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="min-h-[44px]" disabled={drafting} onClick={() => void retryDraft()}>
          {drafting ? 'Drafting…' : 'Try the AI draft again'}</Button>
        <span className="text-xs text-muted-foreground">One more try is allowed for this JD.</span></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <p className="text-sm"><strong className="tabular-nums">{used} of {MAX_CRITERIA} criteria used.</strong> Experience and location are always included. A skill and its accepted alternatives count as one.</p>
      {used > MAX_CRITERIA && <p role="alert" className="text-sm text-destructive">Too many criteria. Remove some to get to {MAX_CRITERIA} — keep the ones that matter most.</p>}

      <div className="space-y-2">{sectionHead('Location & experience', '2 of 12 · always included')}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">Minimum years of experience
            <Input className="min-h-[44px]" type="number" min={0} max={80} step="any" aria-describedby={expMissing ? 'exp-missing' : undefined} aria-invalid={expMissing}
              value={expReq && 'minimum' in expReq && Number.isFinite(expReq.minimum) ? expReq.minimum : ''} placeholder="Not stated in the JD — please add"
              onChange={e => setExperience(e.target.value)} />
            {expMissing && <span id="exp-missing" className="text-xs font-normal text-destructive">Required. Enter 0 for entry-level roles.</span>}</label>
          <label className="grid gap-1 text-sm font-medium">Maximum years (optional)
            <Input className="min-h-[44px]" type="number" min={0} max={80} step="any" disabled={expMissing} aria-describedby={expRangeInvalid ? 'exp-range' : undefined} aria-invalid={expRangeInvalid}
              value={expReq?.kind === 'experience_range' ? expReq.maximum : ''} placeholder="No upper limit" onChange={e => setExperienceMax(e.target.value)} />
            {expRangeInvalid && <span id="exp-range" className="text-xs font-normal text-destructive">Must be at least the minimum.</span>}</label>
          <label className="grid gap-1 text-sm font-medium">Location
            <Input className="min-h-[44px]" aria-describedby={locMissing ? 'loc-missing' : 'loc-help'} aria-invalid={locMissing} value={locReq?.kind === 'text' ? locReq.value : ''}
              placeholder="City, Country — e.g. Bengaluru, India" onChange={e => setLocation(e.target.value)} />
            {locMissing ? <span id="loc-missing" className="text-xs font-normal text-destructive">Required. {locationProblemText(locReq?.kind === 'text' ? locReq.value : '', locProblem)}</span>
              : <span id="loc-help" className="text-xs font-normal text-muted-foreground">Candidates are matched on this place.</span>}</label>
          <label className="grid gap-1 text-sm font-medium">Work arrangement (optional)
            <Input className="min-h-[44px]" maxLength={300} disabled={!s.location[0]} value={locNote} aria-describedby="arrangement-help"
              placeholder="e.g. Hybrid, 3 days a week in office" onChange={e => setArrangement(e.target.value)} />
            <span id="arrangement-help" className="text-xs font-normal text-muted-foreground">Shown with the brief; not used to match candidates.</span></label>
        </div>
      </div>

      {([['must', 'Must-have skills', 'must_have'], ['nice', 'Nice-to-have skills', 'preferred']] as const).map(([key, title, cls]) =>
        <div key={key} className="space-y-2">{sectionHead(title, `${s[key].length} · each skill counts as 1`)}
          {s[key].map(c => <SkillRow key={c.id} c={c} onChange={n => replace(c.id, n)} onRemove={() => remove(c.id)} />)}
          <Button type="button" variant="outline" className="min-h-[44px]" disabled={used >= MAX_CRITERIA} onClick={() => add(skillCriterion('', cls))}>Add {cls === 'must_have' ? 'must-have' : 'nice-to-have'} skill</Button>
        </div>)}

      {ws && <AlsoInJd workspace={ws} payload={payload} canAdd={used < MAX_CRITERIA} disabled={busy} onAdd={c => add(c)} />}
      {!ws && suggestions.length > 0 && <div className="space-y-2 rounded-md border border-dashed p-3" aria-label="Suggested skills">
        {sectionHead('Suggested from your job details', `${suggestions.length} · not included yet`)}
        <p className="text-sm text-muted-foreground">Your job details list more skills than fit in {MAX_CRITERIA} criteria. Add the ones that matter most. The rest stay listed here, so nothing is dropped without you seeing it.</p>
        <ul className="flex flex-wrap gap-2">{suggestions.map(sg => <li key={`${sg.cls}:${sg.name}`}>
          <Button type="button" variant="outline" className="min-h-[44px] rounded-full" disabled={used >= MAX_CRITERIA}
            aria-label={`Add ${sg.name} as ${sg.cls === 'must_have' ? 'must-have' : 'nice-to-have'} skill`}
            onClick={() => { add(skillCriterion(sg.name, sg.cls)); setSuggestions(list => list.filter(x => x !== sg)); }}>
            <Plus className="h-4 w-4" aria-hidden />{sg.name} <span className="ml-1 text-xs text-muted-foreground">{sg.cls === 'must_have' ? 'must-have' : 'nice-to-have'}</span></Button></li>)}</ul>
        {used >= MAX_CRITERIA && <p className="text-sm text-muted-foreground">All {MAX_CRITERIA} slots are used. Remove a criterion to add another.</p>}
      </div>}

      <div className="space-y-2">{sectionHead('Other requirements', `${s.other.length} · e.g. title, certifications, mentoring`)}
        {s.other.map(c => <div key={c.id} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          {c.requirement.kind === 'text' ? <Input aria-label="Requirement" className="min-h-[44px]" value={c.requirement.value} maxLength={500}
            onChange={e => replace(c.id, { ...c, label: e.target.value.slice(0, 120), provenance: recruiter, requirement: { kind: 'text', value: e.target.value } })} />
            : <p className="self-center text-sm">{c.label}</p>}
          <select aria-label="Must-have or preferred" className="min-h-[44px] rounded-md border bg-background px-2" value={c.class}
            onChange={e => replace(c.id, { ...c, class: e.target.value as Criterion['class'], provenance: recruiter })} disabled={c.subject === 'title'}>
            <option value="must_have">Must-have</option><option value="preferred">Preferred</option><option value="disqualifier">Review flag</option>
          </select>
          <Button type="button" variant="ghost" className="min-h-[44px]" aria-label={`Remove ${c.label || 'this requirement'}`} onClick={() => remove(c.id)}><X className="h-4 w-4" aria-hidden />Remove</Button>
        </div>)}
        <Button type="button" variant="outline" className="min-h-[44px]" disabled={used >= MAX_CRITERIA} onClick={() => add({ ...otherCriterion(), subject: 'relevant_work', evidenceKinds: evidenceFor('relevant_work') })}>Add other requirement</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="button" className="min-h-[44px]" variant={approvedCurrent && !olderFormat ? 'outline' : 'default'} disabled={busy || (approvedCurrent && !olderFormat) || !ready || changedElsewhere || !base} onClick={() => void approve()}>
          {busy ? 'Approving…' : approvedCurrent ? (olderFormat ? 'Update and approve' : 'Criteria approved') : 'Approve criteria'}</Button>
        <Button type="button" className="min-h-[44px]" disabled={!approvedCurrent || busy || submitting} onClick={() => void submit()}>{submitting ? 'Posting…' : 'Post job'}</Button>
        <p className="w-full text-sm text-muted-foreground">{approvedCurrent ? 'Post job sends the job and these criteria to admin for approval, then opens the job’s applications page.'
          : !foundationsReady(payload) ? 'Add experience and location to approve.'
          : 'Approve the criteria to post the job.'}
          {suggestions.length > 0 && ` ${suggestions.length} suggested skill${suggestions.length === 1 ? ' is' : 's are'} not included.`}</p>
      </div>
    </section>
    <PoolCard jobId={jobId} actorId={actorId} brief={brief} outdated={dirty && !!brief.approvedVersionId} />
  </div>;
}

/** Wizard entry point: resolves the signed-in recruiter only when the criteria step is shown. */
export function HiringCriteriaStepForCurrentUser(props: { jobId: number; details: CriteriaDetails; onSubmitted: () => void; jobStatus?: string | undefined }) {
  const { user } = useAuth();
  if (!user) return <p role="status">Loading…</p>;
  return <HiringCriteriaStep {...props} actorId={user.id} />;
}
