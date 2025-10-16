import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

export default function Jobs() {
  const redirectToJobs = () => {
    window.location.href = "/careers";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <Header />
      
      {/* Jobs content */}
      <div className="pt-32 pb-16 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <h1 className="text-4xl md:text-6xl font-bold mb-6 animate-gradient-text">
            Current Job Openings
          </h1>
          
          <p className="text-xl text-white/80 mb-8 max-w-2xl mx-auto">
            Explore exciting career opportunities at VantaHire. Join our team and help shape the future of recruitment technology.
          </p>

          {/* Direct link to careers page */}
          <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-8 mb-8">
            <h2 className="text-2xl font-semibold text-white mb-4">
              View All Available Positions
            </h2>
            <p className="text-white/70 mb-6">
              Click below to access our complete careers portal with detailed job descriptions, requirements, and application process.
            </p>
            
            <Button 
              onClick={redirectToJobs}
              size="lg"
              className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:from-[#6D2EE8] hover:to-[#E64A97] text-white font-semibold px-8 py-3 rounded-full transition-all duration-300 hover:scale-105 shadow-lg"
            >
              <ExternalLink className="mr-2 h-5 w-5" />
              View Available Positions
            </Button>
          </div>


        </div>
      </div>
    </div>
  );
}