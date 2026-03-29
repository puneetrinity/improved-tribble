import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useOnboardingStatus } from "@/hooks/use-onboarding-status";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import Layout from "@/components/Layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import OrgSetupStep from "@/components/onboarding/OrgSetupStep";
import ProfileStep from "@/components/onboarding/ProfileStep";
import PlanSelectionStep from "@/components/onboarding/PlanSelectionStep";
import { onboardingPageCopy } from "@/lib/internal-copy";
import { captureFrontendException, shouldCaptureClientError } from "@/lib/monitoring";

type OnboardingStep = 'org' | 'profile' | 'plan';

const STEP_ORDER: OnboardingStep[] = ['org', 'profile', 'plan'];
const STEP_LABELS: Record<OnboardingStep, string> = {
  org: onboardingPageCopy.steps.org,
  profile: onboardingPageCopy.steps.profile,
  plan: onboardingPageCopy.steps.plan,
};

export default function OnboardingPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { status, isLoading: statusLoading, error: statusError, refetch } = useOnboardingStatus();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  // Parse step from URL query params
  const urlParams = new URLSearchParams(searchString);
  const urlStep = urlParams.get('step') as OnboardingStep | null;

  // Local state for current step (allows manual navigation)
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('org');
  const [creditsToastShown, setCreditsToastShown] = useState(false);
  const [stepCompletionError, setStepCompletionError] = useState<string | null>(null);
  const [isStepStatusRetrying, setIsStepStatusRetrying] = useState(false);

  // Initialize step from server status (URL step is ignored to prevent bypass)
  useEffect(() => {
    if (status) {
      if (status.currentStep === 'complete') {
        // Already completed, redirect to dashboard
        setLocation('/recruiter-dashboard');
        return;
      }
      // Always use server-determined step - don't allow URL parameter to skip ahead
      // The server knows the actual state (has org? has profile?) and determines the correct step
      const serverStep = status.currentStep as OnboardingStep;
      setCurrentStep(serverStep);

      // Update URL to match server step if it differs (prevents confusion)
      if (urlStep && urlStep !== serverStep) {
        const params = new URLSearchParams();
        params.set('step', serverStep);
        setLocation(`/onboarding?${params.toString()}`, { replace: true });
      }
    }
  }, [status, urlStep, setLocation]);

  useEffect(() => {
    if (status?.creditsLazyInit && !creditsToastShown) {
      toast({
        title: onboardingPageCopy.toasts.creditsTitle,
        description: onboardingPageCopy.toasts.creditsDescription,
      });
      setCreditsToastShown(true);
    }
  }, [status?.creditsLazyInit, creditsToastShown, toast]);

  // Redirect if not logged in or not a recruiter
  useEffect(() => {
    if (!authLoading && !user) {
      setLocation('/recruiter-auth');
      return;
    }
    if (!authLoading && user && user.role !== 'recruiter') {
      // Non-recruiters shouldn't be here
      if (user.role === 'super_admin') {
        setLocation('/admin');
      } else if (user.role === 'candidate') {
        setLocation('/my-dashboard');
      } else {
        setLocation('/');
      }
    }
  }, [user, authLoading, setLocation]);

  // Handle step advancement
  const handleStepComplete = async (step: OnboardingStep) => {
    setStepCompletionError(null);
    setIsStepStatusRetrying(true);
    try {
      const result = await refetch();
      if (result.isError) {
        if (result.error && shouldCaptureClientError(result.error)) {
          captureFrontendException(result.error, {
            area: "onboarding",
            action: "step-complete-refetch",
            extra: {
              step,
              currentStep,
            },
          });
        }
        setStepCompletionError(onboardingPageCopy.error.description);
        return;
      }
      const nextStatus = result.data;

      if (nextStatus && nextStatus.needsOnboarding === false) {
        setLocation('/recruiter-dashboard');
        return;
      }

      if (nextStatus?.currentStep && nextStatus.currentStep !== 'complete') {
        const nextStep = nextStatus.currentStep as OnboardingStep;
        setCurrentStep(nextStep);
        // Update URL to match current step.
        const params = new URLSearchParams();
        params.set('step', nextStep);
        setLocation(`/onboarding?${params.toString()}`, { replace: true });
        return;
      }
      setStepCompletionError(onboardingPageCopy.error.description);
      return;
    } catch (error) {
      if (shouldCaptureClientError(error)) {
        captureFrontendException(error, {
          area: "onboarding",
          action: "step-complete-refetch",
          extra: {
            step,
            currentStep,
          },
        });
      }
      setStepCompletionError(onboardingPageCopy.error.description);
      return;
    } finally {
      setIsStepStatusRetrying(false);
    }
  };

  // Handle completion from plan step
  const handleOnboardingComplete = () => {
    setLocation('/recruiter-dashboard');
  };

  // Loading state
  if (authLoading || statusLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  // Error state - show error with retry option
  if (statusError && user?.role === 'recruiter' && !status) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center max-w-md mx-auto px-4">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">
              {onboardingPageCopy.error.title}
            </h2>
            <p className="text-muted-foreground mb-6">
              {onboardingPageCopy.error.description}
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {onboardingPageCopy.error.retry}
              </Button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // If not a recruiter or no onboarding needed, redirect handled in useEffect
  if (!user || user.role !== 'recruiter' || !status?.needsOnboarding) {
    return null;
  }

  const stepIndex = STEP_ORDER.indexOf(currentStep);
  const progressPercent = ((stepIndex + 1) / STEP_ORDER.length) * 100;

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
              {onboardingPageCopy.header.title}
            </h1>
            <p className="text-muted-foreground">
              {onboardingPageCopy.header.subtitle}
            </p>
          </div>

          {/* Progress */}
          <div className="mb-8">
            <div className="flex justify-between mb-2">
              {STEP_ORDER.map((step, index) => (
                <div
                  key={step}
                  className={`text-sm font-medium ${
                    index <= stepIndex ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {STEP_LABELS[step]}
                </div>
              ))}
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>

          {/* Step Content */}
          <div className="bg-card rounded-xl border border-border p-6 md:p-8">
            {stepCompletionError && (
              <Alert className="mb-6 border-destructive/30 bg-destructive/5">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{onboardingPageCopy.error.title}</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{stepCompletionError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStepComplete(currentStep)}
                    disabled={isStepStatusRetrying}
                  >
                    {isStepStatusRetrying ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {onboardingPageCopy.error.retry}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        {onboardingPageCopy.error.retry}
                      </>
                    )}
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {currentStep === 'org' && (
              <OrgSetupStep
                onComplete={() => handleStepComplete('org')}
                userEmail={user.username}
              />
            )}
            {currentStep === 'profile' && (
              <ProfileStep
                onComplete={() => handleStepComplete('profile')}
              />
            )}
            {currentStep === 'plan' && (
              <PlanSelectionStep
                onComplete={handleOnboardingComplete}
              />
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
