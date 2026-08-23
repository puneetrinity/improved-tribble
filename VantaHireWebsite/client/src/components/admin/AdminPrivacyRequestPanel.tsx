import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Anchor = { type: "candidate_user" | "application"; id: number; label: string };

export function AdminPrivacyRequestPanel({ anchors }: { anchors: Anchor[] }): JSX.Element {
  const { toast } = useToast();
  const [anchorKey, setAnchorKey] = useState("");
  const [action, setAction] = useState<"withdraw_global_matching" | "request_erasure">("withdraw_global_matching");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<Record<string, unknown> | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const anchor = anchors.find((item) => `${item.type}:${item.id}` === anchorKey);
      if (!anchor) throw new Error("Select an existing candidate or application");
      const response = await apiRequest("POST", "/api/admin/privacy/requests", {
        requestId: crypto.randomUUID(),
        action,
        subjectType: anchor.type,
        subjectId: anchor.id,
        evidenceRef,
        authorityType: "privacy_operator",
        reasonCode: "verified_support_request",
      });
      return response.json();
    },
    onSuccess: (result) => {
      setLookupResult(result);
      setEvidenceRef("");
      toast({ title: "Privacy request recorded", description: "The verified support reference was recorded in the append-only audit event." });
    },
    onError: () => toast({ title: "Request not recorded", description: "Check the selected subject and UUID evidence reference.", variant: "destructive" }),
  });

  const lookup = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/admin/privacy/requests/${encodeURIComponent(lookupId)}`, { credentials: "include" });
      if (!response.ok) throw new Error("candidate_privacy_request_not_found");
      return response.json();
    },
    onSuccess: setLookupResult,
    onError: () => { setLookupResult(null); toast({ title: "Request not found", variant: "destructive" }); },
  });

  return (
    <div className="space-y-6">
      <Alert><AlertDescription>This bounded operator intake accepts only a candidate already loaded in Flow and an externally verified UUID reference. It cannot delete globally, upload evidence, search arbitrary email, release a directive, or set legal holds.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle>Create verified privacy request</CardTitle><CardDescription>Creates an immediate local restriction and secure Memory delivery record.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><Label>Existing Flow subject</Label><Select value={anchorKey} onValueChange={setAnchorKey}><SelectTrigger><SelectValue placeholder="Select loaded subject" /></SelectTrigger><SelectContent>{anchors.map((anchor) => <SelectItem key={`${anchor.type}:${anchor.id}`} value={`${anchor.type}:${anchor.id}`}>{anchor.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Action</Label><Select value={action} onValueChange={(value) => setAction(value as typeof action)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="withdraw_global_matching">Stop global matching</SelectItem><SelectItem value="request_erasure">Request erasure review</SelectItem></SelectContent></Select></div>
          <div className="space-y-2 md:col-span-2"><Label htmlFor="evidence-ref">Verified support evidence UUID</Label><Input id="evidence-ref" value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder="00000000-0000-4000-8000-000000000000" /></div>
          <Button className="md:col-span-2" disabled={!anchorKey || !evidenceRef || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Recording…" : "Record request"}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Retrieve minimal status</CardTitle><CardDescription>No raw identifiers or evidence content are returned.</CardDescription></CardHeader>
        <CardContent className="space-y-3"><div className="flex gap-2"><Input value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="Request UUID" /><Button variant="outline" disabled={!lookupId || lookup.isPending} onClick={() => lookup.mutate()}>Look up</Button></div>{lookupResult && <pre className="overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(lookupResult, null, 2)}</pre>}</CardContent>
      </Card>
    </div>
  );
}
