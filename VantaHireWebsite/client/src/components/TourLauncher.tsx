import { useState, useEffect } from "react";
import { HelpCircle, Play, RefreshCw, Check, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useTour } from "@/components/TourProvider";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export function TourLauncher() {
  const { user } = useAuth();
  const {
    isRunning,
    startTour,
    stopTour,
    resetTours,
    availableTours,
    completedTours,
    hasSeenFirstVisitTour,
    dismissFirstVisitTour,
  } = useTour();

  const [showWelcomePrompt, setShowWelcomePrompt] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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
    setIsMenuOpen(false);
    setTimeout(() => {
      startTour();
    }, 100);
  };

  const handleDismissWelcome = () => {
    setShowWelcomePrompt(false);
    dismissFirstVisitTour();
  };

  const handleStartSpecificTour = (tourId: string) => {
    // Close menu first, then start tour after a brief delay
    // This prevents the dropdown from interfering with the tour
    setIsMenuOpen(false);
    setTimeout(() => {
      startTour(tourId);
    }, 100);
  };

  const completedCount = completedTours.length;
  const totalTours = availableTours.length;

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
          <div className="bg-[#1e1e2e] border border-primary/30 rounded-xl shadow-2xl shadow-purple-500/20 p-5 max-w-sm">
            <button
              onClick={handleDismissWelcome}
              className="absolute top-3 right-3 text-muted-foreground hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-white font-semibold text-base mb-1">
                  Welcome to VantaHire!
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
          <div className="absolute -bottom-2 right-8 w-4 h-4 bg-[#1e1e2e] border-r border-b border-primary/30 transform rotate-45" />
        </div>
      )}

      {/* Persistent Guide Button */}
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            className={cn(
              "fixed bottom-6 right-6 z-[9998] rounded-full px-4 h-11 shadow-lg transition-all duration-300",
              "bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600",
              "border border-primary/30 hover:border-primary/50",
              "hover:scale-105 hover:shadow-purple-500/30 hover:shadow-xl",
              "flex items-center gap-2"
            )}
            aria-label="Open help guide"
          >
            <HelpCircle className="h-4 w-4 text-white" />
            <span className="text-white text-sm font-medium">Help</span>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          alignOffset={-8}
          sideOffset={12}
          className="w-72 bg-[#1e1e2e] border-primary/30 text-white"
        >
          <DropdownMenuLabel className="flex items-center justify-between py-3 px-4">
            <span className="text-base font-semibold">Help & Tours</span>
            <span className="text-xs text-muted-foreground">
              {completedCount}/{totalTours} completed
            </span>
          </DropdownMenuLabel>

          <DropdownMenuSeparator className="bg-primary/20" />

          {/* Recommended Tour Option */}
          <DropdownMenuItem
            onClick={handleStartFullTour}
            className="py-3 px-4 cursor-pointer hover:bg-primary/20 focus:bg-primary/20"
          >
            <div className="flex items-center gap-3 w-full">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                <Play className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">Recommended Start</div>
                <div className="text-xs text-muted-foreground">
                  Short guided path for your role
                </div>
              </div>
            </div>
          </DropdownMenuItem>

          <DropdownMenuSeparator className="bg-primary/20" />

          <DropdownMenuLabel className="py-2 px-4 text-xs text-muted-foreground uppercase tracking-wide">
            Page Guides
          </DropdownMenuLabel>

          {/* Individual Tour Options */}
          {availableTours.map((tour) => {
            const isCompleted = completedTours.includes(tour.id);
            return (
              <DropdownMenuItem
                key={tour.id}
                onClick={() => handleStartSpecificTour(tour.id)}
                className="py-2.5 px-4 cursor-pointer hover:bg-primary/20 focus:bg-primary/20"
              >
                <div className="flex items-center gap-3 w-full">
                  <div
                    className={cn(
                      "w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0",
                      isCompleted
                        ? "bg-success/20 text-success"
                        : "bg-primary/20 text-primary"
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{tour.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {tour.description}
                    </div>
                  </div>
                </div>
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator className="bg-primary/20" />

          {/* Reset Tours Option */}
          <DropdownMenuItem
            onClick={resetTours}
            className="py-2.5 px-4 cursor-pointer hover:bg-primary/20 focus:bg-primary/20 text-muted-foreground"
          >
            <div className="flex items-center gap-3">
              <RefreshCw className="h-4 w-4" />
              <span className="text-sm">Reset Guides</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
