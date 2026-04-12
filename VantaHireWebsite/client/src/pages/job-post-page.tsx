import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Briefcase } from "lucide-react";
import Layout from "@/components/Layout";
import { JobPostingStepper } from "@/components/JobPostingStepper";
import { jobPostPageCopy } from "@/lib/internal-copy";

export default function JobPostPage() {
  const { user, isLoading } = useAuth();

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16 flex justify-center">
          <div className="animate-pulse text-muted-foreground">{jobPostPageCopy.loading}</div>
        </div>
      </Layout>
    );
  }

  // Redirect if not authenticated
  if (!user) {
    return <Redirect to="/recruiter-auth" />;
  }

  // Check role permissions
  if (!['recruiter', 'super_admin'].includes(user.role)) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16">
          <Card className="max-w-md mx-auto shadow-sm">
            <CardContent className="p-8 text-center">
              <h1 className="text-xl font-semibold text-foreground mb-2">{jobPostPageCopy.deniedTitle}</h1>
              <p className="text-muted-foreground">{jobPostPageCopy.deniedDescription}</p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 pt-8">
          <div className="flex items-center gap-3 mb-2">
            <Briefcase className="h-7 w-7 text-primary" />
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">
              {jobPostPageCopy.header.title}
            </h1>
          </div>
          <p className="text-muted-foreground text-sm md:text-base">
            {jobPostPageCopy.header.subtitle}
          </p>
        </div>

        {/* Job Posting Stepper */}
        <div className="max-w-3xl mx-auto">
          <JobPostingStepper />
        </div>
      </div>
    </Layout>
  );
}
