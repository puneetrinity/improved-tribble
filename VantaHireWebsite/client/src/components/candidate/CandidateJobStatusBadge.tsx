import {
  CheckCircle2,
  Eye,
  UserCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { CandidateApplicationSummary } from "@/hooks/use-candidate-job-state";

type StatusPresentation = {
  label: string;
  icon: LucideIcon;
  className: string;
};

const STATUS_PRESENTATION: Record<string, StatusPresentation> = {
  submitted: {
    label: "Applied",
    icon: CheckCircle2,
    className:
      "border-[rgba(75,142,240,0.28)] bg-[rgba(75,142,240,0.12)] text-e-blue",
  },
  reviewed: {
    label: "Under Review",
    icon: Eye,
    className:
      "border-[rgba(245,200,66,0.28)] bg-[rgba(245,200,66,0.12)] text-e-amber",
  },
  shortlisted: {
    label: "Shortlisted",
    icon: UserCheck,
    className:
      "border-[rgba(52,209,122,0.28)] bg-[rgba(52,209,122,0.12)] text-e-green",
  },
  rejected: {
    label: "Rejected",
    icon: XCircle,
    className:
      "border-[rgba(239,68,68,0.28)] bg-[rgba(239,68,68,0.12)] text-red-400",
  },
  downloaded: {
    label: "Resume Reviewed",
    icon: Eye,
    className:
      "border-[rgba(75,142,240,0.28)] bg-[rgba(75,142,240,0.12)] text-e-blue",
  },
};

export function getCandidateApplicationStatus(
  application: Pick<CandidateApplicationSummary, "status">,
): StatusPresentation {
  const normalizedStatus = application.status.toLowerCase();
  return STATUS_PRESENTATION[normalizedStatus] ?? STATUS_PRESENTATION.submitted!;
}

export function CandidateJobStatusBadge({
  application,
  className = "",
}: {
  application: Pick<CandidateApplicationSummary, "status">;
  className?: string;
}) {
  const presentation = getCandidateApplicationStatus(application);
  const Icon = presentation.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.62rem] font-medium uppercase tracking-[0.05em] ${presentation.className} ${className}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {presentation.label}
    </span>
  );
}
