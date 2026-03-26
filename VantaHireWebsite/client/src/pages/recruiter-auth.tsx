import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, useSearch, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Mail, CheckCircle, UserPlus, ArrowLeft } from "lucide-react";
import type { OnboardingStatus } from "@/hooks/use-onboarding-status";
import recruiterAuthBg from "@/assets/recruiter-auth-bg.png";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/recruiter-auth.css";

// Type for invite details response
interface InviteDetails {
  organizationName: string;
  email: string;
  role: string;
  expiresAt: string;
  inviterName: string;
}

const brandBgStyle = { backgroundImage: `url(${recruiterAuthBg})` } as const;

export default function RecruiterAuth() {
  const { user, loginMutation, registerMutation } = useAuth();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();

  // Parse redirect URL and invite token from query params
  const { redirectUrl, inviteToken } = useMemo(() => {
    const params = new URLSearchParams(searchString);
    const redirect = params.get('redirect');
    const invite = params.get('invite');
    return {
      redirectUrl: redirect && redirect.startsWith('/') ? redirect : null,
      inviteToken: invite || null,
    };
  }, [searchString]);

  // Controlled tab state - default to register if invite token present
  const [activeTab, setActiveTab] = useState<"login" | "register">(inviteToken ? "register" : "login");

  // Fetch invite details if token present (64 hex chars)
  const { data: inviteDetails, isLoading: inviteLoading, error: inviteError } = useQuery<InviteDetails>({
    queryKey: ["/api/invites", inviteToken],
    queryFn: async () => {
      const res = await fetch(`/api/invites/${inviteToken}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Invalid invite");
      }
      return res.json();
    },
    enabled: !!inviteToken && inviteToken.length === 64,
    retry: false,
  });

  const [loginData, setLoginData] = useState({
    username: "",
    password: ""
  });

  const [registerData, setRegisterData] = useState({
    username: "",
    password: "",
    firstName: "",
    lastName: "",
    role: "recruiter",
  });

  // Pre-fill email from invite when details are loaded
  useEffect(() => {
    if (inviteDetails?.email) {
      setRegisterData(prev => ({ ...prev, username: inviteDetails.email }));
    }
  }, [inviteDetails]);

  // State for email verification flow
  const [verificationNeeded, setVerificationNeeded] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [isSendingReset, setIsSendingReset] = useState(false);

  // Check onboarding status for recruiters
  const checkOnboardingAndRedirect = useCallback(async (): Promise<OnboardingStatus | { error: true } | null> => {
    if (!user || user.role !== "recruiter") return null;

    try {
      const res = await fetch("/api/onboarding-status", { credentials: "include" });
      if (res.ok) {
        const status: OnboardingStatus = await res.json();
        return status;
      }
      return { error: true };
    } catch {
      return { error: true };
    }
  }, [user]);

  // Redirect if already logged in as recruiter, admin, or hiring manager
  useEffect(() => {
    if (!user) return;

    if (inviteToken && user.role === "recruiter") {
      setLocation(`/org/choice?invite=${inviteToken}`);
      return;
    }

    if (user.role === "recruiter") {
      checkOnboardingAndRedirect().then((status) => {
        if (!status || 'error' in status) {
          setLocation("/onboarding");
          return;
        }
        if (status.needsOnboarding) {
          setLocation(`/onboarding?step=${status.currentStep}`);
        } else {
          setLocation(redirectUrl || "/recruiter-dashboard");
        }
      });
      return;
    }

    if (user.role === "super_admin") {
      setLocation(redirectUrl || "/admin");
      return;
    }

    if (user.role === "hiring_manager") {
      setLocation("/hiring-manager");
    }
  }, [user, setLocation, redirectUrl, inviteToken, checkOnboardingAndRedirect]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await loginMutation.mutateAsync({ ...loginData, expectedRole: ['recruiter', 'super_admin', 'hiring_manager'] });
    } catch (error: any) {
      const errorData = error?.response?.data || error;
      if (errorData?.code === 'EMAIL_NOT_VERIFIED' || error?.message?.includes('verify your email')) {
        setVerificationNeeded(true);
        setVerificationEmail(errorData?.email || loginData.username);
      }
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await registerMutation.mutateAsync({ ...registerData, inviteToken: inviteToken || undefined });
    if ('requiresVerification' in result && result.requiresVerification) {
      setRegistrationSuccess(true);
      setVerificationEmail(registerData.username);
    }
  };

  const handleResendVerification = async () => {
    if (!verificationEmail || resendLoading) return;

    setResendLoading(true);
    try {
      const response = await fetch('/api/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verificationEmail, inviteToken }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to send verification email.");
      }
      toast({
        title: recruiterAuthPageCopy.toasts.verificationSentTitle,
        description: data.message || recruiterAuthPageCopy.toasts.verificationSentDescription,
      });
    } catch (error: any) {
      toast({
        title: recruiterAuthPageCopy.toasts.errorTitle,
        description: error?.message || recruiterAuthPageCopy.toasts.verificationFailed,
        variant: "destructive",
      });
    } finally {
      setResendLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotPasswordEmail) return;

    setIsSendingReset(true);
    try {
      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotPasswordEmail }),
      });
      const data = await res.json();
      toast({
        title: "Check your email",
        description: data.message || "If an account exists with this email, a password reset link has been sent.",
      });
      setShowForgotPassword(false);
      setForgotPasswordEmail("");
    } catch {
      toast({
        title: "Error",
        description: "Failed to send password reset email. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSendingReset(false);
    }
  };

  // Render the right-panel form content
  const renderFormContent = () => {
    // Registration success state
    if (registrationSuccess) {
      return (
        <div className="hr-rauth-state-card">
          <div className="hr-rauth-state-icon success">
            <CheckCircle size={28} />
          </div>
          <div className="hr-rauth-state-title">Check Your Email</div>
          <div className="hr-rauth-state-desc">
            We've sent a verification link to <span className="hr-rauth-state-email">{verificationEmail}</span>
          </div>
          <p className="hr-rauth-state-hint">
            Click the link in the email to verify your account and start using VantaHire.
          </p>
          <div className="hr-rauth-state-actions">
            <button className="hr-rauth-btn-secondary" onClick={handleResendVerification} disabled={resendLoading}>
              {resendLoading ? "Sending..." : "Resend Verification Email"}
            </button>
            <button className="hr-rauth-btn-ghost" onClick={() => { setRegistrationSuccess(false); setVerificationEmail(""); }}>
              Back to Login
            </button>
          </div>
        </div>
      );
    }

    // Email verification needed (from login attempt)
    if (verificationNeeded) {
      return (
        <div className="hr-rauth-state-card">
          <div className="hr-rauth-state-icon warning">
            <Mail size={28} />
          </div>
          <div className="hr-rauth-state-title">Verify Your Email</div>
          <div className="hr-rauth-state-desc">
            Check your inbox at <span className="hr-rauth-state-email">{verificationEmail}</span> for a verification link.
          </div>
          <div className="hr-rauth-state-actions">
            <button className="hr-rauth-btn-secondary" onClick={handleResendVerification} disabled={resendLoading}>
              {resendLoading ? "Sending..." : "Resend Verification Email"}
            </button>
            <button className="hr-rauth-btn-ghost" onClick={() => { setVerificationNeeded(false); setVerificationEmail(""); }}>
              Back to Login
            </button>
          </div>
        </div>
      );
    }

    // Forgot password form
    if (showForgotPassword) {
      return (
        <form onSubmit={handleForgotPassword} className="hr-rauth-forgot-form">
          <div className="hr-rauth-forgot-header">
            <div className="hr-rauth-forgot-header-icon">
              <Mail size={16} />
            </div>
            <div className="hr-rauth-forgot-title">Reset Password</div>
          </div>
          <div className="hr-rauth-forgot-desc">
            Enter your email to receive a password reset link.
          </div>
          <div className="hr-rauth-field">
            <label className="hr-rauth-label">Email</label>
            <input
              type="email"
              className="hr-rauth-input"
              placeholder="Enter your email"
              value={forgotPasswordEmail}
              onChange={(e) => setForgotPasswordEmail(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="hr-rauth-submit" disabled={isSendingReset}>
            {isSendingReset ? "Sending..." : "Send Reset Link"}
          </button>
          <button
            type="button"
            className="hr-rauth-btn-ghost with-icon"
            onClick={() => setShowForgotPassword(false)}
          >
            <ArrowLeft size={14} />
            Back to Login
          </button>
        </form>
      );
    }

    // Normal auth form
    return (
      <>
        {/* Invite Banner */}
        {inviteToken && inviteDetails && (
          <div className="hr-rauth-invite-banner">
            <div className="hr-rauth-invite-icon">
              <UserPlus size={16} />
            </div>
            <div className="hr-rauth-invite-text">
              You've been invited to join <strong>{inviteDetails.organizationName}</strong>
              <span>Invited by {inviteDetails.inviterName} as {inviteDetails.role}</span>
            </div>
          </div>
        )}

        {/* Invite Error */}
        {inviteToken && inviteError && (
          <div className="hr-rauth-invite-error">
            {(inviteError as Error).message || "Invalid or expired invite link"}
          </div>
        )}

        <div className="hr-rauth-card-header">
          <div className="hr-rauth-card-title">
            {inviteDetails ? "Create Your Account" : "Recruiter Access"}
          </div>
          <div className="hr-rauth-card-desc">
            {inviteDetails
              ? `Register to join ${inviteDetails.organizationName}`
              : "Sign in to your recruiter account or create a new one"
            }
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="hr-rauth-tabs">
          <button
            className={`hr-rauth-tab ${activeTab === 'login' ? 'active' : ''}`}
            onClick={() => setActiveTab('login')}
          >
            Sign In
          </button>
          <button
            className={`hr-rauth-tab ${activeTab === 'register' ? 'active' : ''}`}
            onClick={() => setActiveTab('register')}
          >
            Register
          </button>
        </div>

        {/* Login Form */}
        {activeTab === 'login' && (
          <form onSubmit={handleLogin} className="hr-rauth-form">
            <div className="hr-rauth-field">
              <label className="hr-rauth-label">Username or Email</label>
              <input
                type="text"
                className="hr-rauth-input"
                placeholder="Enter your username or email"
                value={loginData.username}
                onChange={(e) => setLoginData(prev => ({ ...prev, username: e.target.value }))}
                required
              />
            </div>
            <div className="hr-rauth-field">
              <label className="hr-rauth-label">Password</label>
              <input
                type="password"
                autoComplete="current-password"
                className="hr-rauth-input"
                placeholder="Enter your password"
                value={loginData.password}
                onChange={(e) => setLoginData(prev => ({ ...prev, password: e.target.value }))}
                required
              />
            </div>
            <div className="hr-rauth-forgot-link">
              <button type="button" onClick={() => setShowForgotPassword(true)}>
                Forgot your password?
              </button>
            </div>
            <button type="submit" className="hr-rauth-submit" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        {/* Register Form */}
        {activeTab === 'register' && (
          <form onSubmit={handleRegister} className="hr-rauth-form">
            <div className="hr-rauth-field-row">
              <div className="hr-rauth-field">
                <label className="hr-rauth-label">First Name</label>
                <input
                  type="text"
                  className="hr-rauth-input"
                  placeholder="First name"
                  value={registerData.firstName}
                  onChange={(e) => setRegisterData(prev => ({ ...prev, firstName: e.target.value }))}
                  required
                />
              </div>
              <div className="hr-rauth-field">
                <label className="hr-rauth-label">Last Name</label>
                <input
                  type="text"
                  className="hr-rauth-input"
                  placeholder="Last name"
                  value={registerData.lastName}
                  onChange={(e) => setRegisterData(prev => ({ ...prev, lastName: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="hr-rauth-field">
              <label className="hr-rauth-label">Email *</label>
              <input
                type="email"
                className={`hr-rauth-input ${inviteDetails ? 'readonly' : ''}`}
                placeholder="Enter your email address"
                value={registerData.username}
                onChange={(e) => setRegisterData(prev => ({ ...prev, username: e.target.value }))}
                required
                readOnly={!!inviteDetails}
                title={inviteDetails ? "Email is locked to the invite" : undefined}
              />
              {inviteDetails && (
                <span className="hr-rauth-input-hint">Email is locked to the invite</span>
              )}
            </div>
            <div className="hr-rauth-field">
              <label className="hr-rauth-label">Password *</label>
              <input
                type="password"
                autoComplete="new-password"
                className="hr-rauth-input"
                placeholder="Create a strong password"
                value={registerData.password}
                onChange={(e) => setRegisterData(prev => ({ ...prev, password: e.target.value }))}
                required
              />
            </div>
            <button type="submit" className="hr-rauth-submit" disabled={registerMutation.isPending}>
              {registerMutation.isPending ? "Creating account..." : "Create Recruiter Account"}
            </button>
          </form>
        )}
      </>
    );
  };

  return (
    <div className="hr-rauth-split">
      {/* Left Panel — Brand */}
      <div className="hr-rauth-brand" style={brandBgStyle}>
        <div className="hr-rauth-brand-inner">
          <h1 className="hr-rauth-brand-title">
            AI-Powered Hiring<br />For Modern Teams
          </h1>

          <p className="hr-rauth-brand-desc">
            Post jobs, review applications, and find the perfect candidates — all from one intelligent platform.
          </p>

        </div>
      </div>

      {/* Right Panel — Auth Form */}
      <div className="hr-rauth-form-panel">
        <div className="hr-rauth-form-wrapper">
          {renderFormContent()}

          <div className="hr-rauth-legal">
            By continuing, you agree to the <Link href="/terms-of-service">Terms of Service</Link> and <Link href="/privacy-policy">Privacy Policy</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
