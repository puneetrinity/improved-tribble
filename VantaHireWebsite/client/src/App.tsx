import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import UseCasesPage from "@/pages/use-cases-page";
import AboutPage from "@/pages/about-page";
import FeaturesPage from "@/pages/features-page";
import WhatIsDecisionIntelligencePage from "@/pages/what-is-decision-intelligence";
import TalentIntelligenceVsAtsPage from "@/pages/talent-intelligence-vs-ats";
import { CookieConsent, AnalyticsOnConsent } from "@/components/CookieConsent";
import React, { lazy, Suspense, useEffect, useState, useRef } from "react";

const RecruiterAuth = lazy(() => import("@/pages/recruiter-auth"));
const CandidateAuth = lazy(() => import("@/pages/candidate-auth"));
const JobsPage = lazy(() => import("@/pages/jobs-page"));
const JobDetailsPage = lazy(() => import("@/pages/job-details-page"));
const JobPostPage = lazy(() => import("@/pages/job-post-page"));
const AdminSuperDashboard = lazy(() => import("@/pages/admin-super-dashboard"));
const AdminFormsPage = lazy(() => import("@/pages/admin-forms-page"));
const AdminEmailTemplatesPage = lazy(() => import("@/pages/admin-email-templates-page"));
const FormEditorPage = lazy(() => import("@/pages/form-editor-page"));
const AdminFormResponsesPage = lazy(() => import("@/pages/admin-form-responses-page"));
const AdminConsultantsPage = lazy(() => import("@/pages/admin-consultants-page"));
const AdminAIUsagePage = lazy(() => import("@/pages/admin-ai-usage-page"));
const AdminAIJobsPage = lazy(() => import("@/pages/admin-ai-jobs-page"));
const AdminFeedbackPage = lazy(() => import("@/pages/admin-feedback-page"));
const AdminDomainClaimsPage = lazy(() => import("@/pages/admin-domain-claims-page"));
const AdminOrganizationsPage = lazy(() => import("@/pages/admin-organizations-page"));
const AdminOrganizationDetailPage = lazy(() => import("@/pages/admin-organization-detail-page"));
const AdminFeaturesPage = lazy(() => import("@/pages/admin-features-page"));
const AdminOrgControlsPage = lazy(() => import("@/pages/admin-org-controls-page"));
const AdminSubscriptionsPage = lazy(() => import("@/pages/admin-subscriptions-page"));
const ApplicationManagementPage = lazy(() => import("@/pages/application-management-page"));
const JobEditPage = lazy(() => import("@/pages/job-edit-page"));
const JobPipelinePage = lazy(() => import("@/pages/job-pipeline-page"));
const JobAnalyticsPage = lazy(() => import("@/pages/job-analytics-page"));
const JobSourcingPage = lazy(() => import("@/pages/job-sourcing-page"));
const BulkResumeImportPage = lazy(() => import("@/pages/bulk-resume-import-page"));
const CandidateDashboard = lazy(() => import("@/pages/candidate-dashboard"));
const JobAnalyticsDashboard = lazy(() => import("@/pages/job-analytics-dashboard"));
const RecruiterDashboard = lazy(() => import("@/pages/recruiter-dashboard"));
const HiringManagerDashboard = lazy(() => import("@/pages/hiring-manager-dashboard"));
const HiringManagerReviewPage = lazy(() => import("@/pages/hiring-manager-review-page"));
const ApplicationsPage = lazy(() => import("@/pages/applications-page"));
const MyJobsPage = lazy(() => import("@/pages/my-jobs-page"));
const CandidatesPage = lazy(() => import("@/pages/candidates-page"));
const ClientsPage = lazy(() => import("@/pages/clients-page"));
const ClientShortlistPage = lazy(() => import("@/pages/client-shortlist-page"));
const PublicFormPage = lazy(() => import("@/pages/public-form-page"));
const PrivacyPolicyPage = lazy(() => import("@/pages/privacy-policy-page"));
const TermsOfServicePage = lazy(() => import("@/pages/terms-of-service-page"));
const CookiePolicyPage = lazy(() => import("@/pages/cookie-policy-page"));
const VerifyEmailPage = lazy(() => import("@/pages/verify-email-page"));
const ResetPasswordPage = lazy(() => import("@/pages/reset-password-page"));
const ProfileSettingsPage = lazy(() => import("@/pages/profile-settings-page"));
const RecruiterProfilePage = lazy(() => import("@/pages/recruiter-profile-page"));
const RecruitersDirectoryPage = lazy(() => import("@/pages/recruiters-directory-page"));
const RegisterHiringManager = lazy(() => import("@/pages/register-hiring-manager"));
const AcceptCoRecruiter = lazy(() => import("@/pages/accept-co-recruiter"));
const RegisterCoRecruiter = lazy(() => import("@/pages/register-co-recruiter"));

// Organization pages
const OrgChoicePage = lazy(() => import("@/pages/org-choice-page"));
const OrgSettingsPage = lazy(() => import("@/pages/org-settings-page"));
const OrgTeamPage = lazy(() => import("@/pages/org-team-page"));
const OrgBillingPage = lazy(() => import("@/pages/org-billing-page"));
const OrgDomainRequestPage = lazy(() => import("@/pages/org-domain-request-page"));
const OrgAnalyticsPage = lazy(() => import("@/pages/org-analytics-page"));
const SeatRemovedPage = lazy(() => import("@/pages/seat-removed-page"));

// Onboarding
const OnboardingPage = lazy(() => import("@/pages/onboarding-page"));

// Marketing pages
const PricingPage = lazy(() => import("@/pages/pricing-page"));
const ClaimPage = lazy(() => import("@/pages/claim-page"));

// Dev-only UI gallery (lazy loaded, tree-shaken in production)
const DevUIGallery = import.meta.env.DEV
  ? lazy(() => import("@/pages/dev-ui-gallery"))
  : null;
const TourProvider = lazy(() => import("@/components/TourProvider").then(m => ({ default: m.TourProvider })));
const TourLauncher = lazy(() => import("@/components/TourLauncher").then(m => ({ default: m.TourLauncher })));

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/features" component={FeaturesPage} />
      <Route path="/pricing" component={PricingPage} />
      <Route path="/claim/:token" component={ClaimPage} />
      <Route path="/solutions" component={UseCasesPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/what-is-decision-intelligence" component={WhatIsDecisionIntelligencePage} />
      <Route path="/talent-intelligence-vs-ats" component={TalentIntelligenceVsAtsPage} />
      <Route path="/recruiter-auth" component={RecruiterAuth} />
      <Route path="/candidate-auth" component={CandidateAuth} />
      <ProtectedRoute path="/onboarding" component={OnboardingPage} requiredRole={['recruiter']} />
      <Route path="/form/:token" component={PublicFormPage} />
      <Route path="/client-shortlist/:token" component={ClientShortlistPage} />
      <Route path="/privacy-policy" component={PrivacyPolicyPage} />
      <Route path="/terms-of-service" component={TermsOfServicePage} />
      <Route path="/cookie-policy" component={CookiePolicyPage} />
      <Route path="/verify-email/:token" component={VerifyEmailPage} />
      <Route path="/reset-password/:token" component={ResetPasswordPage} />
      <Route path="/register-hiring-manager/:token" component={RegisterHiringManager} />
      <Route path="/accept-co-recruiter/:token" component={AcceptCoRecruiter} />
      <Route path="/register-co-recruiter/:token" component={RegisterCoRecruiter} />
      <Route path="/recruiters" component={RecruitersDirectoryPage} />
      <Route path="/recruiters/:id" component={RecruiterProfilePage} />
      <Route path="/jobs" component={JobsPage} />
      <ProtectedRoute path="/jobs/post" component={JobPostPage} requiredRole={['recruiter', 'super_admin']} />
      <ProtectedRoute path="/jobs/:id/applications" component={ApplicationManagementPage} requiredRole={['recruiter', 'super_admin']} />
      <ProtectedRoute path="/jobs/:id/edit" component={JobEditPage} requiredRole={['recruiter', 'super_admin']} />
      <ProtectedRoute path="/jobs/:id/pipeline" component={JobPipelinePage} requiredRole={['recruiter', 'super_admin']} />
      <ProtectedRoute path="/jobs/:id/analytics" component={JobAnalyticsPage} requiredRole={['recruiter', 'super_admin']} />
      <ProtectedRoute path="/jobs/:id/sourcing" component={JobSourcingPage} requiredRole={['recruiter', 'super_admin']} />
      <ProtectedRoute path="/jobs/:id/bulk-import" component={BulkResumeImportPage} requiredRole={['recruiter', 'super_admin']} />
      <Route path="/jobs/:id" component={JobDetailsPage} />
      <ProtectedRoute path="/my-dashboard" component={CandidateDashboard} requiredRole={['candidate']} />
      <ProtectedRoute path="/recruiter-dashboard" component={RecruiterDashboard} requiredRole={['recruiter', 'super_admin']} />
      <ProtectedRoute path="/hiring-manager/jobs/:id/review" component={HiringManagerReviewPage} requiredRole={['hiring_manager']} />
      <ProtectedRoute path="/hiring-manager" component={HiringManagerDashboard} requiredRole={['hiring_manager']} />
      <ProtectedRoute path="/applications" component={ApplicationsPage} requiredRole={['recruiter', 'super_admin']} />
      <ProtectedRoute path="/candidates" component={CandidatesPage} requiredRole={['recruiter', 'super_admin']} />
      <ProtectedRoute path="/my-jobs" component={MyJobsPage} requiredRole={['recruiter', 'super_admin']} />
      <ProtectedRoute path="/clients" component={ClientsPage} requiredRole={['recruiter', 'super_admin']} />
      <ProtectedRoute path="/profile/settings" component={ProfileSettingsPage} requiredRole={['recruiter', 'super_admin', 'hiring_manager']} />
      <ProtectedRoute path="/admin" component={AdminSuperDashboard} requiredRole={['super_admin']} />
      <Route path="/admin/legacy">{() => <Redirect to="/admin" />}</Route>
      <Route path="/admin/super">{() => <Redirect to="/admin" />}</Route>
      <Route path="/admin/dashboard">{() => <Redirect to="/admin" />}</Route>
      <ProtectedRoute path="/admin/forms/editor/:id?" component={FormEditorPage} requiredRole={['super_admin', 'recruiter']} />
      <ProtectedRoute path="/admin/forms/responses" component={AdminFormResponsesPage} requiredRole={['super_admin']} />
      <ProtectedRoute path="/admin/forms" component={AdminFormsPage} requiredRole={['super_admin', 'recruiter']} />
      <ProtectedRoute path="/admin/email-templates" component={AdminEmailTemplatesPage} requiredRole={['super_admin', 'recruiter']} />
      <ProtectedRoute path="/admin/consultants" component={AdminConsultantsPage} requiredRole={['super_admin']} />
      <ProtectedRoute path="/admin/ai-usage" component={AdminAIUsagePage} requiredRole={['super_admin']} />
      <ProtectedRoute path="/admin/ai-jobs" component={AdminAIJobsPage} requiredRole={['super_admin']} />
      <ProtectedRoute path="/admin/feedback" component={AdminFeedbackPage} requiredRole={['super_admin']} />
      <ProtectedRoute path="/admin/domain-claims" component={AdminDomainClaimsPage} requiredRole={['super_admin']} />
      <ProtectedRoute path="/admin/organizations/:id" component={AdminOrganizationDetailPage} requiredRole={['super_admin']} />
      <ProtectedRoute path="/admin/organizations" component={AdminOrganizationsPage} requiredRole={['super_admin']} />
      <ProtectedRoute path="/admin/subscriptions" component={AdminSubscriptionsPage} requiredRole={['super_admin']} />
      <ProtectedRoute path="/admin/org-controls" component={AdminOrgControlsPage} requiredRole={['super_admin']} />
      <Route path="/admin/features">{() => <Redirect to="/admin/org-controls" />}</Route>
      <ProtectedRoute path="/analytics" component={JobAnalyticsDashboard} requiredRole={['recruiter', 'super_admin']} />
      {/* Organization management routes */}
      <ProtectedRoute path="/org/choice" component={OrgChoicePage} requiredRole={['recruiter']} />
      <ProtectedRoute path="/org/settings" component={OrgSettingsPage} requiredRole={['recruiter']} />
      <ProtectedRoute path="/org/team" component={OrgTeamPage} requiredRole={['recruiter']} />
      <ProtectedRoute path="/org/billing" component={OrgBillingPage} requiredRole={['recruiter']} />
      <ProtectedRoute path="/org/domain" component={OrgDomainRequestPage} requiredRole={['recruiter']} />
      <ProtectedRoute path="/org/analytics" component={OrgAnalyticsPage} requiredRole={['recruiter']} />
      <ProtectedRoute path="/blocked/seat-removed" component={SeatRemovedPage} requiredRole={['recruiter']} />
      {/* Dev-only UI gallery route */}
      {DevUIGallery && (
        <Route path="/dev/ui-gallery">
          {() => (
            <Suspense fallback={<div className="p-8 text-center">Loading UI Gallery...</div>}>
              <DevUIGallery />
            </Suspense>
          )}
        </Route>
      )}
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function NavProgressBar() {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    // Quickly animate 0 → 85%, then on unmount the parent removes it (meaning page is ready)
    const t1 = window.setTimeout(() => setWidth(40), 10);
    const t2 = window.setTimeout(() => setWidth(72), 120);
    const t3 = window.setTimeout(() => setWidth(85), 260);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, []);

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] pointer-events-none">
      <div
        className="h-full bg-[linear-gradient(90deg,#4B8EF0_0%,#34D17A_100%)] transition-all duration-200 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function MinimalPageFallback() {
  return (
    <div className="fixed inset-0 bg-[#080A14] flex items-center justify-center">
      <div className="w-5 h-5 rounded-full border-2 border-white/10 border-t-[#4B8EF0] animate-spin" />
    </div>
  );
}

function RouteScopedBoundary() {
  const [location] = useLocation();
  const isFirstRender = useRef(true);
  const [showBar, setShowBar] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    setShowBar(true);
    const id = window.setTimeout(() => setShowBar(false), 500);
    return () => window.clearTimeout(id);
  }, [location]);

  return (
    <ErrorBoundary key={location}>
      {showBar && <NavProgressBar />}
      <Suspense fallback={<MinimalPageFallback />}>
        <Router />
      </Suspense>
    </ErrorBoundary>
  );
}

/** Wraps children in TourProvider only when user is authenticated */
function AuthenticatedTours({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <>{children}</>;
  return (
    <Suspense fallback={<>{children}</>}>
      <TourProvider>
        {children}
        <TourLauncher />
      </TourProvider>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <AuthenticatedTours>
            <Toaster />
            {/* Inject analytics only after consent */}
            <AnalyticsOnConsent />
            <CookieConsent />
            <RouteScopedBoundary />
          </AuthenticatedTours>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
