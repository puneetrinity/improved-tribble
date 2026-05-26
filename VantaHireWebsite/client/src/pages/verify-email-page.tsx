import { useState, useEffect, useMemo } from "react";
import { useRoute, Link, useSearch } from "wouter";
import { CheckCircle, XCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Layout from "@/components/Layout";
import BrandedLoadingScreen from "@/components/internal/BrandedLoadingScreen";

type VerificationState = "ready" | "loading" | "success" | "error" | "expired";

export default function VerifyEmailPage() {
  const [, params] = useRoute("/verify-email/:token");
  const searchString = useSearch();
  const [state, setState] = useState<VerificationState>("ready");
  const [message, setMessage] = useState("");
  const [isVisible, setIsVisible] = useState(false);

  const token = params?.token;

  const inviteToken = useMemo(() => {
    const searchParams = new URLSearchParams(searchString);
    return searchParams.get("invite");
  }, [searchString]);

  const redirectUrl = inviteToken
    ? `/recruiter-auth?invite=${inviteToken}`
    : "/recruiter-auth";

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("Invalid verification link.");
    }
  }, [token]);

  const verifyEmail = async () => {
    if (!token || state === "loading") return;
    setState("loading");
    setMessage("");

    try {
      const response = await fetch(`/api/verify-email/${token}`);
      const data = await response.json();

      if (response.ok && data.verified) {
        setState("success");
        setMessage(data.message || "Your email has been verified successfully!");
      } else if (data.code === "VERIFICATION_TOKEN_EXPIRED") {
        setState("expired");
        setMessage(data.error || "Your verification link has expired.");
      } else if (data.code === "VERIFICATION_TOKEN_INVALID") {
        setState("error");
        setMessage(data.error || "This verification link is invalid or already used.");
      } else if (typeof data.error === "string" && data.error.toLowerCase().includes("expired")) {
        setState("expired");
        setMessage(data.error || "Your verification link has expired.");
      } else {
        setState("error");
        setMessage(data.error || "Failed to verify your email.");
      }
    } catch {
      setState("error");
      setMessage("An error occurred while verifying your email.");
    }
  };

  return (
    <Layout>
      <div className="public-theme min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10" />
        <div className="absolute top-0 left-1/4 h-96 w-96 rounded-full bg-primary/10 blur-[100px] animate-pulse-slow" />
        <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-info/10 blur-[100px] animate-pulse-slow" style={{ animationDelay: "1.2s" }} />

        <div className={`relative z-10 w-full max-w-md transition-opacity duration-1000 ${isVisible ? "opacity-100" : "opacity-0"}`}>
          <Card className="border-border bg-muted/50 backdrop-blur-sm">
            {state !== "loading" ? (
              <>
                <CardHeader className="text-center">
                  {state === "ready" && (
                    <>
                      <div className="mb-4 flex justify-center">
                        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/20">
                          <Mail className="h-12 w-12 text-primary" />
                        </div>
                      </div>
                      <CardTitle className="text-2xl text-foreground">Confirm Email Verification</CardTitle>
                      <CardDescription className="text-muted-foreground/50">
                        Click the button below to verify your email address.
                      </CardDescription>
                    </>
                  )}

                  {state === "success" && (
                    <>
                      <div className="mb-4 flex justify-center">
                        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/20">
                          <CheckCircle className="h-12 w-12 text-success" />
                        </div>
                      </div>
                      <CardTitle className="text-2xl text-foreground">Email Verified!</CardTitle>
                      <CardDescription className="text-muted-foreground/50">{message}</CardDescription>
                    </>
                  )}

                  {state === "error" && (
                    <>
                      <div className="mb-4 flex justify-center">
                        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/20">
                          <XCircle className="h-12 w-12 text-destructive" />
                        </div>
                      </div>
                      <CardTitle className="text-2xl text-foreground">Verification Failed</CardTitle>
                      <CardDescription className="text-muted-foreground/50">{message}</CardDescription>
                    </>
                  )}

                  {state === "expired" && (
                    <>
                      <div className="mb-4 flex justify-center">
                        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning/20">
                          <Mail className="h-12 w-12 text-warning" />
                        </div>
                      </div>
                      <CardTitle className="text-2xl text-foreground">Link Expired</CardTitle>
                      <CardDescription className="text-muted-foreground/50">{message}</CardDescription>
                    </>
                  )}
                </CardHeader>

                <CardContent className="space-y-4">
                  {state === "ready" && (
                    <Button
                      onClick={verifyEmail}
                      className="w-full bg-[linear-gradient(135deg,#4B8EF0_0%,#34D17A_100%)] hover:opacity-95"
                    >
                      Verify Email
                    </Button>
                  )}

                  {state === "success" && (
                    <Link href={redirectUrl}>
                      <Button className="w-full bg-[linear-gradient(135deg,#4B8EF0_0%,#34D17A_100%)] hover:opacity-95">
                        Continue to Login
                      </Button>
                    </Link>
                  )}

                  {state === "expired" && (
                    <div className="space-y-3">
                      <p className="text-center text-sm text-muted-foreground">
                        Please log in with your credentials to request a new verification email.
                      </p>
                      <Link href={redirectUrl}>
                        <Button className="w-full bg-[linear-gradient(135deg,#4B8EF0_0%,#34D17A_100%)] hover:opacity-95">
                          Go to Login
                        </Button>
                      </Link>
                    </div>
                  )}

                  {state === "error" && (
                    <div className="space-y-3">
                      <p className="text-center text-sm text-muted-foreground">
                        The verification link may be invalid or already used.
                      </p>
                      <Link href={redirectUrl}>
                        <Button className="w-full bg-[linear-gradient(135deg,#4B8EF0_0%,#34D17A_100%)] hover:opacity-95">
                          Go to Login
                        </Button>
                      </Link>
                    </div>
                  )}
                </CardContent>
              </>
            ) : (
              <CardContent className="p-4">
                <BrandedLoadingScreen label="Verifying your email..." />
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </Layout>
  );
}
