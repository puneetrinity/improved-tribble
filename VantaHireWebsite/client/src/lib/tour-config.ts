import { Step } from "react-joyride";

export type UserRole = "super_admin" | "recruiter" | "candidate" | "hiring_manager";

export interface TourStep extends Step {
  route?: string;
  roles?: UserRole[];
  tourId?: string;
}

export interface TourConfig {
  id: string;
  title: string;
  description: string;
  roles?: UserRole[];
  contextual?: boolean;
  steps: TourStep[];
}

export const tourConfigs: TourConfig[] = [
  {
    id: "recruiter-quick-start",
    title: "Recruiter Quick Start",
    description: "Post jobs, review candidates, and invite collaborators",
    roles: ["recruiter"],
    steps: [
      {
        target: '[data-tour="dashboard-metrics"]',
        content:
          "Start here for a quick view of open jobs, candidates needing attention, and recent pipeline movement.",
        disableBeacon: true,
        route: "/recruiter-dashboard",
        tourId: "recruiter-quick-start",
      },
      {
        target: '[data-tour="invite-hiring-manager-btn"]',
        content:
          "Invite hiring managers when you want structured candidate feedback from the business side.",
        route: "/recruiter-dashboard",
        tourId: "recruiter-quick-start",
      },
      {
        target: '[data-tour="post-job-button"]',
        content:
          "Create your next job from here. Once the role is live, applications and sourcing activity flow into your pipeline.",
        route: "/my-jobs",
        tourId: "recruiter-quick-start",
      },
      {
        target: '[data-tour="jobs-list"]',
        content:
          "Use this list to open a role, review candidates, manage stages, and track job-level progress.",
        route: "/my-jobs",
        tourId: "recruiter-quick-start",
      },
    ],
  },
  {
    id: "candidate-pipeline",
    title: "Candidate Pipeline",
    description: "Review, filter, and move candidates through stages",
    roles: ["recruiter", "hiring_manager"],
    contextual: true,
    steps: [
      {
        target: '[data-tour="job-context"]',
        content:
          "This is the command center for one job. Use it to understand the role context before reviewing candidates.",
        disableBeacon: true,
        tourId: "candidate-pipeline",
      },
      {
        target: '[data-tour="applications-filters"]',
        content:
          "Filter candidates by stage, status, application date, and discover signals so you can focus on the right group.",
        tourId: "candidate-pipeline",
      },
      {
        target: '[data-tour="kanban-board"]',
        content:
          "Drag candidates between stages as decisions happen. Click a card to inspect the candidate before moving them.",
        tourId: "candidate-pipeline",
      },
      {
        target: '[data-tour="bulk-actions"]',
        content:
          "Use bulk actions when you need to move, email, or shortlist multiple candidates at once.",
        tourId: "candidate-pipeline",
      },
    ],
  },
  {
    id: "talent-search",
    title: "Discover",
    description: "Find reusable candidates with Memory",
    roles: ["recruiter"],
    steps: [
      {
        target: '[data-tour="talent-search-input"]',
        content:
          "Search your reusable candidate pool in plain English. Describe the role, skills, seniority, or background you need.",
        disableBeacon: true,
        route: "/candidates",
        tourId: "talent-search",
      },
      {
        target: '[data-tour="talent-search-results"]',
        content:
          "Memory ranks candidates using stored resume evidence, discovered signals, and prior pipeline context so strong existing candidates are easier to reuse.",
        route: "/candidates",
        tourId: "talent-search",
      },
    ],
  },
  {
    id: "client-workflow",
    title: "Client Workflow",
    description: "Manage clients and shared shortlists",
    roles: ["recruiter"],
    steps: [
      {
        target: '[data-tour="add-client-button"]',
        content:
          "Add clients here when you want to group jobs and shortlists by customer or hiring account.",
        disableBeacon: true,
        route: "/clients",
        tourId: "client-workflow",
      },
      {
        target: '[data-tour="clients-list"]',
        content:
          "Use the client list to see active accounts, related jobs, and shortlist workflows in one place.",
        route: "/clients",
        tourId: "client-workflow",
      },
    ],
  },
  {
    id: "hiring-manager-review",
    title: "Hiring Manager Review",
    description: "Review candidates and submit feedback",
    roles: ["hiring_manager"],
    steps: [
      {
        target: '[data-tour="hm-dashboard"]',
        content:
          "Your dashboard shows the jobs and candidates where your feedback is needed.",
        disableBeacon: true,
        route: "/hiring-manager",
        tourId: "hiring-manager-review",
      },
      {
        target: '[data-tour="pending-feedback"]',
        content:
          "Start here when candidates are waiting for your review or hiring decision.",
        route: "/hiring-manager",
        tourId: "hiring-manager-review",
      },
      {
        target: '[data-tour="my-jobs"]',
        content:
          "These are the jobs you are attached to. Open a job to review candidates and pipeline progress.",
        route: "/hiring-manager",
        tourId: "hiring-manager-review",
      },
    ],
  },
  {
    id: "candidate-overview",
    title: "Candidate Overview",
    description: "Track applications and keep your profile current",
    roles: ["candidate"],
    steps: [
      {
        target: '[data-tour="my-applications"]',
        content:
          "Track your applications and see where each one sits in the hiring process.",
        disableBeacon: true,
        route: "/my-dashboard",
        tourId: "candidate-overview",
      },
      {
        target: '[data-tour="application-status"]',
        content:
          "Application status shows the current stage and helps you understand what happens next.",
        route: "/my-dashboard",
        tourId: "candidate-overview",
      },
      {
        target: '[data-tour="profile-settings"]',
        content:
          "Keep your profile, resume, and skills updated so recruiters have the latest information.",
        route: "/my-dashboard",
        tourId: "candidate-overview",
      },
    ],
  },
];

function roleCanSeeTour(config: TourConfig, userRole?: UserRole): boolean {
  if (!userRole || userRole === "super_admin") {
    return false;
  }

  return !config.roles || config.roles.includes(userRole);
}

function roleCanSeeStep(step: TourStep, userRole?: UserRole): boolean {
  if (!userRole || userRole === "super_admin") {
    return false;
  }

  return !step.roles || step.roles.includes(userRole);
}

export function getFullTour(userRole?: UserRole): TourStep[] {
  if (!userRole || userRole === "super_admin") {
    return [];
  }

  const primaryTour = tourConfigs.find((config) =>
    userRole === "recruiter"
      ? config.id === "recruiter-quick-start"
      : roleCanSeeTour(config, userRole)
  );

  return primaryTour?.steps.filter((step) => roleCanSeeStep(step, userRole)) ?? [];
}

export function getTourById(tourId: string, userRole?: UserRole): TourStep[] {
  const config = tourConfigs.find((c) => c.id === tourId);
  if (!config || !roleCanSeeTour(config, userRole)) {
    return [];
  }

  return config.steps.filter((step) => roleCanSeeStep(step, userRole));
}

export function getAvailableTours(userRole?: UserRole): TourConfig[] {
  return tourConfigs.filter((config) => !config.contextual && roleCanSeeTour(config, userRole));
}

export function getQuickStartTours(userRole?: UserRole): TourConfig[] {
  return getAvailableTours(userRole).filter((config) => config.id === "recruiter-quick-start");
}

export function getFullTours(userRole?: UserRole): TourConfig[] {
  return getAvailableTours(userRole);
}

export const TOUR_STORAGE_KEYS = {
  COMPLETED_TOURS: "vantahire_completed_tours",
  TOUR_DISMISSED: "vantahire_tour_dismissed",
  FIRST_VISIT: "vantahire_first_visit",
};
