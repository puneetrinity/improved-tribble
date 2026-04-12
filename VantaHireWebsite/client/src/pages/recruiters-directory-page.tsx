import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { User, Building, MapPin, Briefcase, Search } from "lucide-react";
import { Helmet } from "react-helmet-async";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
import { sectionLabel, btnPrimary } from "@/lib/shared-styles";

interface PublicRecruiter {
  id: number | string;
  publicId: string | null;
  displayName: string;
  company: string | null;
  photoUrl: string | null;
  bio: string | null;
  location: string | null;
  jobCount: number;
}

const breadcrumbJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://vantahire.com/" },
    { "@type": "ListItem", "position": 2, "name": "Recruiters", "item": "https://vantahire.com/recruiters" }
  ]
});

export default function RecruitersDirectoryPage() {
  const [searchTerm, setSearchTerm] = useState("");

  const { data, isLoading } = useQuery<{ recruiters: PublicRecruiter[] }>({
    queryKey: ["/api/recruiters"],
    queryFn: async () => {
      const response = await fetch("/api/recruiters");
      if (!response.ok) throw new Error("Failed to fetch recruiters");
      return response.json();
    },
  });

  const recruiters = data?.recruiters || [];

  const filteredRecruiters = recruiters.filter((recruiter) => {
    const search = searchTerm.toLowerCase();
    return (
      recruiter.displayName.toLowerCase().includes(search) ||
      recruiter.company?.toLowerCase().includes(search) ||
      recruiter.location?.toLowerCase().includes(search)
    );
  });

  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <>
      <Helmet>
        <title>Recruiters Directory | VantaHire — Find Specialist Recruiters</title>
        <meta name="description" content="Meet VantaHire's specialist recruiters. Industry experts in IT, telecom, automotive, fintech, and healthcare hiring across India and APAC." />
        <link rel="canonical" href="https://vantahire.com/recruiters" />
        <meta property="og:title" content="Recruiters Directory | VantaHire — Find Specialist Recruiters" />
        <meta property="og:description" content="Meet VantaHire's specialist recruiters. Industry experts across India and APAC." />
        <meta property="og:url" content="https://vantahire.com/recruiters" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://vantahire.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Recruiters Directory | VantaHire — Find Specialist Recruiters" />
        <meta name="twitter:description" content="Meet VantaHire's specialist recruiters. Industry experts across India and APAC." />
        <meta name="twitter:image" content="https://vantahire.com/twitter-image.jpg" />
        <script type="application/ld+json">
          {breadcrumbJsonLd}
        </script>
      </Helmet>

      <div className="font-dm leading-normal bg-hr-bg text-hr-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />

          {/* Hero */}
          <div className="pt-[140px] px-12 pb-16 text-center max-w-[1100px] mx-auto animate-hr-fade-up max-md:pt-[100px] max-md:px-5 max-md:pb-[60px]">
            <div className={sectionLabel}>Directory</div>
            <h1 className="font-satoshi text-[clamp(2.4rem,5vw,3.4rem)] font-normal leading-[1.2] tracking-tight mb-5 text-hr-text">
              Our Recruiters
            </h1>
            <p className="text-base leading-[1.7] text-hr-text-secondary max-w-[560px] mx-auto">
              Connect with specialist recruiters across IT, telecom, fintech, healthcare, and automotive industries.
            </p>
          </div>

          {/* Search */}
          <div className="max-w-[480px] mx-auto mb-10 px-12 max-md:px-5" style={{ animation: 'hr-fade-up 0.8s ease-out 0.1s both' }}>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-hr-text-muted" />
              <input
                type="text"
                placeholder="Search by name, company, or location..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-hr-bg-elevated border border-[rgba(255,255,255,0.08)] rounded px-3.5 py-[10px] pl-10 font-dm text-[0.85rem] text-hr-text outline-none transition-colors duration-200 placeholder:text-hr-text-muted focus:border-hr-accent"
              />
            </div>
          </div>

          {/* Results count */}
          {!isLoading && (
            <div className="text-center mb-8" style={{ animation: 'hr-fade-up 0.8s ease-out 0.15s both' }}>
              <span className="font-mono text-[0.72rem] tracking-[0.06em] text-hr-text-muted">
                {filteredRecruiters.length} {filteredRecruiters.length === 1 ? "recruiter" : "recruiters"} found
              </span>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-hr-accent border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-hr-text-muted text-[0.85rem] mt-4">Loading recruiters...</p>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && filteredRecruiters.length === 0 && (
            <div className="text-center py-20 px-12 max-md:px-5">
              <User className="h-12 w-12 text-hr-text-muted mx-auto mb-4 opacity-40" />
              <h2 className="font-satoshi text-xl font-medium text-hr-text mb-2">No Recruiters Found</h2>
              <p className="text-hr-text-secondary text-sm mb-6">
                {searchTerm
                  ? "Try adjusting your search terms."
                  : "No recruiters have made their profiles public yet."}
              </p>
              <Link href="/jobs">
                <span className={btnPrimary}>Browse Jobs Instead</span>
              </Link>
            </div>
          )}

          {/* Recruiters Grid */}
          {!isLoading && filteredRecruiters.length > 0 && (
            <div className="px-12 max-md:px-5 pb-20">
              <div
                className="grid grid-cols-3 max-lg:grid-cols-2 max-md:grid-cols-1 gap-px bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.08)] rounded-lg overflow-hidden max-w-[1100px] mx-auto"
                style={{ animation: 'hr-fade-up 0.8s ease-out 0.2s both' }}
              >
                {filteredRecruiters.map((recruiter) => (
                  <Link key={recruiter.id} href={`/recruiters/${recruiter.id}`}>
                    <div className="bg-hr-bg py-7 px-6 flex flex-col transition-colors duration-200 hover:bg-hr-bg-elevated cursor-pointer group h-full">
                      <div className="flex items-start gap-3.5">
                        {/* Avatar */}
                        {recruiter.photoUrl ? (
                          <img
                            src={recruiter.photoUrl}
                            alt={recruiter.displayName}
                            className="w-11 h-11 rounded-full object-cover border border-[rgba(255,255,255,0.1)] shrink-0"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-[rgba(124,58,237,0.15)] flex items-center justify-center text-hr-accent-hover text-[0.8rem] font-medium shrink-0">
                            {getInitials(recruiter.displayName)}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-satoshi text-[1rem] font-medium text-hr-text group-hover:text-hr-accent-hover transition-colors truncate">
                            {recruiter.displayName}
                          </h3>
                          {recruiter.company && (
                            <p className="text-[0.82rem] text-hr-text-secondary flex items-center gap-1.5 mt-0.5 truncate">
                              <Building className="h-3 w-3 shrink-0 opacity-60" />
                              {recruiter.company}
                            </p>
                          )}
                          {recruiter.location && (
                            <p className="text-[0.78rem] text-hr-text-muted flex items-center gap-1.5 mt-0.5 truncate">
                              <MapPin className="h-3 w-3 shrink-0 opacity-50" />
                              {recruiter.location}
                            </p>
                          )}
                        </div>
                      </div>

                      {recruiter.bio && (
                        <p className="text-[0.82rem] text-hr-text-secondary leading-[1.6] mt-3.5 line-clamp-2">
                          {recruiter.bio}
                        </p>
                      )}

                      <div className="flex items-center justify-between mt-auto pt-4">
                        <span className="font-mono text-[0.7rem] tracking-[0.04em] text-hr-text-muted flex items-center gap-1">
                          <Briefcase className="h-3 w-3 opacity-50" />
                          {recruiter.jobCount} active {recruiter.jobCount === 1 ? "job" : "jobs"}
                        </span>
                        <span className="text-[0.78rem] text-hr-accent-hover opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          View Profile →
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <HomepageFooter />
        </div>
      </div>
    </>
  );
}

