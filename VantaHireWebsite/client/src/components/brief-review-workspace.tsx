import { Plus } from 'lucide-react';
import { Button } from './ui/button';
import type { BriefPayload } from '../../../server/job-brief/contracts';
import type { ReviewDisposition } from '../../../shared/brief-review';
import type { BriefCriterion, BriefReviewWorkspace } from '../lib/job-brief';

/** Initial criteria: the items the server proposed for inclusion (reason null), in server order. */
export function initialCriteria(ws: BriefReviewWorkspace): BriefCriterion[] {
  return ws.items.filter(i => i.reason === null && i.proposedCriterion).map(i => i.proposedCriterion!);
}

/** Items from the JD whose criterion is not in the current list. Nothing is dropped from the saved inventory. */
export function notIncluded(ws: BriefReviewWorkspace, payload: BriefPayload) {
  const present = new Set(payload.criteria.map(c => c.id));
  return ws.items.filter(i => !(i.proposedCriterion && present.has(i.proposedCriterion.id)));
}

/** Saved record of what was included; everything else is simply "not chosen" (no reasons asked of the recruiter). */
export function selectionFor(ws: BriefReviewWorkspace, payload: BriefPayload): ReviewDisposition[] {
  const present = new Set(payload.criteria.map(c => c.id));
  return ws.items.map(i => i.proposedCriterion && present.has(i.proposedCriterion.id)
    ? { itemId: i.id, state: 'included', criterionIds: [i.proposedCriterion.id] }
    : { itemId: i.id, state: 'excluded', reason: 'other' });
}

export function AlsoInJd({ workspace, payload, canAdd, onAdd, disabled }: {
  workspace: BriefReviewWorkspace; payload: BriefPayload; canAdd: boolean; onAdd: (c: BriefCriterion) => void; disabled?: boolean;
}) {
  const items = notIncluded(workspace, payload);
  if (items.length === 0 && !workspace.extractionLimit) return null;
  return <section aria-label="Also in the JD, not included" className="space-y-2 rounded-md border border-dashed p-3">
    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Also in the JD, not included
      <span className="font-normal normal-case tracking-normal"> · {items.length}</span></h3>
    {workspace.extractionLimit && <p className="text-sm text-muted-foreground">The AI may have missed some requirements in this long JD. Check the JD too.</p>}
    <ul className="flex flex-wrap gap-2">{items.map(item => <li key={item.id}>
      {item.proposedCriterion && item.span
        ? <Button type="button" variant="outline" className="min-h-[44px] rounded-full" disabled={disabled || !canAdd}
            title={`From the JD: “${item.quote}”`} aria-label={`Add “${item.text}” to the criteria`} onClick={() => onAdd(item.proposedCriterion!)}>
            <Plus className="h-4 w-4" aria-hidden />{item.text}</Button>
        : <span className="inline-flex min-h-[44px] items-center rounded-full border px-3 text-sm text-muted-foreground" title={item.quote}>{item.text}</span>}
    </li>)}</ul>
    {!canAdd && items.length > 0 && <p className="text-xs text-muted-foreground">All 12 slots are used. Remove a criterion to add one of these.</p>}
  </section>;
}
