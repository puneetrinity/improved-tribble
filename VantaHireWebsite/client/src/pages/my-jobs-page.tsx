import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Eye, Briefcase, Plus, Play, Search, LayoutGrid, CheckCircle, Clock, Archive } from "lucide-react";
import { PageHeaderSkeleton, FilterBarSkeleton, JobListSkeleton } from "@/components/skeletons";
import { SubNav, type SubNavItem } from "@/components/SubNav";
import { myJobsPageCopy } from "@/lib/internal-copy";
import {
  InternalEmptyState,
  InternalHero,
  InternalPageShell,
  InternalPanel,
  InternalSectionHeader,
} from "@/components/internal";
import type { Job } from "@shared/schema";

type JobWithCounts = Job & {
  company?: string;
  applicationCount?: number;
  hiringManager?: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    username: string;
  };
  clientName?: string | null;
};

export default function MyJobsPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Fetch recruiter's jobs
  const { data: jobs = [], isLoading: jobsLoading } = useQuery<JobWithCounts[]>({
    queryKey: ["/api/my-jobs"],
  });

  // Compute counts for SubNav
  const activeCount = jobs.filter(j => j.isActive).length;
  const inactiveCount = jobs.filter(j => !j.isActive).length;
  const pendingCount = jobs.filter(j => j.status === 'pending').length;

  const subNavItems: SubNavItem[] = [
    { id: "all", label: myJobsPageCopy.tabs.all, count: jobs.length, icon: <LayoutGrid className="h-4 w-4" /> },
    { id: "active", label: myJobsPageCopy.tabs.active, count: activeCount, icon: <CheckCircle className="h-4 w-4" /> },
    { id: "inactive", label: myJobsPageCopy.tabs.inactive, count: inactiveCount, icon: <Archive className="h-4 w-4" /> },
    { id: "pending", label: myJobsPageCopy.tabs.pending, count: pendingCount, icon: <Clock className="h-4 w-4" /> },
  ];

  // Publish job mutation
  const publishJobMutation = useMutation({
    mutationFn: async ({ jobId, isActive }: { jobId: number; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/jobs/${jobId}/status`, { isActive });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-jobs"] });
      toast({
        title: myJobsPageCopy.toasts.publishSuccessTitle,
        description: myJobsPageCopy.toasts.publishSuccessDescription,
      });
    },
    onError: (error: Error) => {
      toast({
        title: myJobsPageCopy.toasts.publishErrorTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-warning/10 text-warning-foreground border-warning/30';
      case 'approved': return 'bg-success/10 text-success-foreground border-success/30';
      case 'rejected': return 'bg-destructive/10 text-destructive border-destructive/30';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  // Filter jobs based on active tab and search
  const filteredJobs = jobs.filter((job) => {
    const matchesSearch = !searchQuery ||
      job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.clientName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.location.toLowerCase().includes(searchQuery.toLowerCase());

    // Tab filter takes priority
    const matchesTab =
      activeTab === "all" ||
      (activeTab === "active" && job.isActive) ||
      (activeTab === "inactive" && !job.isActive) ||
      (activeTab === "pending" && job.status === "pending");

    return matchesSearch && matchesTab;
  });

  if (jobsLoading) {
    return (
      <InternalPageShell>
        <PageHeaderSkeleton />
        <FilterBarSkeleton />
        <InternalPanel className="p-5">
          <JobListSkeleton count={4} />
        </InternalPanel>
      </InternalPageShell>
    );
  }

  return (
    <InternalPageShell>
      <InternalHero
        eyebrow="Job Workspace"
        title={myJobsPageCopy.header.title}
        subtitle={myJobsPageCopy.header.subtitle}
        icon={Briefcase}
        actions={
          <Button
            onClick={() => setLocation("/jobs/post")}
            data-tour="post-job-button"
            className="h-11 rounded-2xl bg-[#5B4FF7] px-5 font-semibold text-white shadow-[0_10px_22px_rgba(91,79,247,0.22)] hover:bg-[#4F46E5]"
          >
            <Plus className="mr-2 h-4 w-4" />
            {myJobsPageCopy.header.primaryAction}
          </Button>
        }
        stats={[
          { label: "Total Jobs", value: jobs.length },
          { label: "Active", value: activeCount, accentClassName: "text-[#16A34A]" },
          { label: "Pending", value: pendingCount, accentClassName: pendingCount > 0 ? "text-[#D97706]" : undefined },
        ]}
      />

      <InternalPanel className="p-4 sm:p-5">
        <SubNav
          items={subNavItems}
          activeId={activeTab}
          onChange={setActiveTab}
          className="rounded-2xl border border-[#EEF0F4] bg-[#F8F8FA]"
        />

        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7B8191]" />
          <Input
            placeholder={myJobsPageCopy.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-11 rounded-2xl border-[#E5E7EB] bg-[#FAFAFB] pl-10 font-outfit text-sm text-[#111827] shadow-[0_3px_10px_rgba(15,23,42,0.04)] placeholder:text-[#9CA3AF]"
          />
        </div>
      </InternalPanel>

      <InternalPanel className="p-5" data-tour="jobs-list">
        <InternalSectionHeader
          title={`${myJobsPageCopy.list.title} (${filteredJobs.length})`}
          description={myJobsPageCopy.list.description}
        />
        <div className="mt-5 space-y-4">
          {filteredJobs.length === 0 ? (
            <>
              {pendingCount > 0 && activeTab !== "pending" && !searchQuery ? (
                <InternalEmptyState
                  icon={Clock}
                  title={
                    pendingCount === 1
                      ? myJobsPageCopy.empty.pendingSingle
                      : `${myJobsPageCopy.empty.pendingMultiplePrefix} ${pendingCount} ${myJobsPageCopy.empty.pendingMultipleSuffix}`
                  }
                  description={myJobsPageCopy.empty.pendingDescription}
                  actions={
                    <>
                      <Button variant="outline" onClick={() => setActiveTab("pending")}>
                        <Clock className="mr-2 h-4 w-4" />
                        {myJobsPageCopy.empty.viewPending}
                      </Button>
                      <Button onClick={() => setLocation("/jobs/post")}>
                        <Plus className="mr-2 h-4 w-4" />
                        {myJobsPageCopy.empty.postAnother}
                      </Button>
                    </>
                  }
                />
              ) : (
                <InternalEmptyState
                  icon={Briefcase}
                  title={
                    searchQuery || activeTab !== "all"
                      ? myJobsPageCopy.empty.filtered
                      : myJobsPageCopy.empty.none
                  }
                  actions={
                    !searchQuery && activeTab === "all" ? (
                      <Button onClick={() => setLocation("/jobs/post")}>
                        <Plus className="mr-2 h-4 w-4" />
                        {myJobsPageCopy.empty.firstJob}
                      </Button>
                    ) : null
                  }
                />
              )}
            </>
          ) : (
            filteredJobs.map((job) => (
              <div
                key={job.id}
                className="rounded-[20px] border border-[#EEF0F4] bg-[#F8F8FA] p-4 transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_14px_34px_rgba(15,23,42,0.07)]"
              >
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-satoshi text-lg font-bold tracking-[-0.02em] text-[#111827]">{job.title}</h3>
                    <p className="font-dm text-sm text-[#687182]">{job.company} • {job.location}</p>
                    {job.hiringManager && (
                      <p className="mt-1 font-dm text-sm text-[#687182]">
                        {myJobsPageCopy.empty.hiringManager}: {job.hiringManager.firstName && job.hiringManager.lastName
                          ? `${job.hiringManager.firstName} ${job.hiringManager.lastName}`
                          : job.hiringManager.username}
                      </p>
                    )}
                    {!job.hiringManager && (
                      <p className="mt-1 font-dm text-sm text-[#687182]">{myJobsPageCopy.empty.hiringManager}: —</p>
                    )}
                    <p className="mt-1 font-dm text-sm text-[#687182]">{job.type}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <Badge className={getStatusColor(job.status)}>
                      {job.status}
                    </Badge>
                    {job.isActive && (
                      <Badge className="border-info/30 bg-info/10 text-info-foreground">
                        Live
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="mb-3 line-clamp-2 font-outfit text-sm leading-relaxed text-[#5F6675]">{job.original_JD ?? job.description}</p>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-dm text-sm text-[#687182]">
                    {job.applicationCount || 0} applications
                  </span>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLocation(`/jobs/${job.id}/applications`)}
                    >
                      <Eye className="mr-1 h-4 w-4" />
                      View Applications
                    </Button>
                    {job.status === 'approved' && !job.isActive && (
                      <Button
                        size="sm"
                        onClick={() => publishJobMutation.mutate({ jobId: job.id, isActive: true })}
                        disabled={publishJobMutation.isPending}
                        className="bg-success text-foreground hover:bg-success/80"
                      >
                        <Play className="mr-1 h-4 w-4" />
                        {publishJobMutation.isPending ? 'Publishing...' : 'Publish'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </InternalPanel>
    </InternalPageShell>
  );
}
