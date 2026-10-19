import { useState } from "react";
import Layout from "@/components/Layout";
import { INTERNAL_HEADER_ACTION_BUTTONS, INTERNAL_HEADER_PADDING, INTERNAL_HERO, INTERNAL_TITLE } from "@/lib/internal-page-theme";
import {
  useOrganization,
  useOrganizationMembers,
  useOrganizationInvites,
  useJoinRequests,
  useInviteMember,
  useCancelInvite,
  useRemoveMember,
  useRespondToJoinRequest,
  useMemberJobs,
  useReassignJobs,
  type OrganizationMember,
  type OrganizationInvite,
  type JoinRequest,
} from "@/hooks/use-organization";
import { useSeatUsage, useReduceSeats } from "@/hooks/use-subscription";
import { SeatSelectionModal } from "@/components/org/seat-selection-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  UserPlus,
  Mail,
  Clock,
  Check,
  X,
  Trash2,
  Crown,
  Shield,
  User,
  Loader2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { orgTeamPageCopy } from "@/lib/internal-copy";

function getRoleIcon(role: string) {
  switch (role) {
    case 'owner':
      return <Crown className="h-4 w-4 text-amber-500" />;
    case 'admin':
      return <Shield className="h-4 w-4 text-blue-500" />;
    default:
      return <User className="h-4 w-4 text-slate-400" />;
  }
}

function getRoleBadge(role: string) {
  switch (role) {
    case 'owner':
      return <Badge variant="default" className="bg-amber-500">Owner</Badge>;
    case 'admin':
      return <Badge variant="default" className="bg-blue-500">Admin</Badge>;
    default:
      return <Badge variant="secondary">Member</Badge>;
  }
}

export default function OrgTeamPage() {
  const { data: orgData } = useOrganization();
  const { data: members, isLoading: membersLoading } = useOrganizationMembers();
  const { data: invites } = useOrganizationInvites();
  const { data: joinRequests } = useJoinRequests();
  const { data: seatUsage } = useSeatUsage();
  const inviteMember = useInviteMember();
  const cancelInvite = useCancelInvite();
  const removeMember = useRemoveMember();
  const respondToJoinRequest = useRespondToJoinRequest();
  const reduceSeats = useReduceSeats();
  const reassignJobs = useReassignJobs();
  const { toast } = useToast();
  const [resendingInviteId, setResendingInviteId] = useState<number | null>(null);

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  // Note: Invites are always 'member' role - owner can promote to admin after joining

  // Seat reduction modal state
  const [seatReductionOpen, setSeatReductionOpen] = useState(false);
  const [targetSeats, setTargetSeats] = useState(1);

  // Member removal with reassignment state
  const [memberToRemove, setMemberToRemove] = useState<OrganizationMember | null>(null);
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);
  const [reassignToUserId, setReassignToUserId] = useState<number | null>(null);

  // Fetch jobs for member being removed
  const {
    data: memberJobs,
    isLoading: memberJobsLoading,
  } = useMemberJobs(memberToRemove?.id ?? null);

  const isOwnerOrAdmin = orgData?.membership?.role === 'owner' || orgData?.membership?.role === 'admin';

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    try {
      await inviteMember.mutateAsync({ email: inviteEmail.trim() });
      toast({
        title: orgTeamPageCopy.toasts.invitationSentTitle,
        description: `Invitation sent to ${inviteEmail}`,
      });
      setInviteEmail("");
      setInviteDialogOpen(false);
    } catch (error: any) {
      toast({
        title: orgTeamPageCopy.toasts.errorTitle,
        description: error.message || orgTeamPageCopy.toasts.inviteError,
        variant: "destructive",
      });
    }
  };

  // Handle seat reduction confirmation
  const handleSeatReductionConfirm = async (selectedMemberIds: number[]) => {
    try {
      await reduceSeats.mutateAsync({
        newSeatCount: targetSeats,
        memberIdsToKeep: selectedMemberIds,
      });
      toast({
        title: orgTeamPageCopy.toasts.seatsReducedTitle,
        description: `Successfully reduced to ${targetSeats} seat${targetSeats !== 1 ? 's' : ''}.`,
      });
      setSeatReductionOpen(false);
    } catch (error: any) {
      throw error; // Let the modal handle the error
    }
  };

  // Open manage seats modal
  const openManageSeats = (newSeatCount: number) => {
    setTargetSeats(newSeatCount);
    setSeatReductionOpen(true);
  };

  const handleRemoveMember = async (member: OrganizationMember) => {
    if (member.role === 'owner') {
      toast({
        title: orgTeamPageCopy.toasts.cannotRemoveOwnerTitle,
        description: orgTeamPageCopy.toasts.cannotRemoveOwnerDescription,
        variant: "destructive",
      });
      return;
    }

    // Set member to remove and open reassign dialog to check for jobs
    setMemberToRemove(member);
    setReassignToUserId(null);
    setReassignDialogOpen(true);
  };

  // Actually remove the member (after reassignment prompt)
  const confirmRemoveMember = async () => {
    if (!memberToRemove) return;
    const memberHasJobs = (memberJobs?.length ?? 0) > 0;

    if (memberJobsLoading) {
      return;
    }

    if (memberHasJobs && !reassignToUserId) {
      toast({
        title: orgTeamPageCopy.toasts.memberHasJobsTitle,
        description: orgTeamPageCopy.toasts.memberHasJobsError,
        variant: "destructive",
      });
      return;
    }

    try {
      // If there are jobs and reassignToUserId is set, reassign first
      if (memberHasJobs && reassignToUserId) {
        await reassignJobs.mutateAsync({
          fromMemberId: memberToRemove.id,
          toUserId: reassignToUserId,
        });
      }

      await removeMember.mutateAsync(memberToRemove.id);
      toast({
        title: orgTeamPageCopy.toasts.memberRemovedTitle,
        description: `${memberToRemove.user.firstName || memberToRemove.user.username} has been removed.`,
      });
      setReassignDialogOpen(false);
      setMemberToRemove(null);
      setReassignToUserId(null);
    } catch (error: any) {
      toast({
        title: orgTeamPageCopy.toasts.errorTitle,
        description: error.message || orgTeamPageCopy.toasts.removeMemberError,
        variant: "destructive",
      });
    }
  };

  const memberHasJobs = (memberJobs?.length ?? 0) > 0;
  const eligibleReassignmentMembers = members
    ?.filter((m) => m.id !== memberToRemove?.id && m.seatAssigned) ?? [];
  const removalBlockedByJobs = memberHasJobs && !reassignToUserId;
  const removeMemberDisabled =
    removeMember.isPending ||
    reassignJobs.isPending ||
    memberJobsLoading ||
    removalBlockedByJobs;

  const handleJoinRequestResponse = async (request: JoinRequest, status: 'approved' | 'rejected') => {
    try {
      await respondToJoinRequest.mutateAsync({ requestId: request.id, status });
      toast({
        title: status === 'approved' ? orgTeamPageCopy.toasts.requestApprovedTitle : orgTeamPageCopy.toasts.requestRejectedTitle,
        description: `${request.user.firstName || request.user.username}'s request has been ${status}.`,
      });
    } catch (error: any) {
      toast({
        title: orgTeamPageCopy.toasts.errorTitle,
        description: error.message || orgTeamPageCopy.toasts.requestError,
        variant: "destructive",
      });
    }
  };

  const handleResendInvite = async (invite: OrganizationInvite) => {
    setResendingInviteId(invite.id);
    try {
      // Resend = create new invite with same email (replaces old one)
      await inviteMember.mutateAsync({ email: invite.email });
      toast({
        title: orgTeamPageCopy.toasts.invitationResentTitle,
        description: `A new invitation has been sent to ${invite.email}`,
      });
    } catch (error: any) {
      toast({
        title: orgTeamPageCopy.toasts.errorTitle,
        description: error.message || orgTeamPageCopy.toasts.resendInviteError,
        variant: "destructive",
      });
    } finally {
      setResendingInviteId(null);
    }
  };

  const handleCancelInvite = async (invite: OrganizationInvite) => {
    try {
      await cancelInvite.mutateAsync(invite.id);
      toast({
        title: orgTeamPageCopy.toasts.invitationCancelledTitle,
        description: `Invitation to ${invite.email} has been cancelled.`,
      });
    } catch (error: any) {
      toast({
        title: orgTeamPageCopy.toasts.errorTitle,
        description: error.message || orgTeamPageCopy.toasts.cancelInviteError,
        variant: "destructive",
      });
    }
  };

  const pendingJoinRequests = joinRequests?.filter(r => r.status === 'pending') || [];

  // Check if invite is expired
  const isInviteExpired = (invite: OrganizationInvite) => {
    return new Date(invite.expiresAt) < new Date();
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div data-internal-header="page" className={`${INTERNAL_HERO} ${INTERNAL_HEADER_PADDING} ${INTERNAL_HEADER_ACTION_BUTTONS} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
          <div className="min-w-0">
            <h1 className={INTERNAL_TITLE}>{orgTeamPageCopy.header.title}</h1>
          <p className="mt-1 text-[13px] text-[#5F6675]">
            {orgTeamPageCopy.header.subtitle}
          </p>
        </div>
        {isOwnerOrAdmin && (
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="h-4 w-4 mr-2" />
                {orgTeamPageCopy.header.inviteMember}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleInvite}>
                <DialogHeader>
                  <DialogTitle>{orgTeamPageCopy.dialogs.inviteTitle}</DialogTitle>
                  <DialogDescription>
                    {orgTeamPageCopy.dialogs.inviteDescription}
                    {seatUsage && seatUsage.available <= 0 && (
                      <span className="text-amber-600 block mt-2">
                        {orgTeamPageCopy.dialogs.noSeatsWarning}
                      </span>
                    )}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">{orgTeamPageCopy.dialogs.emailLabel}</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder={orgTeamPageCopy.dialogs.emailPlaceholder}
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {orgTeamPageCopy.dialogs.memberRoleHint}
                  </p>
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={inviteMember.isPending || !inviteEmail.trim() || (seatUsage?.available || 0) <= 0}
                  >
                    {inviteMember.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    {orgTeamPageCopy.dialogs.sendInvitation}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Seat Usage */}
      {seatUsage && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Seat Usage</p>
                  <p className="text-sm text-muted-foreground">
                    {seatUsage.assigned} of {seatUsage.purchased} seats used
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={seatUsage.available > 0 ? "default" : "destructive"}>
                  {seatUsage.available} available
                </Badge>
                {isOwnerOrAdmin && seatUsage.purchased > 1 && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        Manage Seats
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{orgTeamPageCopy.dialogs.manageSeatsTitle}</DialogTitle>
                        <DialogDescription>
                          Reduce the number of seats for your organization. You currently have {seatUsage.purchased} seats with {seatUsage.assigned} in use.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-4 space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="newSeats">New seat count</Label>
                          <Select
                            value={targetSeats.toString()}
                            onValueChange={(v) => setTargetSeats(parseInt(v))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: seatUsage.purchased }, (_, i) => i + 1).map((num) => (
                                <SelectItem key={num} value={num.toString()}>
                                  {num} seat{num !== 1 ? 's' : ''}
                                  {num < seatUsage.assigned && ` (${seatUsage.assigned - num} will lose access)`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          onClick={() => {
                            if (targetSeats < seatUsage.assigned) {
                              // Need to select which members keep seats
                              setSeatReductionOpen(true);
                            } else {
                              // Just reduce seats, no one loses access
                              handleSeatReductionConfirm(
                                members?.map(m => m.id) || []
                              );
                            }
                          }}
                          disabled={targetSeats === seatUsage.purchased}
                        >
                          {targetSeats < seatUsage.assigned ? "Select Members" : "Reduce Seats"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Join Requests */}
      {pendingJoinRequests.length > 0 && isOwnerOrAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Pending Join Requests
            </CardTitle>
            <CardDescription>
              Users requesting to join your organization
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingJoinRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div>
                    <p className="font-medium">
                      {request.user.firstName} {request.user.lastName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {request.user.username}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleJoinRequestResponse(request, 'rejected')}
                      disabled={respondToJoinRequest.isPending}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleJoinRequestResponse(request, 'approved')}
                      disabled={respondToJoinRequest.isPending || (seatUsage?.available || 0) <= 0}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle>{orgTeamPageCopy.sections.members}</CardTitle>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  {isOwnerOrAdmin && <TableHead className="w-[50px]"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members?.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                          {getRoleIcon(member.role)}
                        </div>
                        <div>
                          <p className="font-medium">
                            {member.user.firstName} {member.user.lastName}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {member.user.username}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getRoleBadge(member.role)}</TableCell>
                    <TableCell>
                      {member.seatAssigned ? (
                        <Badge variant="outline" className="text-green-600 border-green-200">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-200">
                          {orgTeamPageCopy.sections.noSeat}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDistanceToNow(new Date(member.joinedAt), { addSuffix: true })}
                    </TableCell>
                    {isOwnerOrAdmin && (
                      <TableCell>
                        {member.role !== 'owner' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${member.user.firstName || member.user.username} from the organization`}
                            onClick={() => handleRemoveMember(member)}
                            disabled={removeMember.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pending Invites */}
      {invites && invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {orgTeamPageCopy.sections.pendingInvitations}
            </CardTitle>
            <CardDescription>
              {orgTeamPageCopy.sections.pendingInvitationsDescription}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invites.map((invite) => {
                const expired = isInviteExpired(invite);
                const isResending = resendingInviteId === invite.id;

                return (
                  <div
                    key={invite.id}
                    className={`flex items-center justify-between p-3 border rounded-lg ${
                      expired ? 'bg-muted/50 border-dashed' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        expired ? 'bg-destructive/10' : 'bg-primary/10'
                      }`}>
                        {expired ? (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        ) : (
                          <Mail className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{invite.email}</p>
                        <p className={`text-sm ${expired ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {expired
                            ? `Expired ${formatDistanceToNow(new Date(invite.expiresAt), { addSuffix: true })}`
                            : `Expires ${formatDistanceToNow(new Date(invite.expiresAt), { addSuffix: true })}`
                          }
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {expired ? (
                        <Badge variant="destructive">Expired</Badge>
                      ) : (
                        <Badge variant="secondary">{invite.role}</Badge>
                      )}
                      {isOwnerOrAdmin && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleResendInvite(invite)}
                            disabled={isResending || cancelInvite.isPending}
                          >
                            {isResending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                            <span className="ml-1 hidden sm:inline">
                              {expired ? 'Resend' : 'Resend'}
                            </span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCancelInvite(invite)}
                            disabled={cancelInvite.isPending || isResending}
                          >
                            <X className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Seat Selection Modal for reduction */}
      {members && (
        <SeatSelectionModal
          open={seatReductionOpen}
          onOpenChange={setSeatReductionOpen}
          members={members.map(m => ({
            id: m.id,
            userId: m.userId,
            role: m.role,
            seatAssigned: m.seatAssigned,
            lastActivityAt: m.lastActivityAt || null,
            user: {
              firstName: m.user.firstName || null,
              lastName: m.user.lastName || null,
              username: m.user.username,
            },
          }))}
          targetSeats={targetSeats}
          onConfirm={handleSeatReductionConfirm}
          title={`Select ${targetSeats} Member${targetSeats !== 1 ? 's' : ''} to Keep`}
          description={`You are reducing to ${targetSeats} seat${targetSeats !== 1 ? 's' : ''}. Select which members should keep access.`}
        />
      )}

      {/* Reassignment Dialog for member removal */}
      <Dialog open={reassignDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setMemberToRemove(null);
          setReassignToUserId(null);
        }
        setReassignDialogOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{orgTeamPageCopy.dialogs.removeMemberTitle}</DialogTitle>
            <DialogDescription>
              {memberToRemove && (
                <>
                  You are removing {memberToRemove.user.firstName || memberToRemove.user.username} from the organization.
                  {memberJobsLoading && (
                    <span className="block mt-2 text-muted-foreground">
                      {orgTeamPageCopy.dialogs.checkingJobs}
                    </span>
                  )}
                  {!memberJobsLoading && memberHasJobs && (
                    <span className="block mt-2 text-amber-600">
                      This member has {memberJobs?.length ?? 0} job{(memberJobs?.length ?? 0) !== 1 ? 's' : ''}. Would you like to reassign them?
                    </span>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {memberJobsLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {orgTeamPageCopy.dialogs.checkingJobs}
            </div>
          )}

          {memberHasJobs && members && (
            <div className="py-4">
              <Label htmlFor="reassignTo">Reassign jobs to</Label>
              <Select
                value={reassignToUserId?.toString() || ""}
                onValueChange={(v) => setReassignToUserId(parseInt(v, 10))}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder={orgTeamPageCopy.dialogs.reassignPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {eligibleReassignmentMembers.map((m) => (
                      <SelectItem key={m.userId} value={m.userId.toString()}>
                        {m.user.firstName || m.user.username}
                        {m.role === 'owner' && ' (Owner)'}
                        {m.role === 'admin' && ' (Admin)'}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-sm text-muted-foreground">
                {orgTeamPageCopy.dialogs.jobsMustBeReassigned}
              </p>
              {eligibleReassignmentMembers.length === 0 && (
                <p className="mt-2 text-sm text-destructive">
                  {orgTeamPageCopy.dialogs.noEligibleAssignee}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmRemoveMember}
              disabled={removeMemberDisabled}
            >
              {(removeMember.isPending || reassignJobs.isPending || memberJobsLoading) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {removalBlockedByJobs ? orgTeamPageCopy.dialogs.removeBlocked : "Remove Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </Layout>
  );
}
