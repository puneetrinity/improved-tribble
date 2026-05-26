import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  Check,
  Loader2,
  AlertCircle,
  ArrowRight,
  Lock,
  Mail,
  Zap,
  Users,
} from "lucide-react";

interface ClaimDetails {
  email: string;
  orgName: string;
  planName: string;
  seats: number;
  billingCycle: string;
  hasExistingAccount: boolean;
  expiresAt: string;
}

async function fetchClaimDetails(token: string): Promise<ClaimDetails> {
  const res = await fetch(`/api/claim/${token}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Invalid claim token");
  }
  return res.json();
}

export default function ClaimPage() {
  const [, params] = useRoute("/claim/:token");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const token = params?.token || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const { data: claimDetails, isLoading, error } = useQuery({
    queryKey: ["claim", token],
    queryFn: () => fetchClaimDetails(token),
    enabled: !!token,
    retry: false,
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/claim/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          password: claimDetails?.hasExistingAccount ? undefined : password,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to complete claim");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Welcome to ealana!",
        description: "Your subscription has been activated.",
      });
      setLocation(data.redirectUrl || "/recruiter-dashboard");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClaim = () => {
    if (!claimDetails?.hasExistingAccount) {
      if (password.length < 8) {
        toast({
          title: "Password too short",
          description: "Password must be at least 8 characters.",
          variant: "destructive",
        });
        return;
      }
      if (password !== confirmPassword) {
        toast({
          title: "Passwords don't match",
          description: "Please make sure your passwords match.",
          variant: "destructive",
        });
        return;
      }
    }
    claimMutation.mutate();
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (error || !claimDetails) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
              <h2 className="text-xl font-bold mb-2">Invalid or Expired Link</h2>
              <p className="text-muted-foreground mb-6">
                {(error as Error)?.message || "This claim link is no longer valid."}
              </p>
              <Button onClick={() => setLocation("/pricing")}>
                View Pricing
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const expiresAt = new Date(claimDetails.expiresAt);
  const isExpired = expiresAt < new Date();

  if (isExpired) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-amber-500 mb-4" />
              <h2 className="text-xl font-bold mb-2">Link Expired</h2>
              <p className="text-muted-foreground mb-6">
                This claim link has expired. Please contact support or purchase a new subscription.
              </p>
              <Button onClick={() => setLocation("/pricing")}>
                View Pricing
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-background to-muted/20">
        <Card className="max-w-lg w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl">Complete Your Setup</CardTitle>
            <CardDescription>
              Your payment was successful! Set up your account to start using ealana.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Subscription Summary */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Organization</p>
                  <p className="font-medium">{claimDetails.orgName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Plan</p>
                  <p className="font-medium">{claimDetails.planName}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Seats</p>
                  <p className="font-medium">{claimDetails.seats} ({claimDetails.billingCycle})</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">{claimDetails.email}</p>
                </div>
              </div>
            </div>

            {/* Account Setup */}
            {claimDetails.hasExistingAccount ? (
              <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-green-800 dark:text-green-200">
                      Account Found
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                      We found an existing account with this email. Click below to add this subscription to your account.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Create Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="Confirm your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
              </div>
            )}

            <Button
              className="w-full"
              size="lg"
              onClick={handleClaim}
              disabled={claimMutation.isPending}
            >
              {claimMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              {claimDetails.hasExistingAccount ? "Activate Subscription" : "Create Account & Start"}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              By continuing, you agree to our{" "}
              <a href="/terms" className="underline hover:text-foreground">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/privacy" className="underline hover:text-foreground">
                Privacy Policy
              </a>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
