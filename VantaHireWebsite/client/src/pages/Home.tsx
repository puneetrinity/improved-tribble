// @charset "utf-8"
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
import CTA from "@/components/marketing/sections/CTA";
import HowItWorks from "@/components/marketing/sections/HowItWorks";
import HeroSection from "@/components/marketing/sections/HeroSection";
import Platform from "@/components/marketing/sections/Platform";
import ProblemSection from "@/components/marketing/sections/ProblemSection";
import Stats from "@/components/marketing/sections/Stats";
import { Helmet } from "react-helmet-async";

const Home = () => {
  return (
    <>
      <Helmet>
        <title>ealana | Discover, Memory, Flow</title>
        <meta name="description" content="The AI-native recruiting platform for startups and agencies. AI candidate sourcing, WhatsApp outreach, client portal, and pipeline management. Start free." />
        <link rel="canonical" href="https://ealana.com/" />
        <meta property="og:title" content="ealana | Discover, Memory, Flow" />
        <meta property="og:description" content="The AI-native recruiting platform for startups and agencies. AI candidate sourcing, WhatsApp outreach, client portal, and pipeline management. Start free." />
        <meta property="og:url" content="https://ealana.com/" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://ealana.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="ealana | Discover, Memory, Flow" />
        <meta name="twitter:description" content="The AI-native recruiting platform for startups and agencies. AI candidate sourcing, WhatsApp outreach, client portal, and pipeline management. Start free." />
        <meta name="twitter:image" content="https://ealana.com/twitter-image.jpg" />
      </Helmet>
      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />
          <HeroSection />
          <ProblemSection />
          <HowItWorks />
          <Platform />
          <Stats />
          <CTA />
          <HomepageFooter />
        </div>
      </div>
    </>
  );
};

export default Home;
