import { useAuth } from "@/hooks/use-auth";
import { useOnboardingStatus } from "@/hooks/use-onboarding-status";
import { useOrganization } from "@/hooks/use-organization";
import { Loader2 } from "lucide-react";
import { Redirect, Route, useLocation } from "wouter";
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
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to access this page.</p>
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
