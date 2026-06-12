import { useState, useEffect } from "react";
import { Play, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTour } from "@/components/TourProvider";
import { useAuth } from "@/hooks/use-auth";

export function TourLauncher() {
  const { user } = useAuth();
  const {
    isRunning,
    startTour,
    availableTours,
    hasSeenFirstVisitTour,
    dismissFirstVisitTour,
  } = useTour();

  const [showWelcomePrompt, setShowWelcomePrompt] = useState(false);

  // Show welcome prompt for first-time users
  useEffect(() => {
    if (!hasSeenFirstVisitTour) {
      const timer = setTimeout(() => {
        setShowWelcomePrompt(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [hasSeenFirstVisitTour]);

  const handleStartFullTour = () => {
    setShowWelcomePrompt(false);
    dismissFirstVisitTour();
    setTimeout(() => {
      startTour();
    }, 100);
  };

  const handleDismissWelcome = () => {
    setShowWelcomePrompt(false);
    dismissFirstVisitTour();
  };

  // Super admins are internal operators; keep product tours focused on end users.
  if (!user || user.role === "super_admin") {
    return null;
  }

  // Hide launcher when tour is running
  if (isRunning) {
    return null;
  }

  // Don't show if no tours available for this role
  if (availableTours.length === 0) {
    return null;
  }

  return (
    <>
      {/* Welcome Prompt for First-Time Users */}
      {showWelcomePrompt && (
        <div className="fixed bottom-20 right-6 z-[9999] animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div className="rounded-xl border border-[rgba(75,142,240,0.24)] bg-[#111326] p-5 shadow-2xl shadow-[rgba(75,142,240,0.18)] max-w-sm">
            <button
              onClick={handleDismissWelcome}
              className="absolute top-3 right-3 text-muted-foreground hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#4B8EF0_0%,#34D17A_100%)]">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-white font-semibold text-base mb-1">
                  Welcome to ealana!
                </h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Take a short guided setup tour focused on the actions you will use first.
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={handleStartFullTour}
                    size="sm"
                    className="bg-primary hover:bg-primary/80 text-white"
                  >
                    <Play className="h-3 w-3 mr-1.5" />
                    Start Tour
                  </Button>
                  <Button
                    onClick={handleDismissWelcome}
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-white hover:bg-white/10"
                  >
                    Maybe Later
                  </Button>
                </div>
              </div>
            </div>
          </div>
          {/* Arrow pointer */}
          <div className="absolute -bottom-2 right-8 h-4 w-4 rotate-45 border-b border-r border-[rgba(75,142,240,0.24)] bg-[#111326]" />
        </div>
      )}

    </>
  );
}
