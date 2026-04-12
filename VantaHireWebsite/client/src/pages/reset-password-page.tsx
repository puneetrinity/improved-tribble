import { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { CheckCircle, XCircle, Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Layout from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";

type ResetState = "form" | "loading" | "success" | "error" | "expired";

export default function ResetPasswordPage() {
  const [, params] = useRoute("/reset-password/:token");
  const { toast } = useToast();
  const [state, setState] = useState<ResetState>("form");
  const [message, setMessage] = useState("");
  const [isVisible, setIsVisible] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const token = params?.token;

  // Fade-in animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      setState("error");
      setMessage("Invalid reset link.");
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure both passwords are the same.",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 10) {
      toast({
        title: "Password too short",
        description: "Password must be at least 10 characters long.",
        variant: "destructive",
      });
      return;
    }

    setState("loading");

    try {
      const response = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await response.json();

      if (response.ok) {
        setState("success");
        setMessage(data.message || "Your password has been reset successfully!");
      } else if (data.error?.includes("expired")) {
        setState("expired");
        setMessage(data.error || "Your reset link has expired.");
      } else {
        setState("error");
        setMessage(data.error || "Failed to reset your password.");
      }
    } catch {
      setState("error");
      setMessage("An error occurred while resetting your password.");
    }
  };

  if (!token) {
    return (
      <Layout>
        <div className="public-theme min-h-screen bg-background text-foreground flex items-center justify-center p-4">
          <Card className="bg-muted/50 backdrop-blur-sm border-border w-full max-w-md">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="w-20 h-20 bg-destructive/20 rounded-full flex items-center justify-center">
                  <XCircle className="h-12 w-12 text-destructive" />
                </div>
              </div>
              <CardTitle className="text-foreground text-2xl">Invalid Link</CardTitle>
              <CardDescription className="text-muted-foreground/50">
                This password reset link is invalid.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/recruiter-auth">
                <Button className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600">
                  Go to Login
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="public-theme min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        {/* Premium background effects */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[100px] animate-pulse-slow"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-info/10 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1.2s' }}></div>

        <div className={`w-full max-w-md relative z-10 transition-opacity duration-1000 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
          <Card className="bg-muted/50 backdrop-blur-sm border-border">
            {state === "form" && (
              <>
                <CardHeader className="text-center">
                  <div className="flex justify-center mb-4">
                    <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center">
                      <KeyRound className="h-12 w-12 text-primary" />
                    </div>
                  </div>
                  <CardTitle className="text-foreground text-2xl">Create New Password</CardTitle>
                  <CardDescription className="text-muted-foreground/50">
                    Enter your new password below
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-foreground">New Password</Label>
                      <Input
                        id="password"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="bg-muted/30 border-border text-foreground placeholder:text-muted-foreground"
                        placeholder="Enter new password"
                      />
                      <p className="text-xs text-muted-foreground">
                        Must be at least 10 characters with uppercase, lowercase, number, and special character.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword" className="text-foreground">Confirm Password</Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        className="bg-muted/30 border-border text-foreground placeholder:text-muted-foreground"
                        placeholder="Confirm new password"
                      />
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
                    >
                      Reset Password
                    </Button>
                  </form>
                </CardContent>
              </>
            )}

            {state === "loading" && (
              <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                  <Loader2 className="h-16 w-16 text-primary animate-spin" />
                </div>
                <CardTitle className="text-foreground text-2xl">Resetting password...</CardTitle>
                <CardDescription className="text-muted-foreground/50">
                  Please wait while we reset your password.
                </CardDescription>
              </CardHeader>
            )}

            {state === "success" && (
              <>
                <CardHeader className="text-center">
                  <div className="flex justify-center mb-4">
                    <div className="w-20 h-20 bg-success/20 rounded-full flex items-center justify-center">
                      <CheckCircle className="h-12 w-12 text-success" />
                    </div>
                  </div>
                  <CardTitle className="text-foreground text-2xl">Password Reset!</CardTitle>
                  <CardDescription className="text-muted-foreground/50">
                    {message}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href="/recruiter-auth">
                    <Button className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600">
                      Continue to Login
                    </Button>
                  </Link>
                </CardContent>
              </>
            )}

            {state === "error" && (
              <>
                <CardHeader className="text-center">
                  <div className="flex justify-center mb-4">
                    <div className="w-20 h-20 bg-destructive/20 rounded-full flex items-center justify-center">
                      <XCircle className="h-12 w-12 text-destructive" />
                    </div>
                  </div>
                  <CardTitle className="text-foreground text-2xl">Reset Failed</CardTitle>
                  <CardDescription className="text-muted-foreground/50">
                    {message}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground text-center">
                    The reset link may be invalid or already used.
                  </p>
                  <Link href="/recruiter-auth">
                    <Button className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600">
                      Go to Login
                    </Button>
                  </Link>
                </CardContent>
              </>
            )}

            {state === "expired" && (
              <>
                <CardHeader className="text-center">
                  <div className="flex justify-center mb-4">
                    <div className="w-20 h-20 bg-warning/20 rounded-full flex items-center justify-center">
                      <KeyRound className="h-12 w-12 text-warning" />
                    </div>
                  </div>
                  <CardTitle className="text-foreground text-2xl">Link Expired</CardTitle>
                  <CardDescription className="text-muted-foreground/50">
                    {message}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground text-center">
                    Please request a new password reset link.
                  </p>
                  <Link href="/recruiter-auth">
                    <Button className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600">
                      Go to Login
                    </Button>
                  </Link>
                </CardContent>
              </>
            )}
          </Card>
        </div>
      </div>
    </Layout>
  );
}
