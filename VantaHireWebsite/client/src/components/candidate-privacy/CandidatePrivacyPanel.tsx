import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Shield, UserX } from "lucide-react";
import { Link } from "wouter";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type PrivacyAction = "withdraw_global_matching" | "request_erasure";
type PrivacyStatus = {
  intakeEnabled: boolean;
  recentAuthRequired: boolean;
  requests: Array<{
    requestId: string;
    action: PrivacyAction;
    state: string;
    effectiveAt: string;
    deliveryStatus: string;
  }>;
};

const statusKey = ["/api/candidate/privacy/status"] as const;

const actionCopy: Record<PrivacyAction, { title: string; description: string }> = {
  withdraw_global_matching: {
    title: "Stop global matching and recommendations",
    description: "Stops new cross-organization matching, recommendations, enrichment and promotion. Existing application and organization-private workflow history may remain available to that organization.",
  },
  request_erasure: {
    title: "Request erasure review",
    description: "Immediately restricts active profile use while your request is reviewed. This starts a protected quarantine and review; it does not promise immediate hard deletion.",
  },
};

function readableState(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function CandidatePrivacyPanel(): JSX.Element {
  const { toast } = useToast();
  const [pendingAction, setPendingAction] = useState<PrivacyAction | null>(null);
  const [password, setPassword] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);

  const status = useQuery<PrivacyStatus>({
    queryKey: statusKey,
    queryFn: async () => {
      const response = await fetch(statusKey[0], { credentials: "include" });
      if (!response.ok) throw new Error("candidate_privacy_status_unavailable");
      return response.json();
    },
  });

  const latestByAction = useMemo(() => {
    const requests = status.data?.requests ?? [];
    return new Map(requests.map((request) => [request.action, request]));
  }, [status.data?.requests]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!pendingAction) throw new Error("candidate_privacy_action_required");
      const stableRequestId = requestId ?? crypto.randomUUID();
      if (!requestId) setRequestId(stableRequestId);
      await apiRequest("POST", "/api/candidate/privacy/reauth", { password });
      const response = await apiRequest("POST", "/api/candidate/privacy/requests", {
        requestId: stableRequestId,
        action: pendingAction,
      });
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: statusKey });
      toast({ title: "Privacy request recorded", description: "The restriction is effective locally while secure delivery completes." });
      setPendingAction(null);
      setPassword("");
      setRequestId(null);
    },
    onError: () => {
      toast({ title: "Request not completed", description: "Check your password and try again. The same request reference will be reused safely.", variant: "destructive" });
    },
  });

  const begin = (action: PrivacyAction) => {
    setPendingAction(action);
    setPassword("");
    setRequestId(crypto.randomUUID());
  };

  if (status.isLoading) return <Card><CardContent className="py-8 text-muted-foreground">Loading privacy controls…</CardContent></Card>;
  if (status.isError || !status.data) return <Alert variant="destructive"><AlertDescription>Privacy controls are temporarily unavailable. No request was created.</AlertDescription></Alert>;

  return (
    <div className="space-y-6">
      {!status.data.intakeEnabled && (
        <Alert>
          <AlertDescription>
            Self-service privacy intake is being prepared. No request is created by these disabled controls. Contact support using the path in our <Link href="/privacy-policy" className="underline">Privacy Policy</Link>.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {(Object.keys(actionCopy) as PrivacyAction[]).map((action) => {
          const current = latestByAction.get(action);
          const Icon = action === "request_erasure" ? UserX : Shield;
          return (
            <Card key={action}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5" />{actionCopy[action].title}</CardTitle>
                <CardDescription>{actionCopy[action].description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {current && <div className="text-sm">Current request: <Badge variant="secondary">{readableState(current.state)}</Badge></div>}
                <Button disabled={!status.data.intakeEnabled || submit.isPending} onClick={() => begin(action)}>
                  {action === "request_erasure" ? "Request review" : "Stop global matching"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Withdrawing a specific job application remains available under My Applications and is separate from these global controls. See the <Link href="/privacy-policy" className="underline">Privacy Policy</Link> for details.
      </p>

      <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open && !submit.isPending) { setPendingAction(null); setPassword(""); setRequestId(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm with your password</DialogTitle>
            <DialogDescription>This recent-authentication check protects this sensitive request. Your password is not stored in the privacy request.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="privacy-password">Password</Label>
            <Input id="privacy-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={submit.isPending} onClick={() => { setPendingAction(null); setPassword(""); setRequestId(null); }}>Cancel</Button>
            <Button disabled={!password || submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? "Recording…" : "Confirm request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
