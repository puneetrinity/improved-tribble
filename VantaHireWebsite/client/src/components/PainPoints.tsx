import { Clock, Shuffle, Search, UserX, ArrowRight } from "lucide-react";

const painPoints = [
  {
    icon: <Search className="w-6 h-6 text-red-400" />,
    text: "Spending hours searching LinkedIn and writing Boolean queries"
  },
  {
    icon: <Shuffle className="w-6 h-6 text-red-400" />,
    text: "Switching between tools — ATS, sourcing platform, outreach tool, spreadsheets"
  },
  {
    icon: <Clock className="w-6 h-6 text-red-400" />,
    text: "Waiting days for client feedback buried in email chains"
  },
  {
    icon: <UserX className="w-6 h-6 text-red-400" />,
    text: "Losing good candidates because you responded too slowly"
  }
];

const PainPoints = () => {
  return (
    <section className="pt-20 pb-8 relative z-10">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-12 text-center">
            Recruiting today is broken.
          </h2>

          {/* Pain Points List */}
          <div className="max-w-xl mx-auto">
            <div className="space-y-5 mb-8">
              {painPoints.map((point, index) => (
                <div
                  key={index}
                  className="flex items-start gap-4 text-lg text-[var(--text-secondary)]"
                >
                  <span className="flex-shrink-0 mt-1">{point.icon}</span>
                  <span>{point.text}</span>
                </div>
              ))}
            </div>

            {/* Transition */}
            <p className="text-[var(--text-muted)] mb-6">
              The result: slow hiring, lost candidates, and recruiter burnout.
            </p>

            {/* Contrast */}
            <a
              href="/features"
              className="inline-flex items-center gap-3 text-xl font-semibold group cursor-pointer hover:opacity-80 transition-opacity"
              onClick={(e) => { e.preventDefault(); window.location.href = '/features'; }}
            >
              <ArrowRight className="w-6 h-6 text-primary" />
              <span className="gradient-text-purple">See how VantaHire fixes this.</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PainPoints;
