import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Copy, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface JdAiAnalysisDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onReplaceDescription?: (text: string) => void;
}

type AnalysisResult = {
  clarity_score: number;
  inclusion_score: number;
  seo_score: number;
  overall_score: number;
  bias_flags: string[];
  seo_keywords: string[];
  suggestions: string[];
  rewrite: string;
};

export function JdAiAnalysisDrawer({
  open,
  onOpenChange,
  title,
  description,
  onReplaceDescription,
}: JdAiAnalysisDrawerProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/ai/analyze-job-description", { title, description });
      if (!res.ok) throw new Error("AI analysis unavailable");
      const data = await res.json();
      // Use server-provided AI rewrite, with fallback template if not available
      const rewrite = data.rewrite || [
        `Role: ${title}`,
        "",
        "Responsibilities:",
        "- " + (data.suggestions?.[0] || "Clarify top 3-5 responsibilities."),
        "- " + (data.suggestions?.[1] || "Include ownership/scope and measurable impact."),
        "",
        "Requirements:",
        "- " + (data.seo_keywords?.slice(0, 3).join(", ") || "List 4-6 must-have skills/tech."),
      ].join("\n");
      setAnalysis({
        clarity_score: data.clarity_score ?? 0,
        inclusion_score: data.inclusion_score ?? 0,
        seo_score: data.seo_score ?? 0,
        overall_score: data.overall_score ?? 0,
        bias_flags: Array.isArray(data.bias_flags) ? data.bias_flags : [],
        seo_keywords: Array.isArray(data.seo_keywords) ? data.seo_keywords : [],
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        rewrite,
      });
    } catch (err: any) {
      console.error("JD AI analysis failed", err);
      setError("AI analysis unavailable. You can still edit this JD manually.");
    } finally {
      setLoading(false);
    }
  };

  const copyRewrite = () => {
    if (!analysis?.rewrite) return;
    navigator.clipboard.writeText(analysis.rewrite);
    toast({ title: "Copied", description: "AI rewrite copied to clipboard." });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col h-full">
        <SheetHeader className="flex-shrink-0">
          <SheetTitle className="flex items-center gap-2">
            AI JD analysis
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              AI-assisted
            </Badge>
          </SheetTitle>
          <SheetDescription>Optional AI help to improve clarity and inclusivity.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 flex-1 overflow-y-auto pr-2">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Title: <span className="font-medium text-foreground">{title || "Untitled role"}</span>
            </div>
            <Button size="sm" onClick={runAnalysis} disabled={loading || !description}>
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Analyze JD"}
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {!analysis && !error && (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-base">AI suggestions will appear here</CardTitle>
                <CardDescription>Click “Analyze JD” to get clarity and SEO feedback.</CardDescription>
              </CardHeader>
            </Card>
          )}

          {analysis && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Overall", value: analysis.overall_score },
                  { label: "Clarity", value: analysis.clarity_score },
                  { label: "Inclusion", value: analysis.inclusion_score },
                  { label: "SEO", value: analysis.seo_score },
                ].map((item) => (
                  <Card key={item.label} className="border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium text-muted-foreground">{item.label}</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="text-xl font-semibold text-foreground">{item.value}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="text-sm font-semibold text-foreground">Suggestions</div>
                <ul className="list-disc pl-4 space-y-1 text-sm text-foreground">
                  {(analysis.suggestions.length ? analysis.suggestions : ["Clarify must-have vs nice-to-have", "Add 4-6 bullets for responsibilities", "List location/remote policy explicitly"] ).map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
              </div>

              {analysis.bias_flags.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground">Possible bias terms</div>
                  <div className="flex flex-wrap gap-2">
                    {analysis.bias_flags.map((flag, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {flag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {analysis.seo_keywords.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-foreground">Add these keywords</div>
                  <div className="flex flex-wrap gap-2">
                    {analysis.seo_keywords.slice(0, 6).map((kw, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-foreground">Original JD</div>
                  <Textarea value={description} readOnly className="h-64 bg-muted/50" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-foreground">AI rewrite</div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={copyRewrite}>
                        <Copy className="h-4 w-4 mr-1" />
                        Copy
                      </Button>
                      {onReplaceDescription && (
                        <Button variant="default" size="sm" onClick={() => onReplaceDescription(analysis.rewrite)}>
                          Replace in form
                        </Button>
                      )}
                    </div>
                  </div>
                  <Textarea value={analysis.rewrite} readOnly className="h-64" />
                </div>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
