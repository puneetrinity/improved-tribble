import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HomepageFooter from "@/components/HomepageFooter";
import HomepageNav from "@/components/HomepageNav";
import GridOverlay from "@/components/GridOverlay";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { isApiError } from "@/lib/queryClient";
import { candidateAuthPageCopy } from "@/lib/internal-copy";

export default function CandidateAuth() {
  const { user, loginMutation, registerMutation } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [loginData, setLoginData] = useState({
    username: "",
    password: "",
  });
  const [registerData, setRegisterData] = useState({
    username: "",
    password: "",
    firstName: "",
    lastName: "",
    role: "candidate",
  });

  useEffect(() => {
    if (user?.role === "candidate" && user.emailVerified) {
      setLocation("/my-dashboard");
    } else if (user?.role === "candidate") {
      setVerificationEmail(user.username);
    } else if (user) {
      toast({
        title: candidateAuthPageCopy.accessDeniedTitle,
        description: candidateAuthPageCopy.accessDeniedDescription,
        variant: "destructive",
      });
      setLocation("/recruiter-auth");
    }
  }, [user, setLocation, toast]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await loginMutation.mutateAsync({ ...loginData, expectedRole: "candidate" });
    } catch (error) {
      if (isApiError(error) && error.code === "EMAIL_NOT_VERIFIED") {
        setVerificationEmail(loginData.username.trim().toLowerCase());
      }
    }
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const response = await registerMutation.mutateAsync(registerData);
      if ("requiresVerification" in response && response.requiresVerification) {
        setVerificationEmail(registerData.username.trim().toLowerCase());
      }
    } catch {
      // The shared auth mutation presents the server error.
    }
  };

  const handleResendVerification = async () => {
    if (!verificationEmail || resendLoading) return;

    setResendLoading(true);
    try {
      const response = await fetch("/api/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: verificationEmail }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to send verification email.");
      }
      toast({
        title: "Verification email sent",
        description: data.message || "Check your inbox for a new verification link.",
      });
    } catch (error) {
      toast({
        title: "Could not resend email",
        description: error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="public-theme min-h-screen bg-e-bg text-e-text">
      <GridOverlay />
      <div className="relative z-10 min-h-screen">
        <HomepageNav audience="candidate" />
        <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[560px] items-center px-4 pb-20 pt-28 sm:px-6">
          <div className="w-full">
            <div className="mb-7 text-center">
              <p className="mb-3 font-mono text-[0.68rem] font-medium uppercase tracking-[0.12em] text-e-blue">
                Candidate Portal
              </p>
              <h1 className="font-display text-3xl font-medium text-e-text sm:text-4xl">
                Your jobs, resumes, and applications
              </h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-e-text2">
                Sign in to browse roles, save opportunities, apply with your resume, and track every application.
              </p>
            </div>

            <Card className="border-white/10 bg-white/[0.04] shadow-[0_18px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl">
              {verificationEmail ? (
                <CardContent className="p-8 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-e-blue/15 text-e-blue">
                    <Mail className="h-5 w-5" />
                  </div>
                  <h2 className="text-xl font-semibold text-e-text">Verify your email</h2>
                  <p className="mt-2 text-sm leading-6 text-e-text2">
                    We sent a verification link to <span className="font-medium text-e-text">{verificationEmail}</span>.
                    Verify that address before signing in.
                  </p>
                  <div className="mt-6 flex flex-col gap-2">
                    <Button
                      type="button"
                      className="bg-e-blue text-white hover:brightness-110"
                      onClick={handleResendVerification}
                      disabled={resendLoading}
                    >
                      {resendLoading ? "Sending..." : "Resend verification email"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setVerificationEmail("")}>
                      Back to sign in
                    </Button>
                  </div>
                </CardContent>
              ) : (
                <>
                  <CardHeader className="text-center">
                    <CardTitle className="text-2xl text-e-text">{candidateAuthPageCopy.card.title}</CardTitle>
                    <CardDescription className="text-e-text2">
                      {candidateAuthPageCopy.card.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="login" className="space-y-6">
                      <TabsList className="grid w-full grid-cols-2 bg-white/[0.05]">
                        <TabsTrigger value="login">{candidateAuthPageCopy.card.signIn}</TabsTrigger>
                        <TabsTrigger value="register">{candidateAuthPageCopy.card.register}</TabsTrigger>
                      </TabsList>

                      <TabsContent value="login">
                        <form onSubmit={handleLogin} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="candidate-login-email">{candidateAuthPageCopy.card.email}</Label>
                            <Input
                              id="candidate-login-email"
                              type="email"
                              autoComplete="email"
                              value={loginData.username}
                              onChange={(event) => setLoginData((current) => ({ ...current, username: event.target.value }))}
                              placeholder={candidateAuthPageCopy.card.emailPlaceholder}
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="candidate-login-password">{candidateAuthPageCopy.card.password}</Label>
                            <Input
                              id="candidate-login-password"
                              type="password"
                              autoComplete="current-password"
                              value={loginData.password}
                              onChange={(event) => setLoginData((current) => ({ ...current, password: event.target.value }))}
                              placeholder={candidateAuthPageCopy.card.passwordPlaceholder}
                              required
                            />
                          </div>
                          <Button
                            type="submit"
                            className="w-full bg-e-blue text-white hover:brightness-110"
                            disabled={loginMutation.isPending}
                          >
                            {loginMutation.isPending ? candidateAuthPageCopy.card.signingIn : candidateAuthPageCopy.card.signIn}
                          </Button>
                        </form>
                      </TabsContent>

                      <TabsContent value="register">
                        <form onSubmit={handleRegister} className="space-y-4">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="candidate-first-name">{candidateAuthPageCopy.card.firstName}</Label>
                              <Input
                                id="candidate-first-name"
                                value={registerData.firstName}
                                onChange={(event) => setRegisterData((current) => ({ ...current, firstName: event.target.value }))}
                                placeholder={candidateAuthPageCopy.card.firstNamePlaceholder}
                                required
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="candidate-last-name">{candidateAuthPageCopy.card.lastName}</Label>
                              <Input
                                id="candidate-last-name"
                                value={registerData.lastName}
                                onChange={(event) => setRegisterData((current) => ({ ...current, lastName: event.target.value }))}
                                placeholder={candidateAuthPageCopy.card.lastNamePlaceholder}
                                required
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="candidate-register-email">{candidateAuthPageCopy.card.email}</Label>
                            <Input
                              id="candidate-register-email"
                              type="email"
                              autoComplete="email"
                              value={registerData.username}
                              onChange={(event) => setRegisterData((current) => ({ ...current, username: event.target.value }))}
                              placeholder={candidateAuthPageCopy.card.emailPlaceholder}
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="candidate-register-password">{candidateAuthPageCopy.card.password}</Label>
                            <Input
                              id="candidate-register-password"
                              type="password"
                              autoComplete="new-password"
                              value={registerData.password}
                              onChange={(event) => setRegisterData((current) => ({ ...current, password: event.target.value }))}
                              placeholder={candidateAuthPageCopy.card.createPasswordPlaceholder}
                              required
                            />
                          </div>
                          <Button
                            type="submit"
                            className="w-full bg-e-blue text-white hover:brightness-110"
                            disabled={registerMutation.isPending}
                          >
                            {registerMutation.isPending ? candidateAuthPageCopy.card.creatingAccount : candidateAuthPageCopy.card.createAccount}
                          </Button>
                        </form>
                      </TabsContent>
                    </Tabs>

                    <div className="mt-6 flex items-center justify-center gap-2 border-t border-white/10 pt-5 text-sm text-e-text2">
                      <CheckCircle2 className="h-4 w-4 text-e-green" />
                      Candidate access includes 10 monthly match credits.
                    </div>
                  </CardContent>
                </>
              )}
            </Card>

            <p className="mt-6 text-center text-sm text-e-text3">
              {candidateAuthPageCopy.hero.recruiterPrompt}{" "}
              <button
                type="button"
                className="border-0 bg-transparent p-0 font-medium text-e-blue hover:underline"
                onClick={() => setLocation("/recruiter-auth")}
              >
                {candidateAuthPageCopy.hero.recruiterLink}
              </button>
            </p>
          </div>
        </main>
        <HomepageFooter audience="candidate" />
      </div>
    </div>
  );
}
