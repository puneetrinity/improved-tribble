import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { computeTotalExperienceYears } from "@/lib/sourcing-experience";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ExternalLink,
  Star,
  EyeOff,
  Eye,
  MapPin,
  Building,
  Briefcase,
  CheckCircle2,
  Mail,
  Github,
  Twitter,
  Globe,
  UserCheck,
  Zap,
  GraduationCap,
  Award,
  BookOpen,
  Heart,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourcedCandidateForUI } from "@/hooks/use-sourcing";
import { useFindContact } from "@/hooks/use-sourcing";
import { selectDisplayCandidateEmails } from "@shared/contactResolution";
import {
  fitBadgePresentation,
  tierLabel,
  tierColor,
  identityLabel,
  enrichmentLabel,
  freshnessLabel,
  locationConfidence,
  locationLabelText,
  confidenceLabel,
  FIT_LABELS,
  FIT_INTERNAL_KEYS,
  toPctFitClient,
} from "@/lib/sourcing-labels";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface CandidateDrawerProps {
  candidate: SourcedCandidateForUI | null;
  open: boolean;
  onClose: () => void;
  onUpdateState: (
    candidateId: number,
    state: "new" | "shortlisted" | "hidden",
  ) => void;
  isUpdating: boolean;
}

function FitBadge({
  score,
  matchStrength,
}: {
  score: number | null;
  matchStrength: SourcedCandidateForUI["matchStrength"];
}) {
  if (score == null) {
    return <Badge variant="outline" className="text-xs">No score</Badge>;
  }
  const presentation = fitBadgePresentation(score, matchStrength);
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs font-semibold tabular-nums",
        presentation.className,
      )}
    >
      {presentation.label} &middot; {score}
    </Badge>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function formatDateLabel(input: string): string {
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? input : parsed.toLocaleDateString();
}

export function CandidateDrawer({
  candidate,
  open,
  onClose,
  onUpdateState,
  isUpdating,
}: CandidateDrawerProps) {
  const { findContact, isPending: contactPending } = useFindContact();

  if (!candidate) return null;

  const c = candidate;
  const isShortlisted = c.state === "shortlisted";
  const isHidden = c.state === "hidden";
  const displayedEmails = selectDisplayCandidateEmails({
    candidateState: c.state,
    status: c.emailResolveStatus,
    foundEmails: c.foundEmails,
    foundEmail: c.foundEmail,
  });
  const signals = candidate.cardSignals;
  const aiSummary = candidate.aiSummary;

  const jdMatchedSkills = ((c.fitBreakdown as any)?.matchedSkills as string[]) || [];
  const crustdataSkills = Array.isArray(c.crustdata?.skills?.professional_network_skills)
    ? (c.crustdata!.skills!.professional_network_skills as string[])
    : [];

  const fallbackSkills = c.cardSignals?.skillsTopN || [];
  const skillsToUse = jdMatchedSkills.length > 0
    ? jdMatchedSkills
    : (crustdataSkills.length > 0 ? crustdataSkills : fallbackSkills);

  // Deduplicate and limit to 15 for drawer
  const skills = Array.from(new Set(skillsToUse)).slice(0, 15);

  const fitBreakdownEntries = c.fitBreakdown
    ? Object.entries(c.fitBreakdown)
      .filter(([k, v]) => v != null && v !== "" && !FIT_INTERNAL_KEYS.has(k))
      .sort(([, a], [, b]) => (typeof b === "number" ? b : -1) - (typeof a === "number" ? a : -1))
    : [];

  const locConf = locationConfidence(c.locationMatchType, c.locationConfidenceNumeric);
  const locLabel = locationLabelText(c.locationLabel);
  const dataConf = confidenceLabel(c.dataConfidence);

  const name = c.crustdata?.basic_profile?.name || "Unknown Candidate";
  const headline = c.crustdata?.basic_profile?.headline || null;
  const summary = c.crustdata?.basic_profile?.summary || null;
  const location = c.crustdata?.basic_profile?.location?.full_location
    || c.crustdata?.basic_profile?.location?.raw || null;

  const currentRole = c.crustdata?.experience?.employment_details?.current?.[0];
  const pastRole = c.crustdata?.experience?.employment_details?.past?.[0];

  // Crustdata schema: company is .name not .company_name
  const currentTitle = c.crustdata?.basic_profile?.current_title || currentRole?.title || null;
  const company = currentRole?.name || pastRole?.name || null;
  const seniority = currentRole?.seniority_level || pastRole?.seniority_level || null;

  const pictureUrl = c.crustdata?.professional_network?.profile_picture_permalink || c.crustdata?.basic_profile?.profile_picture_permalink || null;

  const initials = name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const followerCount = c.crustdata?.professional_network?.followers || null;
  const connections = c.crustdata?.professional_network?.connections || null;

  // Total experience, deduped by company (Crustdata repeats full company tenure
  // per title, so a naive sum inflates it — e.g. 6 yrs shown as 18).
  const totalExpYears = computeTotalExperienceYears(c.crustdata) ?? 0;
  const experienceYears = totalExpYears > 0 ? totalExpYears : null;

  const industry = currentRole?.company_professional_network_industry
    || pastRole?.company_professional_network_industry || null;
  const recentlyChangedJobs = c.crustdata?.recently_changed_jobs || false;
  const openToCards = c.crustdata?.professional_network?.open_to_cards || [];

  const experience = [
    ...(c.crustdata?.experience?.employment_details?.current || []),
    ...(c.crustdata?.experience?.employment_details?.past || [])
  ];

  const education = c.crustdata?.education?.schools || [];
  const languages = c.crustdata?.basic_profile?.languages || [];
  const certifications = c.crustdata?.certifications || [];
  const honors = c.crustdata?.honors || [];
  const socialHandles = c.crustdata?.social_handles || {};

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent side="right" className="sm:max-w-xl w-full p-0 flex flex-col h-full border-l shadow-2xl">
        {/* Scrollable region: header + all detail content scroll together */}
        <div className="flex-1 overflow-y-auto min-h-0">
        {/* Premium Header */}
        <div className="bg-muted/30 p-6 space-y-4">
          <div className="flex items-start gap-4">
            <Avatar className="h-20 w-20 border-4 border-background shadow-lg">
              <AvatarImage src={pictureUrl || undefined} />
              <AvatarFallback className="text-2xl font-bold bg-primary/5 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-1">
              <SheetTitle className="text-2xl font-bold tracking-tight">{name}</SheetTitle>
              {headline && <p className="text-base text-muted-foreground leading-snug">{headline}</p>}
              {/* Current role + company */}
              {(currentTitle || company) && (
                <p className="text-sm text-foreground/80 font-medium">
                  {currentTitle}
                  {currentTitle && company && <span className="text-muted-foreground font-normal"> @ </span>}
                  {company}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {c.linkedinUrl && (
                  <a
                    href={c.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                    LinkedIn Profile
                  </a>
                )}
                {(c as any).resumeApplicationId && (
                  <a
                    href={`/api/applications/${(c as any).resumeApplicationId}/resume`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View Resume
                  </a>
                )}
              </div>

              {/* Premium Enrichlayer Stats Row */}
              {(seniority || followerCount !== null || connections !== null || experienceYears !== null || industry !== null) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2 text-xs text-muted-foreground border-t border-muted/50 mt-2">
                  {seniority && (
                    <span className="flex items-center gap-1 font-medium text-foreground/90 bg-primary/5 px-2 py-0.5 rounded-full border border-primary/10">
                      <Briefcase className="h-3.5 w-3.5 text-primary/80" />
                      {seniority}
                    </span>
                  )}
                  {experienceYears !== null && (
                    <span className="flex items-center gap-1 font-medium text-foreground/90 bg-primary/5 px-2 py-0.5 rounded-full border border-primary/10">
                      <Briefcase className="h-3.5 w-3.5 text-primary/80" />
                      {experienceYears} Yrs Exp
                    </span>
                  )}
                  {followerCount !== null && (
                    <span className="flex items-center gap-1 font-medium">
                      <Users className="h-3.5 w-3.5 text-blue-500/80" />
                      {followerCount.toLocaleString()} Followers
                    </span>
                  )}
                  {connections !== null && (
                    <span className="flex items-center gap-1 font-medium">
                      <Globe className="h-3.5 w-3.5 text-green-500/80" />
                      {connections.toLocaleString()}+ Connections
                    </span>
                  )}
                  {industry !== null && (
                    <span className="flex items-center gap-1 font-medium italic">
                      &middot; {industry}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <FitBadge
              score={c.fitScore}
              matchStrength={c.matchStrength}
            />
            {c.engagementReady && (
              <Badge variant="outline" className="text-xs font-semibold bg-green-50 text-green-700 border-green-200">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Verified & Ready
              </Badge>
            )}
            {recentlyChangedJobs && (
              <Badge variant="outline" className="text-xs font-semibold bg-purple-50 text-purple-700 border-purple-200">
                <Zap className="h-3 w-3 mr-1" />
                Recently Changed Jobs
              </Badge>
            )}
            {openToCards.map((code: string) => (
              <Badge key={code} variant="secondary" className="text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary hover:bg-primary/20">
                {code.replace(/_/g, ' ')}
              </Badge>
            ))}
            <IdentityBadge
              status={c.identitySummary?.displayStatus}
              confidence={c.identitySummary?.maxIdentityConfidence}
            />
          </div>
        </div>

        <div className="px-6 py-8 space-y-8">
          {/* About Summary */}
          {summary && (
            <Section title="About" icon={UserCheck}>
              <p className="text-xs text-muted-foreground/90 leading-relaxed whitespace-pre-line">
                {summary}
              </p>
            </Section>
          )}

          {/* AI Insight Section (or LinkedIn Summary Fallback) */}
          {(aiSummary || signals?.summaryShort) && (
            <Section title={aiSummary ? "AI Intelligence" : "LinkedIn Summary"} icon={aiSummary ? Zap : Sparkles}>
              <div className={cn("p-4 rounded-xl border space-y-3", aiSummary ? "border-primary/20 bg-primary/5" : "border-blue-500/20 bg-blue-500/5")}>
                <p className="text-sm leading-relaxed text-foreground/90 font-medium italic">
                  "{aiSummary?.text || signals?.summaryShort}"
                </p>
                {(aiSummary?.skills?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {aiSummary!.skills.map(s => (
                      <Badge key={s} variant="secondary" className="bg-background/80 text-[10px] font-bold uppercase">
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Contact Details */}
          <Section title="Contact Information" icon={Mail}>
            <div className="grid grid-cols-1 gap-3">
              <div className="p-3 rounded-lg border bg-card flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                  <Mail className="h-5 w-5 text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Email Address</p>
                  {!isShortlisted ? (
                    <div className="mt-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        Shortlist required
                      </span>
                    </div>
                  ) : displayedEmails.length > 0 ? (
                    <div className="mt-1 flex flex-col gap-1">
                      {displayedEmails.map((email: string, i: number) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs font-medium text-foreground bg-muted/50 px-2 py-1 rounded w-fit">
                          {email}
                          <Badge variant="outline" className="h-4 px-1 text-[9px] bg-green-50 text-green-700 border-green-200 ml-1">Found</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1">
                      {c.emailResolveStatus === "suppressed" ? (
                        <span className="text-xs font-medium text-muted-foreground">
                          Email suppressed
                        </span>
                      ) : c.emailResolveStatus === "not_found" ? (
                        <span className="text-xs font-medium text-muted-foreground">
                          No email found
                        </span>
                      ) : c.emailResolveStatus === "failed" ? (
                        <span className="text-xs font-medium text-muted-foreground">
                          Contact lookup unavailable
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs font-semibold px-3"
                          disabled={contactPending || c.emailResolveStatus === "pending"}
                          onClick={() => findContact({ candidateId: c.id, jobId: c.jobId })}
                        >
                          {contactPending || c.emailResolveStatus === "pending"
                            ? "Finding..."
                            : "Find Personal Email"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Section>

          {/* Social Profiles */}
          {Object.keys(socialHandles).length > 0 && (
            <Section title="Digital Identities" icon={UserCheck}>
              <div className="flex flex-wrap gap-3">
                {Object.entries(socialHandles).map(([key, handle]: [string, any]) => {
                  if (!handle?.profile_url) return null;
                  let platformName = key.replace('_identifier', '').replace('_', ' ');
                  let IconCmp = Globe;
                  if (key.includes('github') || key.includes('dev_platform')) IconCmp = Github;
                  if (key.includes('twitter')) IconCmp = Twitter;
                  if (key.includes('professional_network')) IconCmp = Globe;

                  return (
                    <a
                      key={key}
                      href={handle.profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-2 pr-4 rounded-full border bg-card hover:bg-muted transition-colors group"
                    >
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                        <IconCmp className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted-foreground uppercase font-bold">{platformName}</p>
                        <p className="text-xs font-semibold truncate group-hover:text-primary transition-colors">
                          {handle.profile_url.replace(/^https?:\/\/(www\.)?/, '')}
                        </p>
                      </div>
                    </a>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Skills Cloud */}
          {skills.length > 0 && (
            <Section title="Skills & Expertise" icon={Briefcase}>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((skill: any) => (
                  <Badge key={skill} variant="secondary" className="text-xs font-medium px-2.5 py-1">
                    {skill}
                  </Badge>
                ))}
              </div>
            </Section>
          )}

          {/* Work History */}
          {experience.length > 0 && (
            <Section title="Professional Experience" icon={Briefcase}>
              <div className="space-y-4 border-l-2 border-muted pl-4 ml-2 pt-1">
                {experience.map((exp: any, idx: number) => {
                  const startYear = exp.start_date ? new Date(exp.start_date).getFullYear() : null;
                  const endYear = exp.end_date ? new Date(exp.end_date).getFullYear() : null;
                  const locationRaw = typeof exp.location === 'string' ? exp.location : exp.location?.raw;
                  return (
                    <div key={idx} className="relative space-y-2">
                      <div className="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-primary bg-background" />

                      <div className="flex justify-between items-start gap-2">
                        <div className="space-y-1">
                          <h5 className="font-bold text-sm leading-snug text-foreground flex flex-wrap items-center gap-2">
                            {exp.title}
                            {exp.seniority_level && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1.5 py-0 uppercase tracking-wider">{exp.seniority_level}</Badge>
                            )}
                            {exp.function_category && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1.5 py-0 uppercase tracking-wider bg-blue-50 text-blue-700 border-blue-200">{exp.function_category}</Badge>
                            )}
                          </h5>
                          <p className="text-xs text-muted-foreground font-semibold flex items-center flex-wrap gap-x-2 gap-y-1">
                            <span className="flex items-center gap-1">
                              <Building className="h-3 w-3 shrink-0" />
                              {exp.name || exp.company_name}
                            </span>
                            {locationRaw && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3 shrink-0" />
                                {locationRaw}
                              </span>
                            )}
                          </p>
                          {/* Company Metadata Row */}
                          <p className="text-[10px] text-muted-foreground/80 flex flex-wrap items-center gap-1.5 font-medium">
                            {exp.company_headcount_range && (
                              <span className="bg-muted px-1.5 py-0.5 rounded">{exp.company_headcount_range} employees</span>
                            )}
                            {exp.company_headquarters_country && (
                              <span className="bg-muted px-1.5 py-0.5 rounded">HQ: {exp.company_headquarters_country}</span>
                            )}
                            {exp.company_industries?.length > 0 && (
                              <span className="bg-muted px-1.5 py-0.5 rounded truncate max-w-[150px]">{exp.company_industries[0]}</span>
                            )}
                            {exp.business_email_verified && (
                              <span className="text-green-600 bg-green-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                                <CheckCircle2 className="h-2.5 w-2.5" /> Email Verified
                              </span>
                            )}
                          </p>
                        </div>
                        <span className="text-[9px] font-bold text-muted-foreground whitespace-nowrap bg-muted px-1.5 py-0.5 rounded uppercase shrink-0 mt-0.5">
                          {startYear || 'N/A'} - {endYear || 'PRESENT'}
                        </span>
                      </div>

                      {exp.description && (
                        <p className="text-xs text-muted-foreground/90 leading-relaxed whitespace-pre-line mt-1.5 p-2 rounded-lg bg-card border">
                          {exp.description}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Education History */}
          {education.length > 0 && (
            <Section title="Education" icon={GraduationCap}>
              <div className="space-y-3">
                {education.map((edu: any, idx: number) => {
                  const startYear = edu.start_date ? new Date(edu.start_date).getFullYear() : null;
                  const endYear = edu.end_date ? new Date(edu.end_date).getFullYear() : null;
                  return (
                    <div key={idx} className="p-3 rounded-lg border bg-card flex gap-3">
                      <div className="h-9 w-9 rounded bg-primary/5 flex items-center justify-center shrink-0">
                        <GraduationCap className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between items-start gap-2">
                          <h5 className="text-xs font-bold truncate">{edu.school || edu.institute_name}</h5>
                          {(startYear || endYear) && (
                            <span className="text-[9px] font-bold text-muted-foreground whitespace-nowrap shrink-0">
                              {startYear || ''} - {endYear || ''}
                            </span>
                          )}
                        </div>
                        {(edu.degree || edu.field_of_study) && (
                          <p className="text-xs text-muted-foreground truncate">
                            {[edu.degree, edu.field_of_study].filter(Boolean).join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Certifications & Languages */}
          {(certifications.length > 0 || languages.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {certifications.length > 0 && (
                <Section title="Certifications" icon={Award}>
                  <div className="flex flex-wrap gap-1.5">
                    {certifications.map((cert: any, idx: number) => (
                      <Badge key={idx} variant="outline" className="text-xs font-semibold px-2 py-0.5 border-primary/20 bg-primary/5 text-primary">
                        {typeof cert === 'string' ? cert : cert.name || 'Certification'}
                      </Badge>
                    ))}
                  </div>
                </Section>
              )}
              {languages.length > 0 && (
                <Section title="Languages" icon={Globe}>
                  <div className="flex flex-wrap gap-1.5">
                    {languages.map((lang: any, idx: number) => (
                      <Badge key={idx} variant="outline" className="text-xs font-semibold px-2 py-0.5">
                        {typeof lang === 'string' ? lang : lang.title || 'Language'}
                      </Badge>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}

          {/* Honors & Awards */}
          {honors.length > 0 && (
            <Section title="Honors & Awards" icon={Award}>
              <div className="space-y-3">
                {honors.map((award: any, idx: number) => (
                  <div key={idx} className="p-3 rounded-lg border bg-card/50 space-y-1">
                    <div className="flex justify-between items-start gap-2">
                      <h5 className="text-xs font-bold text-foreground">{award.title}</h5>
                      {award.issuer && <span className="text-[9px] font-bold text-muted-foreground shrink-0">{award.issuer}</span>}
                    </div>
                    {award.description && <p className="text-xs text-muted-foreground/90">{award.description}</p>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Location Details */}
          {location && (
            <Section title="Location" icon={MapPin}>
              <div className="p-4 rounded-lg border bg-card flex items-start gap-3">
                <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{location}</p>
                  {locConf.label && (
                    <p className={cn("text-xs flex items-center gap-1.5", locConf.color)}>
                      <span className={cn("h-2 w-2 rounded-full", locConf.dotColor)} />
                      {locConf.label} {locLabel && `(${locLabel})`}
                    </p>
                  )}
                </div>
              </div>
            </Section>
          )}

          {/* Fit Breakdown */}
          {fitBreakdownEntries.length > 0 && (
            <Section title="Match Score Breakdown">
              <div className="space-y-3 p-4 rounded-lg border bg-card">
                {fitBreakdownEntries.map(([key, value]) => {
                  const pct = typeof value === "number" ? toPctFitClient(value) : null;
                  return (
                    <div key={key} className="space-y-1.5">
                      <div className="flex justify-between text-xs font-bold uppercase tracking-tight">
                        <span className="text-muted-foreground">
                          {FIT_LABELS[key] || key.replace(/([A-Z])/g, " $1").trim()}
                        </span>
                        <span className="text-foreground">{pct != null ? `${pct}%` : String(value)}</span>
                      </div>
                      {pct != null && (
                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : "bg-red-400",
                            )}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          <Separator />

          <div className="text-[10px] text-muted-foreground uppercase tracking-widest flex flex-col gap-2 opacity-70">
            {c.freshness.lastEnrichedAt && (
              <p>{freshnessLabel("enriched")}: {new Date(c.freshness.lastEnrichedAt).toLocaleString()}</p>
            )}
            {c.crustdata?.metadata?.updated_at && (
              <p>Last Updated: {new Date(c.crustdata.metadata.updated_at).toLocaleString()}</p>
            )}
            <p>Candidate ID: {c.signalCandidateId}</p>
          </div>
        </div>
        </div>

        {/* Footer Actions (sticky — never scrolls) */}
        <div className="p-6 bg-muted/30 border-t flex gap-3 flex-wrap">
          {c.state === "new" && (
            <>
              <Button className="flex-1 shadow-md" onClick={() => onUpdateState(c.id, "shortlisted")} disabled={isUpdating}>
                <Star className="h-4 w-4 mr-2" />
                Shortlist Candidate
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => onUpdateState(c.id, "hidden")} disabled={isUpdating}>
                <EyeOff className="h-4 w-4 mr-2" />
                Hide
              </Button>
            </>
          )}

          {isShortlisted && (
            <>
              <Button variant="outline" className="flex-1 border-amber-300 text-amber-700 bg-amber-50" onClick={() => onUpdateState(c.id, "new")} disabled={isUpdating}>
                <Star className="h-4 w-4 mr-2 fill-amber-500 text-amber-500" />
                In Shortlist
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => onUpdateState(c.id, "hidden")} disabled={isUpdating}>
                <EyeOff className="h-4 w-4 mr-2" />
                Hide
              </Button>
            </>
          )}

          {isHidden && (
            <>
              <Button variant="outline" className="flex-1" onClick={() => onUpdateState(c.id, "new")} disabled={isUpdating}>
                <Eye className="h-4 w-4 mr-2" />
                Restore Candidate
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function IdentityBadge({
  status,
  confidence,
}: {
  status: string | null | undefined;
  confidence: number | null | undefined;
}) {
  if (!status) return null;
  const styles: Record<string, string> = {
    verified: "bg-green-100 text-green-800 border-green-200",
    review: "bg-amber-100 text-amber-800 border-amber-200",
    weak: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <Badge variant="outline" className={cn("text-xs font-semibold", styles[status] || "")}>
      {identityLabel(status)}
      {typeof confidence === "number" && confidence >= 0.5 && (
        <span className="ml-1 font-mono text-[10px]">{Math.round(confidence * 100)}%</span>
      )}
    </Badge>
  );
}
