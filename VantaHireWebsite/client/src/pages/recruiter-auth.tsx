import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, useSearch, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Mail, CheckCircle, UserPlus, ArrowLeft } from "lucide-react";
import type { OnboardingStatus } from "@/hooks/use-onboarding-status";
import { recruiterAuthPageCopy } from "@/lib/internal-copy";
import recruiterAuthBg from "@/assets/recruiter-auth-bg.webp";

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

const shellBorder = "border-white/10";
const shellBorderLight = "border-white/12";

// Shared input classes
const inputCls =
  `bg-white/[0.04] ${shellBorder} border rounded-xl px-3.5 py-2.5 font-ui text-[0.88rem] text-e-text transition-[border-color,box-shadow] duration-200 outline-none w-full box-border placeholder:text-e-text3 placeholder:opacity-70 focus:border-e-blue focus:shadow-[0_0_0_2px_rgba(75,142,240,0.22)]`;

// Shared label classes
const labelCls = "font-ui text-[0.78rem] font-medium text-e-text2 tracking-[0.02em]";

// Shared field classes
const fieldCls = "flex flex-col gap-1.5";

// Submit button
const submitCls =
  "bg-e-blue text-white border-none py-3 px-6 rounded-xl font-ui text-[0.875rem] font-medium cursor-pointer transition-all duration-200 w-full mt-1 hover:brightness-110 hover:shadow-[0_10px_32px_rgba(75,142,240,0.28)] disabled:opacity-60 disabled:cursor-not-allowed";

// Secondary button
const secondaryCls =
  `bg-transparent text-e-text ${shellBorderLight} border py-2.5 px-6 rounded-xl font-ui text-[0.85rem] font-medium cursor-pointer transition-all duration-200 w-full hover:border-white/25 hover:bg-white/[0.03] disabled:opacity-60 disabled:cursor-not-allowed`;

// Ghost button
const ghostCls =
  "bg-transparent text-e-text3 border-none py-2.5 px-6 font-ui text-[0.82rem] font-normal cursor-pointer transition-colors duration-200 w-full hover:text-e-text";

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
          <div className={`${stateIconBaseCls} bg-[rgba(52,209,122,0.12)] text-e-green`}>
            <CheckCircle size={28} />
          </div>
          <div className="font-display text-[1.2rem] font-medium text-e-text">Check Your Email</div>
          <div className="font-ui text-[0.88rem] text-e-text2 leading-[1.6] max-w-[320px]">
            We've sent a verification link to <span className="text-e-text font-medium">{verificationEmail}</span>
          </div>
          <p className="text-[0.82rem] text-e-text3 leading-[1.6]">
            Click the link in the email to verify your account and start using ealana.
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
          <div className={`${stateIconBaseCls} bg-[rgba(245,200,66,0.12)] text-e-amber`}>
            <Mail size={28} />
          </div>
          <div className="font-display text-[1.2rem] font-medium text-e-text">Verify Your Email</div>
          <div className="font-ui text-[0.88rem] text-e-text2 leading-[1.6] max-w-[320px]">
            Check your inbox at <span className="text-e-text font-medium">{verificationEmail}</span> for a verification link.
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
            <div className="w-[30px] h-[30px] rounded-[10px] bg-[rgba(75,142,240,0.12)] text-e-blue flex items-center justify-center shrink-0">
              <Mail size={16} />
            </div>
            <div className="font-display text-[1.1rem] font-medium text-e-text">Reset Password</div>
          </div>
          <div className="text-[0.82rem] text-e-text3 leading-[1.5]">
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
          <div className="flex items-center gap-3 py-3.5 px-[18px] bg-[rgba(75,142,240,0.08)] border border-[rgba(75,142,240,0.16)] rounded-[18px] mb-6 backdrop-blur-xl">
            <div className="w-8 h-8 rounded-[10px] bg-[rgba(75,142,240,0.12)] text-e-blue flex items-center justify-center shrink-0">
              <UserPlus size={16} />
            </div>
            <div className="text-[0.82rem] text-e-text2 leading-[1.4] [&_strong]:text-e-blue [&_strong]:font-medium [&_span]:block [&_span]:text-[0.72rem] [&_span]:text-e-text3 [&_span]:mt-0.5">
              You've been invited to join <strong>{inviteDetails.organizationName}</strong>
              <span>Invited by {inviteDetails.inviterName} as {inviteDetails.role}</span>
            </div>
          </div>
        )}

        {/* Invite Error */}
        {inviteToken && inviteError && (
          <div className="py-3 px-[18px] bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.15)] rounded-[18px] text-[0.82rem] text-red-400 mb-6">
            {(inviteError as Error).message || "Invalid or expired invite link"}
          </div>
        )}

        <div className="text-center mb-7">
          <div className="font-display text-2xl font-medium text-e-text mb-2">
            {inviteDetails ? "Create Your Account" : "Recruiter Access"}
          </div>
          <div className="font-ui text-[0.85rem] text-e-text3 leading-[1.5]">
            {inviteDetails
              ? `Register to join ${inviteDetails.organizationName}`
              : "Sign in to your recruiter account or create a new one"
            }
          </div>
        </div>

        {/* Tab Switcher */}
        <div className={`grid grid-cols-2 bg-white/[0.04] rounded-xl ${shellBorder} border overflow-hidden mb-6`}>
          <button
            className={`py-2.5 font-ui text-[0.82rem] font-medium border-none cursor-pointer text-center transition-colors duration-200 ${activeTab === 'login' ? 'bg-e-blue text-white' : 'bg-transparent text-e-text3 hover:text-e-text2'}`}
            onClick={() => setActiveTab('login')}
          >
            Sign In
          </button>
          <button
            className={`py-2.5 font-ui text-[0.82rem] font-medium border-none cursor-pointer text-center transition-colors duration-200 ${activeTab === 'register' ? 'bg-e-blue text-white' : 'bg-transparent text-e-text3 hover:text-e-text2'}`}
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
                className="bg-none border-none font-ui text-[0.78rem] text-e-blue cursor-pointer p-0 transition-colors duration-200 hover:text-e-text"
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
                <span className="text-[0.7rem] text-e-text3">Email is locked to the invite</span>
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
    <div className="grid grid-cols-2 min-h-screen bg-e-bg text-e-text max-[900px]:grid-cols-1">
      {/* Left Panel — Brand */}
      <div
        className={`relative flex flex-col justify-start items-center pt-[140px] px-[60px] pb-20 bg-cover bg-center bg-no-repeat border-r ${shellBorder} overflow-hidden before:content-[''] before:absolute before:inset-0 before:bg-[linear-gradient(to_bottom,rgba(8,10,20,0.9)_0%,rgba(8,10,20,0.48)_50%,rgba(8,10,20,0.2)_100%)] before:pointer-events-none max-[900px]:hidden`}
        style={brandBgStyle}
      >
        <div className="relative z-[1] text-center max-w-[400px] animate-hr-fade-up">
          <h1 className="font-display text-[clamp(2.1rem,3vw,3rem)] font-medium leading-[1.08] tracking-[-0.03em] text-e-text mb-4">
            Discover talent.<br />Flow with confidence.
          </h1>

          <p className="font-ui text-sm leading-[1.8] text-e-text2 mb-12">
            Post jobs, review applications, and find the right candidates from one neural recruiting system.
          </p>

        </div>
      </div>

      {/* Right Panel — Auth Form */}
      <div className="relative flex flex-col justify-center items-center py-[60px] px-12 max-[900px]:px-6 max-[900px]:pt-[100px] max-[900px]:pb-[60px] max-[900px]:min-h-screen max-sm:px-5 max-sm:pt-[90px] max-sm:pb-10">
        <div
          className="w-full max-w-[420px] rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.03)_100%)] px-7 py-8 shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl max-sm:px-5"
          style={{ animation: "hr-fade-up 0.7s ease-out 0.12s both" }}
        >
          {renderFormContent()}

          <div className="mt-8 text-center font-ui text-[0.72rem] text-e-text3 [&_a]:text-e-blue [&_a]:no-underline [&_a]:border-b [&_a]:border-[rgba(75,142,240,0.28)] [&_a]:transition-colors [&_a]:duration-200 [&_a:hover]:text-e-text [&_a:hover]:border-e-text">
            By continuing, you agree to the <Link href="/terms-of-service">Terms of Service</Link> and <Link href="/privacy-policy">Privacy Policy</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
