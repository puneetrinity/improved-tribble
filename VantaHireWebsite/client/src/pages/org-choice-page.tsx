import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization, useCreateOrganization } from "@/hooks/use-organization";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, Users, Link2, Loader2, UserPlus, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import BrandedLoadingScreen from "@/components/internal/BrandedLoadingScreen";

interface DomainOrgMatch {
  id: number;
  name: string;
  domain: string;
}

interface InviteDetails {
  organizationName: string;
  email: string;
  role: string;
  expiresAt: string;
  inviterName: string;
}

/**
 * Onboarding page shown after registration.
 * User can: Create org, Join via invite, or Request to join (if domain matches)
 */
export default function OrgChoicePage() {
  const { user } = useAuth();
  const { data: orgData, isLoading: orgLoading } = useOrganization();
  const createOrg = useCreateOrganization();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  // Parse invite token from URL query params
  const inviteFromUrl = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return params.get('invite') || '';
  }, [searchString]);

  const [mode, setMode] = useState<'choice' | 'create' | 'join'>('choice');
  const [joiningInvite, setJoiningInvite] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [inviteCode, setInviteCode] = useState(inviteFromUrl);
  const [debouncedInviteCode, setDebouncedInviteCode] = useState(inviteFromUrl);
  const [domainOrg, setDomainOrg] = useState<DomainOrgMatch | null>(null);
  const [checkingDomain, setCheckingDomain] = useState(false);
  const [requestingJoin, setRequestingJoin] = useState(false);
  const [tryAnywayMode, setTryAnywayMode] = useState(false);

  // Debounce invite code input (400ms) to avoid spamming API
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedInviteCode(inviteCode);
    }, 400);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [inviteCode]);

  // Fetch invite details for both URL and manual entry (uses debounced code)
  const isValidInviteCode = debouncedInviteCode.length === 64;
  const { data: inviteDetails, isLoading: inviteLoading, error: inviteError } = useQuery<InviteDetails>({
    queryKey: ["/api/invites", debouncedInviteCode],
    queryFn: async () => {
      const res = await fetch(`/api/invites/${debouncedInviteCode}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Invalid invite");
      }
      return res.json();
    },
    enabled: isValidInviteCode,
    retry: false,
  });

  // Auto-switch to join mode if invite token is in URL
  useEffect(() => {
    if (inviteFromUrl) {
      setMode('join');
      setInviteCode(inviteFromUrl);
    }
  }, [inviteFromUrl]);

  // Redirect if already in org - go through onboarding check
  useEffect(() => {
    if (!orgLoading && orgData) {
      if (orgData.membership.seatAssigned) {
        // Go to onboarding which will check status and redirect appropriately
        // This ensures profile/plan steps aren't skipped
        setLocation("/onboarding");
      } else {
        setLocation("/blocked/seat-removed");
      }
    }
  }, [orgData, orgLoading, setLocation]);

  // Check if user's email domain matches an org
  useEffect(() => {
    if (user?.username) {
      checkDomainOrg();
    }
  }, [user?.username]);

  const checkDomainOrg = async () => {
    setCheckingDomain(true);
    try {
      const res = await fetch('/api/organizations/by-email-domain', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setDomainOrg(data);
        }
      }
    } catch (err) {
      console.error('Error checking domain org:', err);
    } finally {
      setCheckingDomain(false);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) return;

    try {
      await createOrg.mutateAsync({ name: orgName.trim() });
      toast({
        title: "Organization created",
        description: "Your organization has been created successfully.",
      });
      // Continue to onboarding (profile step) instead of dashboard
      setLocation("/onboarding?step=profile");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create organization",
        variant: "destructive",
      });
    }
  };

  const handleJoinViaInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;

    setJoiningInvite(true);
    try {
      const res = await apiRequest('POST', `/api/invites/${inviteCode.trim()}/accept`);

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Invalid invite code');
      }

      toast({
        title: "Joined organization",
        description: "Welcome to the team!",
      });
      // Redirect to onboarding profile step after joining the organization.
      setLocation("/onboarding?step=profile");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to join organization",
        variant: "destructive",
      });
    } finally {
      setJoiningInvite(false);
    }
  };

  const handleRequestJoin = async () => {
    if (!domainOrg) return;

    setRequestingJoin(true);
    try {
      const res = await apiRequest('POST', `/api/organizations/request-join/${domainOrg.id}`);

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to send request');
      }

      toast({
        title: "Request sent",
        description: `Your request to join ${domainOrg.name} has been sent. The owner will review it.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setRequestingJoin(false);
    }
  };

  if (orgLoading) {
    return (
      <div className="p-4">
        <BrandedLoadingScreen fullScreen label="Preparing your ealana workspace..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Welcome to ealana!</h1>
          <p className="text-muted-foreground mt-2">
            {mode === 'choice' ? "Let's get you set up. Choose how you'd like to get started." : null}
            {mode === 'create' ? "Create a new workspace for your team." : null}
            {mode === 'join' ? "Join an existing team with your invite code." : null}
          </p>
        </div>

        {/* Invite Preview - show when valid invite token is in URL */}
        {inviteFromUrl && inviteFromUrl.length === 64 && inviteDetails && (
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
            <CardHeader>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center">
                  <UserPlus className="h-7 w-7 text-primary" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-xl">Join {inviteDetails.organizationName}</CardTitle>
                  <CardDescription className="mt-1">
                    {inviteDetails.inviterName} invited you to join as a {inviteDetails.role}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>Valid invite for {inviteDetails.email}</span>
              </div>
              <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md p-3 mb-4">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <span>Your existing jobs and clients will be moved to this organization when you join.</span>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={(e) => handleJoinViaInvite(e as any)}
                  disabled={joiningInvite}
                  className="flex-1"
                >
                  {joiningInvite ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Joining...
                    </>
                  ) : (
                    "Accept & Join Organization"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Invite Error */}
        {inviteFromUrl && inviteFromUrl.length === 64 && inviteError && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="pt-6">
              <p className="text-destructive text-sm">
                {(inviteError as Error).message || "Invalid or expired invite link"}
              </p>
              <p className="text-muted-foreground text-sm mt-2">
                You can still create your own organization or join with a different invite code.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Choice mode - only show if no valid invite preview */}
        {mode === 'choice' && !(inviteFromUrl && inviteFromUrl.length === 64 && inviteDetails) && (
          <div className="grid md:grid-cols-2 gap-4">
            <Card
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => setMode('create')}
            >
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-2">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Create Organization</CardTitle>
                <CardDescription>
                  Start your own workspace and invite your team
                </CardDescription>
              </CardHeader>
            </Card>

            <Card
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => setMode('join')}
            >
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-2">
                  <Link2 className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Join Organization</CardTitle>
                <CardDescription>
                  Have an invite code? Join an existing team
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        )}

        {mode !== 'choice' && domainOrg && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Users className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-amber-900">
                    Organization for @{domainOrg.domain} exists
                  </p>
                  <p className="text-sm text-amber-700 mt-1">
                    {domainOrg.name} is already using ealana. You can request to join them.
                  </p>
                  <p className="text-xs text-amber-600 mt-2">
                    Note: Your existing jobs and clients will be moved to this organization if approved.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 border-amber-300 hover:bg-amber-100"
                    onClick={handleRequestJoin}
                    disabled={requestingJoin}
                  >
                    {requestingJoin ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Request to Join {domainOrg.name}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {mode === 'create' && (
          <Card>
            <CardHeader>
              <CardTitle>Create Your Organization</CardTitle>
              <CardDescription>
                This will be your team's workspace. You can invite others after setup.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateOrg} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="orgName">Organization Name</Label>
                  <Input
                    id="orgName"
                    placeholder="e.g., Acme Recruiting"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    required
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setMode('choice')}
                  >
                    Back
                  </Button>
                  <Button type="submit" disabled={createOrg.isPending || !orgName.trim()}>
                    {createOrg.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Create Organization
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {mode === 'join' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Join with Invite Code</CardTitle>
                <CardDescription>
                  Enter the invite code you received from your team.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="inviteCode">Invite Code</Label>
                    <Input
                      id="inviteCode"
                      placeholder="Enter your 64-character invite code"
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                    />
                    {inviteCode && inviteCode.length > 0 && inviteCode.length < 64 && (
                      <p className="text-xs text-muted-foreground">
                        {inviteCode.length}/64 characters
                      </p>
                    )}
                  </div>

                  {/* Loading state while validating */}
                  {isValidInviteCode && inviteLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Validating invite code...</span>
                    </div>
                  )}

                  {/* Preview card when invite is valid */}
                  {isValidInviteCode && inviteDetails && !inviteFromUrl && (
                    <div className="border rounded-lg p-4 bg-gradient-to-br from-primary/5 to-transparent space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                          <UserPlus className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">Join {inviteDetails.organizationName}</p>
                          <p className="text-sm text-muted-foreground">
                            {inviteDetails.inviterName} invited you as {inviteDetails.role}
                          </p>
                        </div>
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      </div>
                      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
                        <AlertCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                        <span>Your existing jobs and clients will be moved to this organization.</span>
                      </div>
                    </div>
                  )}

                  {/* Error state with "Try anyway" option */}
                  {isValidInviteCode && inviteError && !inviteLoading && (
                    <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm text-destructive">
                            {(inviteError as Error).message || "Could not validate invite code"}
                          </p>
                          {!tryAnywayMode && (
                            <button
                              type="button"
                              className="text-sm text-primary hover:underline mt-2"
                              onClick={() => setTryAnywayMode(true)}
                            >
                              Try anyway
                            </button>
                          )}
                          {tryAnywayMode && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Submit will attempt to join - server will verify the code.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setMode('choice');
                        setInviteCode('');
                        setTryAnywayMode(false);
                      }}
                    >
                      Back
                    </Button>
                    <Button
                      onClick={handleJoinViaInvite}
                      disabled={
                        !isValidInviteCode ||
                        joiningInvite ||
                        (inviteLoading) ||
                        (!inviteDetails && !tryAnywayMode)
                      }
                    >
                      {joiningInvite ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Joining...
                        </>
                      ) : (
                        "Join Organization"
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
