import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Calendar, Briefcase, MapPin } from "lucide-react";
import { getCandidateApplicationStatus } from "@/components/candidate/CandidateJobStatusBadge";

interface TimelineApplication {
  id: number;
  jobTitle: string;
  jobLocation?: string;
  appliedAt: Date | string;
  status?: string;
}

interface CandidateTimelineProps {
  title: string;
  description?: string;
  applications: TimelineApplication[];
  isLoading?: boolean;
  onApplicationClick?: (id: number) => void;
}

interface GroupedApplications {
  [monthYear: string]: TimelineApplication[];
}

export function CandidateTimeline({
  title,
  description,
  applications,
  isLoading,
  onApplicationClick,
}: CandidateTimelineProps) {
  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-white">{title}</CardTitle>
          {description && <CardDescription className="text-muted-foreground">{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-5 w-32 bg-slate-700" />
                <div className="space-y-2 ml-4">
                  <Skeleton className="h-20 w-full bg-slate-700" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (applications.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-white">{title}</CardTitle>
          {description && <CardDescription className="text-muted-foreground">{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="py-12 text-center">
            <p className="text-muted-foreground">No applications yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Group applications by month/year
  const grouped = applications.reduce<GroupedApplications>((acc, app) => {
    const date = typeof app.appliedAt === 'string' ? new Date(app.appliedAt) : app.appliedAt;
    const monthYear = format(date, 'MMMM yyyy');
    if (!acc[monthYear]) {
      acc[monthYear] = [];
    }
    acc[monthYear].push(app);
    return acc;
  }, {});

  // Sort by date descending
  const sortedMonths = Object.keys(grouped).sort((a, b) => {
    const dateA = new Date(a);
    const dateB = new Date(b);
    return dateB.getTime() - dateA.getTime();
  });

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-white">{title}</CardTitle>
        {description && <CardDescription className="text-muted-foreground">{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {sortedMonths.map((monthYear) => {
            const apps = grouped[monthYear] || [];
            return (
              <div key={monthYear} className="space-y-3">
                {/* Month header */}
                <div className="flex items-center gap-2 text-primary">
                  <Calendar className="w-4 h-4" />
                  <h3 className="font-semibold">{monthYear}</h3>
                  <Badge variant="outline" className="border-primary/50 text-primary text-xs">
                    {apps.length} {apps.length === 1 ? 'application' : 'applications'}
                  </Badge>
                </div>

                {/* Applications in this month */}
                <div className="space-y-2 ml-6 border-l-2 border-border pl-4">
                  {apps
                    .sort((a, b) => {
                      const dateA = typeof a.appliedAt === 'string' ? new Date(a.appliedAt) : a.appliedAt;
                      const dateB = typeof b.appliedAt === 'string' ? new Date(b.appliedAt) : b.appliedAt;
                      return dateB.getTime() - dateA.getTime();
                    })
                    .map((app) => {
                      const appliedDate = typeof app.appliedAt === 'string' ? new Date(app.appliedAt) : app.appliedAt;
                      return (
                        <div
                          key={app.id}
                          className="relative bg-white/5 p-4 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                          onClick={() => onApplicationClick?.(app.id)}
                        >
                          {/* Timeline dot */}
                          <div className="absolute -left-[29px] top-6 w-3 h-3 bg-primary/100 rounded-full border-4 border-slate-900" />

                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <Briefcase className="w-4 h-4 text-primary flex-shrink-0" />
                                <h4 className="text-white font-medium truncate">{app.jobTitle}</h4>
                              </div>
                              {app.jobLocation && (
                                <div className="flex items-center gap-1 mt-1 text-muted-foreground text-sm">
                                  <MapPin className="w-3 h-3" />
                                  <span>{app.jobLocation}</span>
                                </div>
                              )}
                              <p className="text-muted-foreground text-xs mt-2">
                                Applied on {format(appliedDate, 'MMM d, yyyy')}
                              </p>
                            </div>
                            <div className="flex flex-col gap-1 items-end">
                              {app.status && (
                                <Badge variant="outline" className="text-xs border-info/50 text-info">
                                  {getCandidateApplicationStatus({
                                    status: app.status,
                                  }).label}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
