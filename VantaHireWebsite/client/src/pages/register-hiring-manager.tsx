import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, XCircle, Mail, Users, ClipboardCheck, MessageSquare } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { apiRequest } from "@/lib/queryClient";
import BrandedLoadingScreen from "@/components/internal/BrandedLoadingScreen";

interface InvitationValidation {
  valid: boolean;
  email?: string;
  name?: string;
  error?: string;
}

export default function RegisterHiringManager() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [registerData, setRegisterData] = useState({
    password: "",
    confirmPassword: "",
    firstName: "",
    lastName: "",
  });

  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");

  // Validate the invitation token
  const { data: validation, isLoading: validating, error: validationError } = useQuery<InvitationValidation>({
    queryKey: ["hiring-manager-invitation", token],
    queryFn: async () => {
      const res = await fetch(`/api/hiring-manager-invitations/validate/${token}`);
      const data = await res.json();
      if (!res.ok) {
        return { valid: false, error: data.error || "Invalid invitation" };
      }
      return data;
    },
    enabled: !!token,
    retry: false,
  });

  // Registration mutation
  const registerMutation = useMutation({
    mutationFn: async (data: {
      username: string;
      password: string;
      firstName: string;
      lastName: string;
      invitationToken: string;
    }) => {
      const res = await apiRequest("POST", "/api/register", data);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.requiresVerification) {
        setRegistrationSuccess(true);
        setVerificationEmail(validation?.email || "");
      } else {
        toast({
          title: "Registration Successful",
          description: "You can now log in to your account.",
        });
        setLocation("/recruiter-auth");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Registration Failed",
        description: error.message || "An error occurred during registration.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (registerData.password !== registerData.confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please ensure both passwords are the same.",
        variant: "destructive",
      });
      return;
    }

    if (!validation?.email || !token) {
      toast({
        title: "Invalid invitation",
        description: "Please use a valid invitation link.",
        variant: "destructive",
      });
      return;
    }

    await registerMutation.mutateAsync({
      username: validation.email,
      password: registerData.password,
      firstName: registerData.firstName,
      lastName: registerData.lastName,
      invitationToken: token,
    });
  };

  // Show loading state
  if (validating) {
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

  // Show success state after registration
  if (registrationSuccess) {
    return (
      <div className="public-theme min-h-screen bg-background text-foreground">
        <Header />
        <main className="container mx-auto px-4 py-16">
          <div className="max-w-md mx-auto">
            <Card>
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <Mail className="h-6 w-6 text-green-500" />
                </div>
                <CardTitle>Check Your Email</CardTitle>
                <CardDescription>
                  We've sent a verification link to <strong>{verificationEmail}</strong>
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <p className="text-sm text-muted-foreground mb-6">
                  Please click the link in the email to verify your account and complete registration.
                </p>
                <Button variant="outline" onClick={() => setLocation("/recruiter-auth")}>
                  Go to Login
                </Button>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Show registration form
  return (
    <div className="public-theme min-h-screen bg-background text-foreground">
      <Header />
      <main className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 items-start">
            {/* Left side - Benefits */}
            <div className="space-y-6">
              <div>
                <h1 className="text-3xl font-bold mb-2">Join as a Hiring Manager</h1>
                <p className="text-muted-foreground">
                  Complete your registration to start reviewing candidates and collaborating with your recruiting team.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Review Candidates</h3>
                    <p className="text-sm text-muted-foreground">
                      Access candidate profiles and resumes for positions you're hiring for.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Provide Feedback</h3>
                    <p className="text-sm text-muted-foreground">
                      Share your evaluation and recommendations on candidates.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Collaborate</h3>
                    <p className="text-sm text-muted-foreground">
                      Work together with recruiters to make informed hiring decisions.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right side - Registration form */}
            <Card>
              <CardHeader>
                <CardTitle>Create Your Account</CardTitle>
                <CardDescription>
                  Registering as <strong>{validation.email}</strong>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        value={registerData.firstName}
                        onChange={(e) => setRegisterData(prev => ({ ...prev, firstName: e.target.value }))}
                        placeholder={validation.name?.split(' ')[0] || "First name"}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        value={registerData.lastName}
                        onChange={(e) => setRegisterData(prev => ({ ...prev, lastName: e.target.value }))}
                        placeholder={validation.name?.split(' ').slice(1).join(' ') || "Last name"}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={validation.email}
                      disabled
                      className="bg-muted"
                    />
                    <p className="text-xs text-muted-foreground">
                      Email is set from your invitation and cannot be changed.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      value={registerData.password}
                      onChange={(e) => setRegisterData(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="Create a strong password"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      At least 10 characters with uppercase, lowercase, number, and special character.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      value={registerData.confirmPassword}
                      onChange={(e) => setRegisterData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                      placeholder="Confirm your password"
                      required
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={registerMutation.isPending}
                  >
                    {registerMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating Account...
                      </>
                    ) : (
                      "Create Account"
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
