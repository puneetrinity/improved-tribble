import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, useSearch, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Mail, CheckCircle, UserPlus, ArrowLeft } from "lucide-react";
import type { OnboardingStatus } from "@/hooks/use-onboarding-status";
import recruiterAuthBg from "@/assets/recruiter-auth-bg.png";

// Type for invite details response
interface InviteDetails {
  organizationName: string;
  email: string;
  role: string;
  expiresAt: string;
  inviterName: string;
}

const brandBgStyle = { backgroundImage: `url(${recruiterAuthBg})` } as const;

// --- Tailwind class constants ---

// Border color: --hr-border = rgba(255,255,255,0.08)
const hrBorder = "border-[rgba(255,255,255,0.08)]";
// Border color: --hr-border-light = rgba(255,255,255,0.12)
const hrBorderLight = "border-[rgba(255,255,255,0.12)]";

// Shared input classes
const inputCls =
  `bg-hr-bg-elevated ${hrBorder} border rounded-[4px] px-3.5 py-2.5 font-dm text-[0.88rem] text-hr-text transition-[border-color] duration-200 outline-none w-full box-border placeholder:text-hr-text-muted placeholder:opacity-60 focus:border-hr-accent`;

// Shared label classes
const labelCls = "font-dm text-[0.78rem] font-medium text-hr-text-secondary tracking-[0.02em]";

// Shared field classes
const fieldCls = "flex flex-col gap-1.5";

// Submit button
const submitCls =
  "bg-hr-accent text-white border-none py-3 px-6 rounded-none font-dm text-[0.9rem] font-medium cursor-pointer transition-colors duration-200 w-full mt-1 hover:bg-hr-accent-hover disabled:opacity-60 disabled:cursor-not-allowed";

// Secondary button
const secondaryCls =
  `bg-transparent text-hr-text ${hrBorderLight} border py-2.5 px-6 rounded-none font-dm text-[0.85rem] font-medium cursor-pointer transition-all duration-200 w-full hover:border-[rgba(255,255,255,0.25)] disabled:opacity-60 disabled:cursor-not-allowed`;

// Ghost button
const ghostCls =
  "bg-transparent text-hr-text-muted border-none py-2.5 px-6 font-dm text-[0.82rem] font-normal cursor-pointer transition-colors duration-200 w-full hover:text-hr-text";

// Ghost button with icon
const ghostWithIconCls = `${ghostCls} flex items-center justify-center gap-1.5`;

// Form container
const formCls = "flex flex-col gap-4";

// State card (verification / success)
const stateCardCls = "text-center flex flex-col items-center gap-4";

// State icon base
const stateIconBaseCls = "w-14 h-14 rounded-full flex items-center justify-center";

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
        <div className={stateCardCls}>
          <div className={`${stateIconBaseCls} bg-[rgba(16,185,129,0.12)] text-hr-green`}>
            <CheckCircle size={28} />
          </div>
          <div className="font-satoshi text-[1.2rem] font-medium text-hr-text">Check Your Email</div>
          <div className="font-dm text-[0.88rem] text-hr-text-secondary leading-[1.6] max-w-[320px]">
            We've sent a verification link to <span className="text-hr-text font-medium">{verificationEmail}</span>
          </div>
          <p className="text-[0.82rem] text-hr-text-muted leading-[1.6]">
            Click the link in the email to verify your account and start using VantaHire.
          </p>
          <div className="flex flex-col gap-2 w-full max-w-[280px] mt-2">
            <button className={secondaryCls} onClick={handleResendVerification} disabled={resendLoading}>
              {resendLoading ? "Sending..." : "Resend Verification Email"}
            </button>
            <button className={ghostCls} onClick={() => { setRegistrationSuccess(false); setVerificationEmail(""); }}>
              Back to Login
            </button>
          </div>
        </div>
      );
    }

    // Email verification needed (from login attempt)
    if (verificationNeeded) {
      return (
        <div className={stateCardCls}>
          <div className={`${stateIconBaseCls} bg-[rgba(245,158,11,0.12)] text-hr-yellow`}>
            <Mail size={28} />
          </div>
          <div className="font-satoshi text-[1.2rem] font-medium text-hr-text">Verify Your Email</div>
          <div className="font-dm text-[0.88rem] text-hr-text-secondary leading-[1.6] max-w-[320px]">
            Check your inbox at <span className="text-hr-text font-medium">{verificationEmail}</span> for a verification link.
          </div>
          <div className="flex flex-col gap-2 w-full max-w-[280px] mt-2">
            <button className={secondaryCls} onClick={handleResendVerification} disabled={resendLoading}>
              {resendLoading ? "Sending..." : "Resend Verification Email"}
            </button>
            <button className={ghostCls} onClick={() => { setVerificationNeeded(false); setVerificationEmail(""); }}>
              Back to Login
            </button>
          </div>
        </div>
      );
    }

    // Forgot password form
    if (showForgotPassword) {
      return (
        <form onSubmit={handleForgotPassword} className={formCls}>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-[30px] h-[30px] rounded-[6px] bg-[rgba(124,58,237,0.1)] text-hr-accent-hover flex items-center justify-center shrink-0">
              <Mail size={16} />
            </div>
            <div className="font-satoshi text-[1.1rem] font-medium text-hr-text">Reset Password</div>
          </div>
          <div className="text-[0.82rem] text-hr-text-muted leading-[1.5]">
            Enter your email to receive a password reset link.
          </div>
          <div className={fieldCls}>
            <label className={labelCls}>Email</label>
            <input
              type="email"
              className={inputCls}
              placeholder="Enter your email"
              value={forgotPasswordEmail}
              onChange={(e) => setForgotPasswordEmail(e.target.value)}
              required
            />
          </div>
          <button type="submit" className={submitCls} disabled={isSendingReset}>
            {isSendingReset ? "Sending..." : "Send Reset Link"}
          </button>
          <button
            type="button"
            className={ghostWithIconCls}
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
          <div className="flex items-center gap-3 py-3.5 px-[18px] bg-[rgba(124,58,237,0.06)] border border-[rgba(124,58,237,0.12)] rounded-lg mb-6">
            <div className="w-8 h-8 rounded-[6px] bg-[rgba(124,58,237,0.12)] text-hr-accent-hover flex items-center justify-center shrink-0">
              <UserPlus size={16} />
            </div>
            <div className="text-[0.82rem] text-hr-text-secondary leading-[1.4] [&_strong]:text-hr-accent-hover [&_strong]:font-medium [&_span]:block [&_span]:text-[0.72rem] [&_span]:text-hr-text-muted [&_span]:mt-0.5">
              You've been invited to join <strong>{inviteDetails.organizationName}</strong>
              <span>Invited by {inviteDetails.inviterName} as {inviteDetails.role}</span>
            </div>
          </div>
        )}

        {/* Invite Error */}
        {inviteToken && inviteError && (
          <div className="py-3 px-[18px] bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)] rounded-lg text-[0.82rem] text-hr-red mb-6">
            {(inviteError as Error).message || "Invalid or expired invite link"}
          </div>
        )}

        <div className="text-center mb-7">
          <div className="font-satoshi text-2xl font-medium text-hr-text mb-2">
            {inviteDetails ? "Create Your Account" : "Recruiter Access"}
          </div>
          <div className="font-dm text-[0.85rem] text-hr-text-muted leading-[1.5]">
            {inviteDetails
              ? `Register to join ${inviteDetails.organizationName}`
              : "Sign in to your recruiter account or create a new one"
            }
          </div>
        </div>

        {/* Tab Switcher */}
        <div className={`grid grid-cols-2 bg-hr-bg-elevated rounded-[4px] ${hrBorder} border overflow-hidden mb-6`}>
          <button
            className={`py-2.5 font-dm text-[0.82rem] font-medium border-none cursor-pointer text-center transition-colors duration-200 ${activeTab === 'login' ? 'bg-hr-accent text-white' : 'bg-transparent text-hr-text-muted hover:text-hr-text-secondary'}`}
            onClick={() => setActiveTab('login')}
          >
            Sign In
          </button>
          <button
            className={`py-2.5 font-dm text-[0.82rem] font-medium border-none cursor-pointer text-center transition-colors duration-200 ${activeTab === 'register' ? 'bg-hr-accent text-white' : 'bg-transparent text-hr-text-muted hover:text-hr-text-secondary'}`}
            onClick={() => setActiveTab('register')}
          >
            Register
          </button>
        </div>

        {/* Login Form */}
        {activeTab === 'login' && (
          <form onSubmit={handleLogin} className={formCls}>
            <div className={fieldCls}>
              <label className={labelCls}>Username or Email</label>
              <input
                type="text"
                className={inputCls}
                placeholder="Enter your username or email"
                value={loginData.username}
                onChange={(e) => setLoginData(prev => ({ ...prev, username: e.target.value }))}
                required
              />
            </div>
            <div className={fieldCls}>
              <label className={labelCls}>Password</label>
              <input
                type="password"
                autoComplete="current-password"
                className={inputCls}
                placeholder="Enter your password"
                value={loginData.password}
                onChange={(e) => setLoginData(prev => ({ ...prev, password: e.target.value }))}
                required
              />
            </div>
            <div className="text-right -mt-2">
              <button
                type="button"
                className="bg-none border-none font-dm text-[0.78rem] text-hr-accent-hover cursor-pointer p-0 transition-colors duration-200 hover:text-hr-text"
                onClick={() => setShowForgotPassword(true)}
              >
                Forgot your password?
              </button>
            </div>
            <button type="submit" className={submitCls} disabled={loginMutation.isPending}>
              {loginMutation.isPending ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        {/* Register Form */}
        {activeTab === 'register' && (
          <form onSubmit={handleRegister} className={formCls}>
            <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
              <div className={fieldCls}>
                <label className={labelCls}>First Name</label>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="First name"
                  value={registerData.firstName}
                  onChange={(e) => setRegisterData(prev => ({ ...prev, firstName: e.target.value }))}
                  required
                />
              </div>
              <div className={fieldCls}>
                <label className={labelCls}>Last Name</label>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="Last name"
                  value={registerData.lastName}
                  onChange={(e) => setRegisterData(prev => ({ ...prev, lastName: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className={fieldCls}>
              <label className={labelCls}>Email *</label>
              <input
                type="email"
                className={`${inputCls} ${inviteDetails ? 'opacity-60 cursor-not-allowed' : ''}`}
                placeholder="Enter your email address"
                value={registerData.username}
                onChange={(e) => setRegisterData(prev => ({ ...prev, username: e.target.value }))}
                required
                readOnly={!!inviteDetails}
                title={inviteDetails ? "Email is locked to the invite" : undefined}
              />
              {inviteDetails && (
                <span className="text-[0.7rem] text-hr-text-muted">Email is locked to the invite</span>
              )}
            </div>
            <div className={fieldCls}>
              <label className={labelCls}>Password *</label>
              <input
                type="password"
                autoComplete="new-password"
                className={inputCls}
                placeholder="Create a strong password"
                value={registerData.password}
                onChange={(e) => setRegisterData(prev => ({ ...prev, password: e.target.value }))}
                required
              />
            </div>
            <button type="submit" className={submitCls} disabled={registerMutation.isPending}>
              {registerMutation.isPending ? "Creating account..." : "Create Recruiter Account"}
            </button>
          </form>
        )}
      </>
    );
  };

  return (
    <div className="grid grid-cols-2 min-h-screen bg-hr-bg max-[900px]:grid-cols-1">
      {/* Left Panel — Brand */}
      <div
        className={`relative flex flex-col justify-start items-center pt-[140px] px-[60px] pb-20 bg-hr-bg-card bg-cover bg-center bg-no-repeat border-r ${hrBorder} overflow-hidden before:content-[''] before:absolute before:inset-0 before:bg-[linear-gradient(to_bottom,rgba(12,12,16,0.92)_0%,rgba(12,12,16,0.45)_50%,rgba(12,12,16,0.25)_100%)] before:pointer-events-none max-[900px]:hidden`}
        style={brandBgStyle}
      >
        <div className="relative z-[1] text-center max-w-[400px] animate-hr-fade-up">
          <h1 className="font-satoshi text-[clamp(1.8rem,3vw,2.6rem)] font-normal leading-[1.2] tracking-[-0.01em] text-hr-text mb-4">
            AI-Powered Hiring<br />For Modern Teams
          </h1>

          <p className="font-dm text-[0.92rem] leading-[1.7] text-hr-text-secondary mb-12">
            Post jobs, review applications, and find the perfect candidates — all from one intelligent platform.
          </p>

        </div>
      </div>

      {/* Right Panel — Auth Form */}
      <div className="flex flex-col justify-center items-center py-[60px] px-12 relative max-[900px]:px-6 max-[900px]:pt-[100px] max-[900px]:pb-[60px] max-[900px]:min-h-screen max-sm:px-5 max-sm:pt-[90px] max-sm:pb-10">
        <div
          className="w-full max-w-[400px]"
          style={{ animation: "hr-fade-up 0.7s ease-out 0.12s both" }}
        >
          {renderFormContent()}

          <div className="mt-8 text-center font-dm text-[0.72rem] text-hr-text-muted [&_a]:text-hr-accent-hover [&_a]:no-underline [&_a]:border-b [&_a]:border-[rgba(167,139,250,0.3)] [&_a]:transition-colors [&_a]:duration-200 [&_a:hover]:text-hr-text [&_a:hover]:border-hr-text">
            By continuing, you agree to the <Link href="/terms-of-service">Terms of Service</Link> and <Link href="/privacy-policy">Privacy Policy</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
