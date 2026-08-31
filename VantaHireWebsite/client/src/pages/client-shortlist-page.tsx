import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import Layout from "@/components/Layout";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Download,
  Sparkles,
} from "lucide-react";

type ShortlistState = "loading" | "ready" | "submitting" | "success" | "expired" | "error";

type Recommendation = "advance" | "reject" | "hold";

interface ShortlistCandidate {
  candidateRef: string;
  name: string;
  position: number;
  resumeAvailable: boolean;
  aiSummary: string | null;
  aiFitLabel: string | null;
}

interface ShortlistResponse {
  title: string;
  message: string | null;
  client: {
    name: string;
  };
  job: {
    title: string;
    location: string;
    type: string;
  };
  candidates: ShortlistCandidate[];
  createdAt: string;
  expiresAt: string | null;
}

interface CandidateFeedbackState {
  recommendation: Recommendation | "";
  notes: string;
  rating: number | null;
}

export default function ClientShortlistPage() {
  const [, params] = useRoute("/client-shortlist/:token");
  const token = params?.token;
  const { toast } = useToast();

  const [state, setState] = useState<ShortlistState>("loading");
  const [data, setData] = useState<ShortlistResponse | null>(null);
  const [feedback, setFeedback] = useState<Record<string, CandidateFeedbackState>>({});
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setErrorMessage("Invalid shortlist link.");
      return;
    }

    setState("loading");
    fetch(`/api/client-shortlist/${token}`)
      .then(async (res) => {
        if (res.status === 410) {
          setState("expired");
          return null;
        }
        if (!res.ok) {
          throw new Error("Failed to load shortlist.");
        }
        const json = (await res.json()) as ShortlistResponse;
        return json;
      })
      .then((json) => {
        if (!json) return;
        setData(json);
        // Initialise feedback state
        const initial: Record<string, CandidateFeedbackState> = {};
        json.candidates.forEach((c) => {
          initial[c.candidateRef] = { recommendation: "", notes: "", rating: null };
        });
        setFeedback(initial);
        setState("ready");
      })
      .catch((err: unknown) => {
        console.error("Error fetching shortlist:", err);
        setState("error");
        setErrorMessage("Unable to load shortlist. Please check the link or try again later.");
      });
  }, [token]);

  const handleRecommendationChange = (candidateRef: string, value: Recommendation) => {
    setFeedback((prev) => ({
      ...prev,
      [candidateRef]: {
        ...(prev[candidateRef] || { recommendation: "", notes: "", rating: null }),
        recommendation: value,
      },
    }));
  };

  const handleNotesChange = (candidateRef: string, value: string) => {
    setFeedback((prev) => ({
      ...prev,
      [candidateRef]: {
        ...(prev[candidateRef] || { recommendation: "", notes: "", rating: null }),
        notes: value,
      },
    }));
  };

  const handleRatingChange = (candidateRef: string, value: string) => {
    const parsed = value ? parseInt(value, 10) : null;
    setFeedback((prev) => ({
      ...prev,
      [candidateRef]: {
        ...(prev[candidateRef] || { recommendation: "", notes: "", rating: null }),
        rating: parsed && !Number.isNaN(parsed) ? parsed : null,
      },
    }));
  };

  const handleSubmit = async () => {
    if (!token || !data) return;

    const payload = Object.entries(feedback)
      .filter(([, fb]) => fb.recommendation !== "")
      .map(([candidateRef, fb]) => ({
        candidateRef,
        recommendation: fb.recommendation,
        ...(fb.notes.trim() && { notes: fb.notes.trim() }),
        ...(fb.rating && { rating: fb.rating }),
      }));

    if (payload.length === 0) {
      toast({
        title: "No Feedback Selected",
        description: "Please choose Advance, Hold, or Reject for at least one candidate.",
        variant: "destructive",
      });
      return;
    }

    setState("submitting");
    try {
      const res = await fetch(`/api/client-shortlist/${token}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || error.error || "Failed to submit feedback");
      }

      setState("success");
      toast({
        title: "Feedback Submitted",
        description: "Thank you for reviewing these candidates.",
      });
    } catch (err: any) {
      console.error("Error submitting client feedback:", err);
      setState("ready");
      toast({
        title: "Submission Failed",
        description: err?.message || "Unable to submit feedback. Please try again.",
        variant: "destructive",
      });
    }
  };

  const renderContent = () => {
    if (state === "loading") {
      return (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
          <p className="text-muted-foreground">Loading shortlist...</p>
        </div>
      );
    }

    if (state === "expired") {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="h-10 w-10 text-destructive mb-4" />
          <p className="text-foreground font-semibold mb-1">This shortlist has expired.</p>
          <p className="text-muted-foreground text-sm">
            Please contact your recruiter if you need a new link.
          </p>
        </div>
      );
    }

    if (state === "error" || !data) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="h-10 w-10 text-destructive mb-4" />
          <p className="text-foreground font-semibold mb-1">Unable to load shortlist.</p>
          <p className="text-muted-foreground text-sm">{errorMessage}</p>
        </div>
      );
    }

    if (state === "success") {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CheckCircle2 className="h-10 w-10 text-success mb-4" />
          <p className="text-foreground font-semibold mb-1">Feedback submitted.</p>
          <p className="text-muted-foreground text-sm">
            Thank you for reviewing candidates for {data.job.title}.
          </p>
        </div>
      );
    }

    // ready or submitting
    return (
      <div className="space-y-6">
        {/* Header */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Users className="h-5 w-5 text-primary" />
              {data.title || data.job.title}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Candidate shortlist for {data.client.name} &middot; {data.job.title} (
              {data.job.type}) in {data.job.location}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.message && (
              <p className="text-sm text-foreground leading-relaxed">{data.message}</p>
            )}
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>
                Created on {new Date(data.createdAt).toLocaleDateString()}
              </span>
              {data.expiresAt && (
                <>
                  <span>•</span>
                  <span>
                    Expires on {new Date(data.expiresAt).toLocaleDateString()}
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Candidates */}
        {data.candidates.map((candidate) => {
          const fb = feedback[candidate.candidateRef] || {
            recommendation: "",
            notes: "",
            rating: null,
          };

          return (
            <Card key={candidate.candidateRef} className="shadow-sm border-border">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base text-foreground">
                      {candidate.name}
                    </CardTitle>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    #{candidate.position}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* AI Summary */}
                {candidate.aiSummary && (
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <Label className="text-xs font-medium text-primary">
                        AI Summary
                      </Label>
                      {candidate.aiFitLabel && (
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            candidate.aiFitLabel === 'Strong'
                              ? 'border-success/30 bg-success/10 text-success-foreground'
                              : candidate.aiFitLabel === 'Good'
                              ? 'border-info/30 bg-info/10 text-info-foreground'
                              : candidate.aiFitLabel === 'Fair'
                              ? 'border-warning/30 bg-warning/10 text-warning-foreground'
                              : 'border-destructive/30 bg-destructive/10 text-destructive'
                          }`}
                        >
                          {candidate.aiFitLabel} Fit
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {candidate.aiSummary}
                    </p>
                  </div>
                )}

                {/* Resume Download */}
                {candidate.resumeAvailable && token && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(`/api/client-shortlist/${token}/resume/${candidate.candidateRef}`, "_blank")}
                      className="text-sm"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download Resume
                    </Button>
                  </div>
                )}

                {/* Feedback controls */}
                <div className="space-y-3 border-t border-border pt-3">
                  <div>
                    <Label className="text-sm text-foreground">
                      Recommendation
                    </Label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {(
                        [
                          ["advance", "Advance"],
                          ["hold", "Hold"],
                          ["reject", "Reject"],
                        ] as [Recommendation, string][]
                      ).map(([value, label]) => (
                        <Button
                          key={value}
                          type="button"
                          size="sm"
                          variant={
                            fb.recommendation === value ? "default" : "outline"
                          }
                          className={
                            fb.recommendation === value
                              ? "bg-primary text-foreground"
                              : ""
                          }
                          onClick={() =>
                            handleRecommendationChange(candidate.candidateRef, value)
                          }
                        >
                          {value === "advance" && (
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                          )}
                          {value === "hold" && (
                            <AlertCircle className="h-3 w-3 mr-1" />
                          )}
                          {value === "reject" && (
                            <XCircle className="h-3 w-3 mr-1" />
                          )}
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm text-foreground">
                        Notes (Optional)
                      </Label>
                      <Textarea
                        value={fb.notes}
                        onChange={(e) =>
                          handleNotesChange(candidate.candidateRef, e.target.value)
                        }
                        rows={3}
                        className="text-sm"
                        placeholder="Share your thoughts or concerns about this candidate..."
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-foreground">
                        Rating (Optional)
                      </Label>
                      <SelectRating
                        value={fb.rating}
                        onChange={(val) =>
                          handleRatingChange(candidate.candidateRef, val)
                        }
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSubmit}
            disabled={state === "submitting"}
            className="min-w-[180px]"
          >
            {state === "submitting" ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Feedback"
            )}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="min-h-screen bg-muted/50">
        <div className="container mx-auto px-4 py-10 max-w-4xl">
          {renderContent()}
        </div>
      </div>
    </Layout>
  );
}

interface SelectRatingProps {
  value: number | null;
  onChange: (value: string) => void;
}

function SelectRating({ value, onChange }: SelectRatingProps) {
  return (
    <div className="flex items-center gap-2 mt-2">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="border border-border rounded-md px-2 py-1 text-sm bg-card"
      >
        <option value="">No rating</option>
        <option value="1">1 - Poor</option>
        <option value="2">2 - Fair</option>
        <option value="3">3 - Good</option>
        <option value="4">4 - Very Good</option>
        <option value="5">5 - Excellent</option>
      </select>
    </div>
  );
}
