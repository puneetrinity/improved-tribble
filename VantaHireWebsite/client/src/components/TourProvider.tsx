import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import Joyride, { CallBackProps, STATUS, EVENTS, ACTIONS, Step } from "react-joyride";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import {
  TourStep,
  TourConfig,
  UserRole,
  getFullTour,
  getTourById,
  getAvailableTours,
  TOUR_STORAGE_KEYS,
} from "@/lib/tour-config";

interface TourContextType {
  isRunning: boolean;
  currentTourId: string | null;
  completedTours: string[];
  startTour: (tourId?: string) => void;
  stopTour: () => void;
  resetTours: () => void;
  availableTours: TourConfig[];
  hasSeenFirstVisitTour: boolean;
  dismissFirstVisitTour: () => void;
}

const TourContext = createContext<TourContextType | null>(null);

export function useTour() {
  const context = useContext(TourContext);
  if (!context) {
    // Return a safe default instead of throwing during error boundary recovery
    return {
      isRunning: false,
      currentTourId: null,
      completedTours: [],
      startTour: () => {},
      stopTour: () => {},
      resetTours: () => {},
      availableTours: [],
      hasSeenFirstVisitTour: true,
      dismissFirstVisitTour: () => {},
    };
  }
  return context;
}

interface TourProviderProps {
  children: ReactNode;
}

export function TourProvider({ children }: TourProviderProps) {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const userRole = user?.role as UserRole | undefined;

  const [isRunning, setIsRunning] = useState(false);
  const [currentTourId, setCurrentTourId] = useState<string | null>(null);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [completedTours, setCompletedTours] = useState<string[]>([]);
  const [hasSeenFirstVisitTour, setHasSeenFirstVisitTour] = useState(true);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);

  // Load completed tours from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(TOUR_STORAGE_KEYS.COMPLETED_TOURS);
    if (stored) {
      try {
        setCompletedTours(JSON.parse(stored));
      } catch {
        setCompletedTours([]);
      }
    }

    // Check first visit. Super admins are internal operators, so they do not
    // receive product tours.
    const firstVisit = localStorage.getItem(TOUR_STORAGE_KEYS.FIRST_VISIT);
    if (!firstVisit && user && user.role !== "super_admin") {
      setHasSeenFirstVisitTour(false);
    }
  }, [user]);

  // Handle route changes for tour navigation
  useEffect(() => {
    if (pendingRoute && location === pendingRoute) {
      setPendingRoute(null);
      // Small delay to ensure DOM is ready after route change
      const timer = setTimeout(() => {
        setIsRunning(true);
      }, 500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [location, pendingRoute]);

  const availableTours = getAvailableTours(userRole);

  const startTour = useCallback(
    (tourId?: string) => {
      // Guard: Don't start tour if user is not authenticated
      if (!user) {
        console.warn("Cannot start tour: user not authenticated");
        return;
      }

      let tourSteps: TourStep[];

      if (tourId) {
        tourSteps = getTourById(tourId, userRole);
        setCurrentTourId(tourId);
      } else {
        tourSteps = getFullTour(userRole);
        setCurrentTourId("full-tour");
      }

      if (tourSteps.length === 0) {
        console.warn("No tour steps available for current user role");
        return;
      }

      setSteps(tourSteps);
      setStepIndex(0);

      // Check if first step requires route navigation
      const firstStep = tourSteps[0];
      if (firstStep && firstStep.route && location !== firstStep.route) {
        setPendingRoute(firstStep.route);
        setLocation(firstStep.route);
      } else {
        setIsRunning(true);
      }
    },
    [user, userRole, location, setLocation]
  );

  const stopTour = useCallback(() => {
    setIsRunning(false);
    setCurrentTourId(null);
    setStepIndex(0);
    setPendingRoute(null);
  }, []);

  const resetTours = useCallback(() => {
    localStorage.removeItem(TOUR_STORAGE_KEYS.COMPLETED_TOURS);
    localStorage.removeItem(TOUR_STORAGE_KEYS.FIRST_VISIT);
    setCompletedTours([]);
    setHasSeenFirstVisitTour(false);
  }, []);

  const dismissFirstVisitTour = useCallback(() => {
    localStorage.setItem(TOUR_STORAGE_KEYS.FIRST_VISIT, "true");
    setHasSeenFirstVisitTour(true);
  }, []);

  const markTourCompleted = useCallback((tourId: string) => {
    setCompletedTours((prev) => {
      const updated = [...new Set([...prev, tourId])];
      localStorage.setItem(TOUR_STORAGE_KEYS.COMPLETED_TOURS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleJoyrideCallback = useCallback(
    (data: CallBackProps) => {
      const { status, type, action, index } = data;

      // Handle tour completion
      if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
        if (currentTourId) {
          markTourCompleted(currentTourId);
        }
        stopTour();
        return;
      }

      // Handle TARGET_NOT_FOUND - skip to next step gracefully
      if (type === EVENTS.TARGET_NOT_FOUND) {
        console.warn(`Tour target not found for step ${index}, skipping...`);
        const nextIndex = index + 1;
        if (nextIndex < steps.length) {
          const nextStep = steps[nextIndex];
          // Check if we need to navigate to a different route
          if (nextStep && nextStep.route && location !== nextStep.route) {
            setIsRunning(false);
            setPendingRoute(nextStep.route);
            setStepIndex(nextIndex);
            setLocation(nextStep.route);
          } else {
            setStepIndex(nextIndex);
          }
        } else {
          // No more steps, finish tour
          if (currentTourId) {
            markTourCompleted(currentTourId);
          }
          stopTour();
        }
        return;
      }

      // Handle step changes
      if (type === EVENTS.STEP_AFTER) {
        const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1);

        if (nextIndex >= 0 && nextIndex < steps.length) {
          const nextStep = steps[nextIndex];

          // Check if we need to navigate to a different route
          if (nextStep && nextStep.route && location !== nextStep.route) {
            setIsRunning(false);
            setPendingRoute(nextStep.route);
            setStepIndex(nextIndex);
            setLocation(nextStep.route);
          } else {
            setStepIndex(nextIndex);
          }
        }
      }

      // Handle close/skip actions
      if (action === ACTIONS.CLOSE) {
        stopTour();
      }
    },
    [currentTourId, steps, location, setLocation, markTourCompleted, stopTour]
  );

  // Custom tooltip styles matching VantaHire theme
  const joyrideStyles = {
    options: {
      arrowColor: "#1e1e2e",
      backgroundColor: "#1e1e2e",
      overlayColor: "rgba(0, 0, 0, 0.7)",
      primaryColor: "#7B38FB",
      spotlightShadow: "0 0 30px rgba(123, 56, 251, 0.5)",
      textColor: "#fff",
      zIndex: 10000,
    },
    tooltip: {
      borderRadius: 12,
      padding: 20,
    },
    tooltipContainer: {
      textAlign: "left" as const,
    },
    tooltipTitle: {
      fontSize: 18,
      fontWeight: 600,
      marginBottom: 8,
    },
    tooltipContent: {
      fontSize: 14,
      lineHeight: 1.6,
    },
    buttonNext: {
      backgroundColor: "#7B38FB",
      borderRadius: 8,
      fontSize: 14,
      padding: "10px 20px",
    },
    buttonBack: {
      color: "#9ca3af",
      fontSize: 14,
    },
    buttonSkip: {
      color: "#9ca3af",
      fontSize: 14,
    },
    buttonClose: {
      color: "#9ca3af",
    },
    spotlight: {
      borderRadius: 8,
    },
  };

  return (
    <TourContext.Provider
      value={{
        isRunning,
        currentTourId,
        completedTours,
        startTour,
        stopTour,
        resetTours,
        availableTours,
        hasSeenFirstVisitTour,
        dismissFirstVisitTour,
      }}
    >
      {children}
      <Joyride
        steps={steps as Step[]}
        stepIndex={stepIndex}
        run={isRunning}
        continuous
        showProgress
        showSkipButton
        scrollToFirstStep
        spotlightClicks
        disableOverlayClose
        callback={handleJoyrideCallback}
        styles={joyrideStyles}
        locale={{
          back: "Back",
          close: "Close",
          last: "Finish",
          next: "Next",
          skip: "Skip tour",
        }}
        floaterProps={{
          styles: {
            floater: {
              filter: "drop-shadow(0 4px 20px rgba(123, 56, 251, 0.3))",
            },
          },
        }}
      />
    </TourContext.Provider>
  );
}
