import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Users, UserPlus, X, Mail, Crown, Clock, Loader2, AlertTriangle } from "lucide-react";

interface Recruiter {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isPrimary: boolean;
}

interface PendingInvitation {
  id: number;
  email: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

interface CoRecruitersResponse {
  primaryRecruiterId: number;
  recruiters: Recruiter[];
  pendingInvitations: PendingInvitation[];
}

interface CoRecruiterManagementProps {
  jobId: number;
  className?: string;
}

export function CoRecruiterManagement({ jobId, className = "" }: CoRecruiterManagementProps) {
  const { toast } = useToast();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Recruiter | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PendingInvitation | null>(null);
  const [seatWarningOpen, setSeatWarningOpen] = useState(false);
  const [pendingInviteData, setPendingInviteData] = useState<{ email: string; name?: string } | null>(null);

  // Fetch co-recruiters and pending invitations
  const { data, isLoading, error } = useQuery<CoRecruitersResponse>({
    queryKey: ["co-recruiters", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/co-recruiters`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to fetch co-recruiters");
      }
      return res.json();
    },
    enabled: !!jobId,
  });

  // Email check mutation
  const checkEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/co-recruiters/check-email`, { email });
      return res.json();
    },
  });

  // Invite mutation
  const inviteMutation = useMutation({
    mutationFn: async (data: { email: string; name?: string }) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/co-recruiters/invite`, data);
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["co-recruiters", jobId] });
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteName("");
      setSeatWarningOpen(false);
      setPendingInviteData(null);

      if (result.addedDirectly) {
        toast({
          title: "Recruiter Added",
          description: `${result.recruiter?.firstName || result.recruiter?.email} has been added as a co-recruiter.`,
        });
      } else {
        toast({
          title: "Invitation Sent",
          description: `An invitation has been sent to ${result.invitation?.email}.`,
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Invitation Failed",
        description: error.message || "Failed to send invitation.",
        variant: "destructive",
      });
    },
  });

  // Remove co-recruiter mutation
  const removeMutation = useMutation({
    mutationFn: async (recruiterId: number) => {
      const res = await apiRequest("DELETE", `/api/jobs/${jobId}/co-recruiters/${recruiterId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["co-recruiters", jobId] });
      setRemoveTarget(null);
      toast({
        title: "Co-Recruiter Removed",
        description: "The co-recruiter has been removed from this job.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Remove Failed",
        description: error.message || "Failed to remove co-recruiter.",
        variant: "destructive",
      });
    },
  });

  // Cancel invitation mutation
  const cancelInvitationMutation = useMutation({
    mutationFn: async (invitationId: number) => {
      const res = await apiRequest("DELETE", `/api/co-recruiter-invitations/${invitationId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["co-recruiters", jobId] });
      setCancelTarget(null);
      toast({
        title: "Invitation Cancelled",
        description: "The pending invitation has been cancelled.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Cancel Failed",
        description: error.message || "Failed to cancel invitation.",
        variant: "destructive",
      });
    },
  });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    const payload: { email: string; name?: string } = { email: inviteEmail.trim() };
    if (inviteName.trim()) {
      payload.name = inviteName.trim();
    }

    try {
      // First check the email status
      const checkResult = await checkEmailMutation.mutateAsync(inviteEmail.trim());

      if (checkResult.status === 'already_on_job') {
        toast({
          title: "Already a Co-Recruiter",
          description: checkResult.message,
          variant: "destructive",
        });
        return;
      }

      if (checkResult.status === 'not_on_platform') {
        // User not on platform - show warning about seat consumption
        setPendingInviteData(payload);
        setSeatWarningOpen(true);
        return;
      }

      // For other statuses (existing_recruiter, not_recruiter), proceed directly
      inviteMutation.mutate(payload);
    } catch (error: any) {
      // If check fails, fall back to direct invite (server will handle validation)
      inviteMutation.mutate(payload);
    }
  };

  const handleConfirmSeatConsumption = () => {
    if (pendingInviteData) {
      inviteMutation.mutate(pendingInviteData);
      setSeatWarningOpen(false);
      setPendingInviteData(null);
    }
  };

  const handleCancelSeatWarning = () => {
    setSeatWarningOpen(false);
    setPendingInviteData(null);
  };

  const formatName = (recruiter: Recruiter) => {
    if (recruiter.firstName || recruiter.lastName) {
      return `${recruiter.firstName || ""} ${recruiter.lastName || ""}`.trim();
    }
    return recruiter.email;
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Co-Recruiters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Co-Recruiters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Failed to load co-recruiters</p>
        </CardContent>
      </Card>
    );
  }

  const recruiters = data?.recruiters || [];
  const pendingInvitations = data?.pendingInvitations || [];
  const totalCollaborators = recruiters.length + pendingInvitations.length;

  return (
    <Card className={className} data-tour="co-recruiter-panel">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Co-Recruiters
            </CardTitle>
            <CardDescription>
              Manage who can collaborate on this job posting
            </CardDescription>
          </div>
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-tour="co-recruiter-invite-btn">
                <UserPlus className="h-4 w-4 mr-2" />
                Invite
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Co-Recruiter</DialogTitle>
                <DialogDescription>
                  Enter the email address of the recruiter you want to invite. If they already have an account, they'll be added immediately. New users will receive an invitation to register.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email Address</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-name">Name (Optional)</Label>
                  <Input
                    id="invite-name"
                    type="text"
                    placeholder="John Doe"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Used to personalize the invitation email
                  </p>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={inviteMutation.isPending || checkEmailMutation.isPending}>
                    {inviteMutation.isPending || checkEmailMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {checkEmailMutation.isPending ? "Checking..." : "Sending..."}
                      </>
                    ) : (
                      "Send Invitation"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Active Recruiters */}
        <div className="space-y-2" data-tour="co-recruiter-list">
          <h4 className="text-sm font-medium text-muted-foreground">Active ({recruiters.length})</h4>
          <div className="space-y-2">
            {recruiters.map((recruiter) => (
              <div
                key={recruiter.id}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    {recruiter.isPrimary ? (
                      <Crown className="h-4 w-4 text-amber-500" />
                    ) : (
                      <Users className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{formatName(recruiter)}</p>
                    <p className="text-xs text-muted-foreground">{recruiter.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {recruiter.isPrimary ? (
                    <Badge variant="secondary" className="text-xs">Primary</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoveTarget(recruiter)}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pending Invitations */}
        {pendingInvitations.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Pending ({pendingInvitations.length})</h4>
            <div className="space-y-2">
              {pendingInvitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-dashed"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">{invitation.email}</p>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Pending</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCancelTarget(invitation)}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {totalCollaborators === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No co-recruiters yet. Invite colleagues to collaborate on this job.
          </p>
        )}
      </CardContent>

      {/* Remove Confirmation Dialog */}
      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Co-Recruiter?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {removeTarget ? formatName(removeTarget) : ""} from this job?
              They will no longer be able to view or manage applications.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeMutation.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Invitation Confirmation Dialog */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel the invitation to {cancelTarget?.email}?
              They will no longer be able to use the invitation link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Invitation</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelTarget && cancelInvitationMutation.mutate(cancelTarget.id)}
            >
              {cancelInvitationMutation.isPending ? "Cancelling..." : "Cancel Invitation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Seat Consumption Warning Dialog */}
      <AlertDialog open={seatWarningOpen} onOpenChange={(open) => !open && handleCancelSeatWarning()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              New User Will Consume a Seat
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                <strong>{pendingInviteData?.email}</strong> is not currently on ealana.
              </p>
              <p>
                When they accept this invitation and register, they will be added to your organization
                and <strong>consume one organization seat</strong>.
              </p>
              <p className="text-amber-600 dark:text-amber-400">
                Make sure you have available seats in your subscription before proceeding.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelSeatWarning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmSeatConsumption}
              disabled={inviteMutation.isPending}
            >
              {inviteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send Invitation Anyway"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
