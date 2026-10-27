import { useAuth } from "@/hooks/use-auth";
import { useOnboardingStatus } from "@/hooks/use-onboarding-status";
import { useOrganization } from "@/hooks/use-organization";
import { Loader2, ShieldAlert } from "lucide-react";
import { Link, Redirect, Route, useLocation } from "wouter";
import { ComponentType, LazyExoticComponent } from "react";

type LazyComponent = LazyExoticComponent<ComponentType<object>>;

// Paths that don't require onboarding completion for recruiters
const ONBOARDING_EXEMPT_PATHS = [
  '/onboarding',
  '/org/choice',
  '/org/settings',
  '/blocked/',
];

function isOnboardingExempt(path: string): boolean {
  return ONBOARDING_EXEMPT_PATHS.some(exempt => path.startsWith(exempt));
}

// Paths a recruiter should still be able to reach even if their seat was removed.
const SEAT_EXEMPT_PATHS = [
  '/org/settings',
  '/blocked/',
];

function isSeatExempt(path: string): boolean {
  return SEAT_EXEMPT_PATHS.some(exempt => path.startsWith(exempt));
}

export function ProtectedRoute({
  path,
  component: Component,
  requiredRole,
}: {
  path: string;
  component: ComponentType<object> | LazyComponent;
  requiredRole?: string[];
}) {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  // Only check onboarding for recruiters on non-exempt paths
  const shouldCheckOnboarding =
    user?.role === 'recruiter' &&
    !isOnboardingExempt(path);
  const shouldCheckSeat =
    user?.role === 'recruiter' &&
    !isSeatExempt(path);

  // Pass enabled to avoid unnecessary API calls for non-recruiters
  const {
    status: onboardingStatus,
    isLoading: onboardingLoading,
    error: onboardingError,
  } = useOnboardingStatus({ enabled: shouldCheckOnboarding });
  const {
    data: orgData,
    isLoading: organizationLoading,
  } = useOrganization({ enabled: shouldCheckSeat });

  // Combined loading state
  const isFullyLoading =
    isLoading ||
    (shouldCheckOnboarding && onboardingLoading) ||
    (shouldCheckSeat && organizationLoading);

  if (isFullyLoading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }

  if (!user) {
    // Redirect to appropriate auth page based on required role
    const authPath = requiredRole?.includes('candidate') ? '/candidate-auth' : '/recruiter-auth';
    const redirectParam = encodeURIComponent(location);
    return (
      <Route path={path}>
        <Redirect to={`${authPath}?redirect=${redirectParam}`} />
      </Route>
    );
  }

  if (requiredRole && !requiredRole.includes(user.role)) {
    return (
      <Route path={path}>
        {/* Own light surface: this screen renders outside the app shell, over the dark site background. */}
        <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
          <div className="max-w-sm text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <ShieldAlert className="h-6 w-6 text-muted-foreground" aria-hidden />
            </div>
            <h2 className="mb-2 text-2xl font-bold">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to access this page.</p>
            <Link href={homeForRole(user.role)}
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              Go to your dashboard
            </Link>
          </div>
        </div>
      </Route>
    );
  }

  // Recruiters who are still in an org but have lost their seat should be
  // redirected before protected pages load and start firing 403ing queries.
  if (shouldCheckSeat && orgData && !orgData.membership.seatAssigned) {
    return (
      <Route path={path}>
        <Redirect to="/blocked/seat-removed" />
      </Route>
    );
  }

  // Fail-closed: if onboarding check was required but failed/errored, redirect to onboarding
  // The onboarding page will re-check status and redirect if already complete
  if (shouldCheckOnboarding && (onboardingError || !onboardingStatus)) {
    return (
      <Route path={path}>
        <Redirect to="/onboarding" />
      </Route>
    );
  }

  // Onboarding gate for recruiters: redirect to onboarding if needed
  if (shouldCheckOnboarding && onboardingStatus?.needsOnboarding) {
    const step = onboardingStatus.currentStep || 'org';
    return (
      <Route path={path}>
        <Redirect to={`/onboarding?step=${step}`} />
      </Route>
    );
  }

  return <Route path={path}><Component /></Route>;
}

/** Where "Go to your dashboard" leads for each signed-in role. */
export function homeForRole(role: string | null | undefined): string {
  switch (role) {
    case "candidate": return "/my-dashboard";
    case "hiring_manager": return "/hiring-manager";
    case "super_admin": return "/admin";
    case "recruiter": return "/recruiter-dashboard";
    default: return "/";
  }
}
