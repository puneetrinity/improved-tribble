import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { User, Building, MapPin, Linkedin, Briefcase, Calendar, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Layout from "@/components/Layout";

interface RecruiterProfile {
  id: number | string; // publicId if available, otherwise numeric ID
  publicId: string | null;
  displayName: string;
  company: string | null;
  photoUrl: string | null;
  bio: string | null;
  skills: string[] | null;
  linkedin: string | null;
  location: string | null;
}

interface RecruiterJob {
  id: number;
  title: string;
  location: string;
  type: string;
  createdAt: string;
  slug: string | null;
}

export default function RecruiterProfilePage() {
  const [, params] = useRoute("/recruiters/:id");
  const [isVisible, setIsVisible] = useState(false);

  // Support both numeric ID and publicId in URL
  const recruiterIdOrPublicId = params?.id || null;

  useEffect(() => { setIsVisible(true); }, []);

  // Fetch recruiter profile
  const { data: profile, isLoading: profileLoading, error: profileError } = useQuery<RecruiterProfile>({
    queryKey: ["/api/recruiters", recruiterIdOrPublicId],
    queryFn: async () => {
      const response = await fetch(`/api/recruiters/${recruiterIdOrPublicId}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.code === 'PROFILE_PRIVATE') {
          throw new Error("PROFILE_PRIVATE");
        }
        if (response.status === 404) throw new Error("NOT_FOUND");
        throw new Error("Failed to fetch profile");
      }
      return response.json();
    },
    enabled: !!recruiterIdOrPublicId,
  });

  // Fetch recruiter's jobs (use publicId from profile response if available)
  const { data: jobsData, isLoading: jobsLoading } = useQuery<{ jobs: RecruiterJob[] }>({
    queryKey: ["/api/recruiters", recruiterIdOrPublicId, "jobs"],
    queryFn: async () => {
      const response = await fetch(`/api/recruiters/${recruiterIdOrPublicId}/jobs`);
      if (!response.ok) return { jobs: [] };
      return response.json();
    },
    enabled: !!recruiterIdOrPublicId && !!profile,
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (!recruiterIdOrPublicId) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center text-foreground">
            <h1 className="text-2xl font-bold mb-2">Invalid Profile</h1>
            <p>Please provide a valid recruiter ID.</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (profileLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="text-foreground mt-4">Loading profile...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (profileError || !profile) {
    const isPrivate = profileError?.message === "PROFILE_PRIVATE";
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center text-foreground max-w-md">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
              <User className="h-8 w-8 text-muted-foreground" />
            </div>
            <h1 className="text-2xl font-bold mb-2">
              {isPrivate ? "Profile Not Public" : "Profile Not Found"}
            </h1>
            <p className="mb-6 text-muted-foreground">
              {isPrivate
                ? "This recruiter has chosen to keep their profile private. You can still browse their job postings."
                : "This recruiter profile doesn't exist or has been removed."}
            </p>
            <div className="flex gap-3 justify-center">
              <Link href="/jobs">
                <Button className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8]">
                  Browse Jobs
                </Button>
              </Link>
              <Link href="/recruiters">
                <Button variant="outline">
                  View All Recruiters
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const jobs = jobsData?.jobs || [];

  return (
    <Layout>
      <Helmet>
        <title>{profile.displayName} - Recruiter | ealana</title>
        <meta name="description" content={`${profile.displayName}${profile.company ? ` at ${profile.company}` : ''}${profile.location ? ` in ${profile.location}` : ''}. View profile and job listings on ealana.`} />
        <link rel="canonical" href={`https://ealana.com/recruiters/${recruiterIdOrPublicId}`} />
        <meta property="og:title" content={`${profile.displayName} - Recruiter | ealana`} />
        <meta property="og:description" content={profile.bio || `View ${profile.displayName}'s recruiter profile and job listings on ealana.`} />
        <meta property="og:url" content={`https://ealana.com/recruiters/${recruiterIdOrPublicId}`} />
        <meta property="og:type" content="profile" />
        <meta property="og:image" content={profile.photoUrl || "https://ealana.com/og-image.jpg"} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={`${profile.displayName} - Recruiter | ealana`} />
        <meta name="twitter:description" content={profile.bio || `View ${profile.displayName}'s recruiter profile and job listings.`} />
        <meta name="twitter:image" content={profile.photoUrl || "https://ealana.com/twitter-image.jpg"} />

        {/* BreadcrumbList JSON-LD */}
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              {
                "@type": "ListItem",
                "position": 1,
                "name": "Home",
                "item": "https://ealana.com"
              },
              {
                "@type": "ListItem",
                "position": 2,
                "name": "Recruiters",
                "item": "https://ealana.com/recruiters"
              },
              {
                "@type": "ListItem",
                "position": 3,
                "name": profile.displayName,
                "item": `https://ealana.com/recruiters/${recruiterIdOrPublicId}`
              }
            ]
          })}
        </script>
      </Helmet>
      <div className="public-theme min-h-screen bg-background text-foreground py-12">
        {/* Premium background effects */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[100px] animate-pulse-slow"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-info/10 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1.2s' }}></div>

        <div className={`container mx-auto px-4 relative z-10 transition-opacity duration-1000 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="max-w-4xl mx-auto">
            {/* Profile Header Card */}
            <Card className="bg-muted/50 backdrop-blur-sm border-border mb-8">
              <CardContent className="pt-8">
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  {/* Avatar */}
                  <Avatar className="h-24 w-24 border-4 border-primary/30">
                    <AvatarImage src={profile.photoUrl || undefined} alt={profile.displayName} />
                    <AvatarFallback className="bg-gradient-to-br from-purple-500 to-blue-500 text-foreground text-2xl">
                      {getInitials(profile.displayName)}
                    </AvatarFallback>
                  </Avatar>

                  {/* Profile Info */}
                  <div className="flex-1 space-y-3">
                    <div>
                      <h1 className="text-3xl font-bold text-foreground">{profile.displayName}</h1>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-muted-foreground">
                        {profile.company && (
                          <span className="flex items-center gap-1.5">
                            <Building className="h-4 w-4" />
                            {profile.company}
                          </span>
                        )}
                        {profile.location && (
                          <span className="flex items-center gap-1.5">
                            <MapPin className="h-4 w-4" />
                            {profile.location}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* LinkedIn Link */}
                    {profile.linkedin && (
                      <a
                        href={profile.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-primary hover:text-purple-200 transition-colors"
                      >
                        <Linkedin className="h-4 w-4" />
                        View LinkedIn Profile
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Bio */}
                {profile.bio && (
                  <div className="mt-6 pt-6 border-t border-border">
                    <h2 className="text-lg font-semibold text-foreground mb-2">About</h2>
                    <p className="text-muted-foreground whitespace-pre-wrap">{profile.bio}</p>
                  </div>
                )}

                {/* Skills/Specializations */}
                {profile.skills && profile.skills.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-border">
                    <h2 className="text-lg font-semibold text-foreground mb-3">Specializations</h2>
                    <div className="flex flex-wrap gap-2">
                      {profile.skills.map((skill, index) => (
                        <Badge
                          key={`${skill}-${index}`}
                          variant="outline"
                          className="border-primary/30 text-primary bg-primary/10"
                        >
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Jobs Section */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <Briefcase className="h-6 w-6 text-primary" />
                <h2 className="text-2xl font-bold text-foreground">Active Job Postings</h2>
                <Badge className="bg-primary/20 text-primary border-primary/30">
                  {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
                </Badge>
              </div>

              {jobsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : jobs.length === 0 ? (
                <Card className="bg-muted/30 border-border">
                  <CardContent className="py-12 text-center">
                    <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No active job postings at the moment.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {jobs.map((job) => (
                    <Link key={job.id} href={`/jobs/${job.slug || job.id}`}>
                      <Card className="bg-muted/50 backdrop-blur-sm border-border hover:bg-muted/40 transition-colors cursor-pointer">
                        <CardContent className="py-4">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                            <div>
                              <h3 className="text-lg font-semibold text-foreground hover:text-primary transition-colors">
                                {job.title}
                              </h3>
                              <div className="flex flex-wrap items-center gap-3 mt-1 text-muted-foreground text-sm">
                                <span className="flex items-center gap-1.5">
                                  <MapPin className="h-3.5 w-3.5" />
                                  {job.location}
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <Calendar className="h-3.5 w-3.5" />
                                  Posted {formatDate(job.createdAt)}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className="border-border text-muted-foreground capitalize"
                              >
                                {job.type.replace('-', ' ')}
                              </Badge>
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-primary/30 text-primary hover:bg-primary/20"
                              >
                                View Job
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
