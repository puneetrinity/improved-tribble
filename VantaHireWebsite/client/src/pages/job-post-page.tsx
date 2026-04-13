import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Briefcase } from "lucide-react";
import { JobPostingStepper } from "@/components/JobPostingStepper";
import { jobPostPageCopy } from "@/lib/internal-copy";
import {
  InternalEmptyState,
  InternalHero,
  InternalPageShell,
  InternalPanel,
} from "@/components/internal";

export default function JobPostPage() {
  const { user, isLoading } = useAuth();

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <InternalPageShell>
        <InternalPanel>
          <InternalEmptyState
            icon={Briefcase}
            title={jobPostPageCopy.loading}
            className="animate-pulse"
          />
        </InternalPanel>
      </InternalPageShell>
    );
  }

  // Redirect if not authenticated
  if (!user) {
    return <Redirect to="/recruiter-auth" />;
  }

  // Check role permissions
  if (!['recruiter', 'super_admin'].includes(user.role)) {
    return (
      <InternalPageShell>
        <InternalPanel className="mx-auto w-full max-w-md">
          <InternalEmptyState
            icon={Briefcase}
            title={jobPostPageCopy.deniedTitle}
            description={jobPostPageCopy.deniedDescription}
          />
        </InternalPanel>
      </InternalPageShell>
    );
  }

  return (
    <InternalPageShell>
      <InternalHero
        eyebrow="Role Setup"
        title={jobPostPageCopy.header.title}
        subtitle={jobPostPageCopy.header.subtitle}
        icon={Briefcase}
        stats={[
          { label: "Step 1", value: "Basics", helper: "Title, location, job type" },
          { label: "Step 2", value: "Details", helper: "Description, skills, salary" },
          { label: "Step 3+", value: "Workflow", helper: "Team, client, templates, pipeline" },
        ]}
      />

      <InternalPanel className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <div className="[&_.shadow-sm]:shadow-none [&_.shadow-sm]:border-[#EEF0F4]">
          <JobPostingStepper />
        </div>
      </InternalPanel>
    </InternalPageShell>
  );
}
