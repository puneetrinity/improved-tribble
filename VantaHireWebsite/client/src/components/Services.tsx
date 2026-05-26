import { Database, Search, MessageSquare, Users, LayoutDashboard, Target, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const pillars = [
  {
    number: "01",
    icon: <Database className="w-7 h-7" />,
    iconBg: "bg-primary/20",
    iconColor: "text-primary",
    title: "Resume Intelligence",
    subtitle: "Your talent pool grows with every resume",
    description: "Search candidates using natural language â€” past applicants become findable and reusable for new roles.",
    anchor: "pillar-1"
  },
  {
    number: "02",
    icon: <Search className="w-7 h-7" />,
    iconBg: "bg-warning/20",
    iconColor: "text-warning",
    title: "AI Candidate Discovery",
    subtitle: "Ranked candidates in minutes, not days",
    description: "Fit scores, skill breakdowns, and identity confidence on every lead. No Boolean skills needed.",
    anchor: "pillar-2"
  },
  {
    number: "03",
    icon: <MessageSquare className="w-7 h-7" />,
    iconBg: "bg-green-500/20",
    iconColor: "text-green-400",
    title: "WhatsApp + Email Outreach",
    subtitle: "Reach candidates on the channel they check",
    description: "Native outreach with templates, automation, and a full audit trail. Built in, not bolted on.",
    anchor: "pillar-3"
  },
  {
    number: "04",
    icon: <Users className="w-7 h-7" />,
    iconBg: "bg-blue-500/20",
    iconColor: "text-blue-400",
    title: "Client Feedback Portal",
    subtitle: "Client feedback in hours, not days",
    description: "Share a shortlist via link. Clients review and respond with structured feedback â€” same day, not same week.",
    anchor: "pillar-4"
  },
  {
    number: "05",
    icon: <LayoutDashboard className="w-7 h-7" />,
    iconBg: "bg-purple-500/20",
    iconColor: "text-purple-400",
    title: "Recruiter Dashboard",
    subtitle: "One recruiter. Many open roles. Zero chaos.",
    description: "Daily priorities, bulk actions, and pipeline visibility across every job.",
    anchor: "pillar-5"
  },
  {
    number: "06",
    icon: <Target className="w-7 h-7" />,
    iconBg: "bg-gradient-to-br from-purple-500/15 to-amber-500/15",
    iconColor: "text-primary",
    title: "Job Command Center",
    subtitle: "Post, source, screen, outreach, and track",
    description: "One view per job. No tab-switching. No second tool.",
    anchor: "pillar-6"
  }
];

const Services = () => {
  return (
    <section id="features" className="py-24 relative z-10">
      <div className="container mx-auto px-4">
        {/* Platform Overview */}
        <div className="text-center mb-6">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Everything recruiters need. One platform.
          </h2>
          <p className="text-[var(--text-secondary)] text-lg max-w-2xl mx-auto mb-2">
            ealana brings AI sourcing, recruiter workflow, candidate outreach, and client collaboration into one operating system.
          </p>
          <p className="text-[var(--text-muted)] text-base max-w-xl mx-auto">
            Stop juggling tools. Start closing roles.
          </p>
        </div>

        {/* Link to Product */}
        <div className="text-center mb-16">
          <Button
            variant="ghost"
            onClick={() => window.location.href = '/features'}
            className="text-primary hover:text-primary/80"
          >
            See how it works
            <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
        </div>

        {/* Section Header */}
        <div className="text-center mb-12">
          <h3 className="text-2xl md:text-3xl font-bold text-white mb-4">
            The ealana Platform
          </h3>
        </div>

        {/* Pillars Grid â€” 6 cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {pillars.map((pillar, index) => (
            <div key={index} className="service-card relative">
              {/* Number Badge */}
              <div className="absolute top-6 right-6 text-4xl font-bold text-white/10">
                {pillar.number}
              </div>

              {/* Icon */}
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center mb-5 ${pillar.iconBg}`}>
                <span className={pillar.iconColor}>{pillar.icon}</span>
              </div>

              {/* Title & Subtitle */}
              <h4 className="text-xl font-bold text-white mb-1">{pillar.title}</h4>
              <p className="text-primary text-sm font-medium mb-3">{pillar.subtitle}</p>

              {/* Description */}
              <p className="text-[var(--text-secondary)] text-sm leading-relaxed mb-4">
                {pillar.description}
              </p>

              {/* Deep dive link per CONTENT-MAP.md */}
              <a
                href={`/features#${pillar.anchor}`}
                className="text-primary/70 text-sm hover:text-primary transition-colors inline-flex items-center gap-1"
                onClick={(e) => { e.preventDefault(); window.location.href = `/features#${pillar.anchor}`; }}
              >
                Learn more <ArrowRight className="w-3 h-3" />
              </a>
            </div>
          ))}
        </div>

        {/* CTA Links */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mt-12">
          <Button
            variant="outlinePurple"
            onClick={() => window.location.href = '/features'}
            className="rounded-full px-6 py-5"
          >
            See All Features
            <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => window.location.href = '/features'}
            className="text-white/70 hover:text-white"
          >
            Learn More About the Product
            <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
        </div>
      </div>
    </section>
  );
};

export default Services;
