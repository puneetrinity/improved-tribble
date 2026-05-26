import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, XCircle, Users, Briefcase, UserPlus } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import BrandedLoadingScreen from "@/components/internal/BrandedLoadingScreen";

interface InvitationValidation {
  valid: boolean;
  email?: string;
  name?: string;
  jobTitle?: string;
  jobId?: number;
  inviterName?: string;
  error?: string;
}

export default function AcceptCoRecruiter() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();

  // Validate the invitation token
  const { data: validation, isLoading: validating, error: validationError } = useQuery<InvitationValidation>({
    queryKey: ["co-recruiter-invitation", token],
    queryFn: async () => {
      const res = await fetch(`/api/co-recruiter-invitations/validate/${token}`);
      const data = await res.json();
      if (!res.ok) {
        return { valid: false, error: data.error || "Invalid invitation" };
      }
      return data;
    },
    enabled: !!token,
    retry: false,
  });

  // Accept invitation mutation
  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/co-recruiter-invitations/${token}/accept`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Invitation Accepted",
        description: "You are now a co-recruiter on this job.",
      });
      // Redirect to the job page
      if (data.jobId) {
        setLocation(`/jobs/${data.jobId}/applications`);
      } else {
        setLocation("/recruiter-dashboard");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Accept",
        description: error.message || "An error occurred while accepting the invitation.",
        variant: "destructive",
      });
    },
  });

  // Show loading state
  if (validating || authLoading) {
    return (
      <div className="public-theme min-h-screen bg-background text-foreground">
        <Header />
        <main className="container mx-auto px-4 py-16">
          <BrandedLoadingScreen label="Validating your invitation..." />
        </main>
        <Footer />
      </div>
    );
  }

  // Show error state for invalid/expired token
  if (!validation?.valid || validationError) {
    return (
      <div className="public-theme min-h-screen bg-background text-foreground">
        <Header />
        <main className="container mx-auto px-4 py-16">
          <div className="max-w-md mx-auto">
            <Card className="border-destructive/50">
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                  <XCircle className="h-6 w-6 text-destructive" />
                </div>
                <CardTitle>Invalid Invitation</CardTitle>
                <CardDescription>
                  {validation?.error || "This invitation link is invalid or has expired."}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-sm text-muted-foreground mb-6">
                  Please contact the recruiter who sent you this invitation to request a new one.
                </p>
                <Button variant="outline" onClick={() => setLocation("/")}>
                  Return to Home
                </Button>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Check if user needs to log in
  if (!user) {
    return (
      <div className="public-theme min-h-screen bg-background text-foreground">
        <Header />
        <main className="container mx-auto px-4 py-16">
          <div className="max-w-md mx-auto">
            <Card>
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <UserPlus className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Login Required</CardTitle>
                <CardDescription>
                  Please log in to accept your co-recruiter invitation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted rounded-lg p-4 space-y-2">
                  <p className="text-sm"><strong>Job:</strong> {validation.jobTitle}</p>
                  {validation.inviterName && (
                    <p className="text-sm"><strong>Invited by:</strong> {validation.inviterName}</p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Button onClick={() => setLocation(`/recruiter-auth?redirect=/accept-co-recruiter/${token}`)}>
                    Log In
                  </Button>
                  <Button variant="outline" onClick={() => setLocation(`/register-co-recruiter/${token}`)}>
                    Create New Account
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Check if user is a recruiter
  if (user.role !== 'recruiter' && user.role !== 'super_admin') {
    return (
      <div className="public-theme min-h-screen bg-background text-foreground">
        <Header />
        <main className="container mx-auto px-4 py-16">
          <div className="max-w-md mx-auto">
            <Card className="border-destructive/50">
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                  <XCircle className="h-6 w-6 text-destructive" />
                </div>
                <CardTitle>Access Denied</CardTitle>
                <CardDescription>
                  Only recruiters can accept co-recruiter invitations.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-sm text-muted-foreground mb-6">
                  You are currently logged in as a {user.role}. Please log in with a recruiter account.
                </p>
                <Button variant="outline" onClick={() => setLocation("/recruiter-auth")}>
                  Log In as Recruiter
                </Button>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Show success state after accepting
  if (acceptMutation.isSuccess) {
    return (
      <div className="public-theme min-h-screen bg-background text-foreground">
        <Header />
        <main className="container mx-auto px-4 py-16">
          <div className="max-w-md mx-auto">
            <Card>
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle className="h-6 w-6 text-green-500" />
                </div>
                <CardTitle>Invitation Accepted</CardTitle>
                <CardDescription>
                  You are now a co-recruiter on "{validation.jobTitle}"
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-sm text-muted-foreground mb-6">
                  You can now manage applications and collaborate on this job posting.
                </p>
                <Button onClick={() => setLocation(`/jobs/${validation.jobId}/applications`)}>
                  View Job Applications
                </Button>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Show accept confirmation
  return (
    <div className="public-theme min-h-screen bg-background text-foreground">
      <Header />
      <main className="container mx-auto px-4 py-16">
        <div className="max-w-lg mx-auto">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <CardTitle>Co-Recruiter Invitation</CardTitle>
              <CardDescription>
                You've been invited to collaborate on a job posting
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-muted rounded-lg p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Briefcase className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Job Title</p>
                    <p className="text-sm text-muted-foreground">{validation.jobTitle}</p>
                  </div>
                </div>
                {validation.inviterName && (
                  <div className="flex items-start gap-3">
                    <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Invited By</p>
                      <p className="text-sm text-muted-foreground">{validation.inviterName}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium">As a co-recruiter, you will be able to:</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>- View and manage applications for this job</li>
                  <li>- Update candidate statuses and add notes</li>
                  <li>- Schedule interviews with candidates</li>
                  <li>- Collaborate with the primary recruiter</li>
                </ul>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => acceptMutation.mutate()}
                  disabled={acceptMutation.isPending}
                  className="w-full"
                >
                  {acceptMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Accepting...
                    </>
                  ) : (
                    "Accept Invitation"
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setLocation("/recruiter-dashboard")}
                  className="w-full"
                >
                  Decline
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
