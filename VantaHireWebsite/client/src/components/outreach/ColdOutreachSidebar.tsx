import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import type { SourcedCandidateForUI } from "@/hooks/use-sourcing";
import { OutreachDraftCard, type OutreachDraftItem } from "@/components/outreach/OutreachDraftCard";

interface DraftPayload {
  candidateIds: number[];
  campaignRound: 1 | 2 | 3;
  extraContext?: string;
}

interface DraftResponse {
  campaignRound: number;
  campaignLabel: string;
  campaignSummary: string;
  drafts: Array<{
    candidateId: number;
    name: string;
    email: string | null;
    subject: string;
    body: string;
  }>;
}

interface SendPayload {
  campaignId: string;
  campaignRound: 1 | 2 | 3;
  extraContext?: string;
  messages: Array<{
    candidateId: number;
    subject: string;
    body: string;
    wasEdited: boolean;
    aiDraftSubject: string;
    aiDraftBody: string;
  }>;
}

interface HistoryCampaign {
  campaignId: string;
  campaignRound: number;
  status: string;
  launchedAt: string;
  completedAt: string | null;
  audienceCount: number;
  sent: number;
  failed: number;
  subjectTemplate: string | null;
  messages: Array<{
    id: number;
    sourcedCandidateId: number;
    recipientEmail: string;
    recipientName: string | null;
    subject: string;
    status: "sent" | "failed";
    errorMessage: string | null;
    sentAt: string;
  }>;
}

interface HistoryState {
  nextAvailableRound: 1 | 2 | 3 | null;
  canStartAnyCampaign: boolean;
  eligibleByRound: Record<1 | 2 | 3, {
    count: number;
    candidateIds: number[];
  }>;
  maxCampaigns: number;
  campaigns: HistoryCampaign[];
}

interface ColdOutreachSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: SourcedCandidateForUI[];
  campaignRound: 1 | 2 | 3;
  history?: HistoryState;
  onDraft: (payload: DraftPayload) => Promise<DraftResponse>;
  onSend: (payload: SendPayload) => Promise<{
    sent: number;
    failed: number;
    campaign: {
      campaignId: string;
      campaignRound: number;
      audienceCount: number;
    };
    results: Array<{
      candidateId: number;
      email: string;
      status: "sent" | "failed";
      errorMessage: string | null;
    }>;
  }>;
  isDrafting: boolean;
  isSending: boolean;
}

type SidebarStage = "setup" | "review" | "sending" | "done";

function campaignButtonLabel(round: number) {
  if (round === 1) return "Start First Campaign";
  if (round === 2) return "Start Second Campaign";
  return "Start Final Campaign";
}

function campaignRoundLabel(round: number) {
  if (round === 1) return "First Campaign";
  if (round === 2) return "Second Campaign";
  return "Final Campaign";
}

export function ColdOutreachSidebar({
  open,
  onOpenChange,
  candidates,
  campaignRound,
  history,
  onDraft,
  onSend,
  isDrafting,
  isSending,
}: ColdOutreachSidebarProps) {
  const [stage, setStage] = useState<SidebarStage>("setup");
  const [extraContext, setExtraContext] = useState("");
  const [drafts, setDrafts] = useState<OutreachDraftItem[]>([]);
  const [campaignLabel, setCampaignLabel] = useState("First Campaign");
  const [campaignSummary, setCampaignSummary] = useState("");
  const [sendSummary, setSendSummary] = useState<{ sent: number; failed: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setStage("setup");
      setExtraContext("");
      setDrafts([]);
      setSendSummary(null);
      setCampaignLabel("First Campaign");
      setCampaignSummary("");
      return;
    }

    setCampaignLabel(campaignRoundLabel(campaignRound));
  }, [open, campaignRound]);

  const eligibleCandidates = useMemo(
    () => candidates.filter((candidate) =>
      history?.eligibleByRound?.[campaignRound]?.candidateIds?.length
        ? history.eligibleByRound[campaignRound].candidateIds.includes(candidate.id)
        : candidate.outreachCount === campaignRound - 1,
    ),
    [candidates, campaignRound, history?.eligibleByRound],
  );
  const candidateIds = eligibleCandidates.map((candidate) => candidate.id);
  const canStartCampaign = candidateIds.length > 0;
  const sendingProgress = useMemo(() => {
    if (stage !== "sending" && stage !== "done") return 0;
    if (!drafts.length) return 0;
    return sendSummary ? ((sendSummary.sent + sendSummary.failed) / drafts.length) * 100 : 65;
  }, [drafts.length, sendSummary, stage]);

  const handleGenerateDrafts = async () => {
    try {
      const payload: DraftPayload = {
        candidateIds,
        campaignRound,
      };
      const nextExtraContext = extraContext.trim();
      if (nextExtraContext) {
        payload.extraContext = nextExtraContext;
      }
      const generated = await onDraft(payload);

      setCampaignLabel(generated.campaignLabel);
      setCampaignSummary(generated.campaignSummary);
      setDrafts(
        generated.drafts.map((draft) => ({
          candidateId: draft.candidateId,
          name: draft.name,
          email: draft.email || "",
          subject: draft.subject,
          body: draft.body,
          aiDraftSubject: draft.subject,
          aiDraftBody: draft.body,
          wasEdited: false,
        })),
      );
      setStage("review");
    } catch {
      setStage("setup");
    }
  };

  const handleSend = async () => {
    setStage("sending");
    try {
      const payload: SendPayload = {
        campaignId: crypto.randomUUID(),
        campaignRound,
        messages: drafts.map((draft) => ({
          candidateId: draft.candidateId,
          subject: draft.subject,
          body: draft.body,
          wasEdited: draft.wasEdited,
          aiDraftSubject: draft.aiDraftSubject,
          aiDraftBody: draft.aiDraftBody,
        })),
      };
      const nextExtraContext = extraContext.trim();
      if (nextExtraContext) {
        payload.extraContext = nextExtraContext;
      }
      const result = await onSend(payload);

      setSendSummary({ sent: result.sent, failed: result.failed });
      setStage("done");
    } catch {
      setStage("review");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle>Cold Outreach Campaign</SheetTitle>
          <SheetDescription>
            Review one job-wide campaign, edit the HTML email, and send to all eligible shortlisted candidates together.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {stage === "setup" && (
            <>
              <div className="rounded-xl border bg-muted/20 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge>{campaignLabel}</Badge>
                  <Badge variant="outline">
                    {history?.eligibleByRound?.[campaignRound]?.count ?? eligibleCandidates.length} eligible
                  </Badge>
                </div>
                <p className="text-sm font-medium">{campaignButtonLabel(campaignRound)}</p>
                <p className="text-sm text-muted-foreground">
                  {campaignRound === 1 && "Simple first-touch outreach for shortlisted candidates."}
                  {campaignRound === 2 && "Follow-up outreach that highlights the opportunity more strongly."}
                  {campaignRound === 3 && "Final outreach that mentions the timeline is closing soon."}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Extra instructions for the draft</Label>
                <Textarea
                  value={extraContext}
                  onChange={(e) => setExtraContext(e.target.value)}
                  className="min-h-24"
                  placeholder="Example: mention remote flexibility, the team stage, or why this role is urgent."
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Eligible candidates</Label>
                  <span className="text-xs text-muted-foreground">
                    {candidateIds.length} candidate{candidateIds.length === 1 ? "" : "s"} will receive this campaign
                  </span>
                </div>
                {eligibleCandidates.map((candidate) => (
                  <div key={candidate.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{candidate.crustdata?.basic_profile?.name || "Candidate"}</p>
                      <p className="text-xs text-muted-foreground truncate">{candidate.foundEmail}</p>
                    </div>
                    <Badge variant="outline">
                      {candidate.outreachCount === 0 ? "New" : `${candidate.outreachCount}/3 sent`}
                    </Badge>
                  </div>
                ))}
              </div>

              {history && history.campaigns.length > 0 && (
                <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                  <p className="text-sm font-medium">Campaign history</p>
                  {history.campaigns.slice(0, 3).map((campaign) => (
                    <div key={campaign.campaignId} className="rounded-lg border bg-background p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{campaignRoundLabel(campaign.campaignRound)}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(campaign.launchedAt).toLocaleDateString("en-GB")}
                          </p>
                        </div>
                        <Badge variant="outline">{campaign.audienceCount} candidates</Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {campaign.sent} sent, {campaign.failed} failed
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {stage === "review" && (
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="flex items-center gap-2">
                  <Badge>{campaignLabel}</Badge>
                  <Badge variant="outline">{drafts.length} drafts</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{campaignSummary}</p>
              </div>

              {drafts.map((draft) => (
                <OutreachDraftCard
                  key={draft.candidateId}
                  draft={draft}
                  onChange={(next) =>
                    setDrafts((current) => current.map((item) => item.candidateId === next.candidateId ? next : item))
                  }
                />
              ))}
            </div>
          )}

          {stage === "sending" && (
            <div className="space-y-4">
              <div className="rounded-xl border p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending outreach emails...
                </div>
                <Progress value={sendingProgress} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  Processing {drafts.length} candidate{drafts.length === 1 ? "" : "s"} in this campaign.
                </p>
              </div>
            </div>
          )}

          {stage === "done" && (
            <div className="rounded-xl border p-5 space-y-3">
              <p className="text-base font-semibold">Campaign complete</p>
              <div className="flex gap-3">
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  {sendSummary?.sent ?? 0} sent
                </Badge>
                <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                  {sendSummary?.failed ?? 0} failed
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Candidate outreach counters and campaign history were saved successfully.
              </p>
            </div>
          )}
        </div>

        <div className="border-t px-6 py-4 flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {stage === "done" ? "Close" : "Cancel"}
          </Button>

          {stage === "setup" && (
            <Button
              type="button"
              disabled={!canStartCampaign || candidateIds.length === 0 || isDrafting}
              onClick={handleGenerateDrafts}
            >
              {isDrafting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {campaignButtonLabel(campaignRound)}
            </Button>
          )}

          {stage === "review" && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={() => setStage("setup")}>
                Back
              </Button>
              <Button
                type="button"
                disabled={drafts.length === 0 || isSending}
                onClick={handleSend}
              >
                {isSending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Send {campaignRoundLabel(campaignRound)}
              </Button>
            </div>
          )}

          {stage === "done" && (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
