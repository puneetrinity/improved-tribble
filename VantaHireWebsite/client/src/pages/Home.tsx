import HomepageNav from "@/components/HomepageNav";
import Hero from "@/components/Hero";
import ThreeLayers from "@/components/ThreeLayers";
import FeaturesGrid from "@/components/FeaturesGrid";
import Cta from "@/components/Cta";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
import { Helmet } from "react-helmet-async";

const Home = () => {
  return (
    <>
      <Helmet>
        <title>VantaHire — AI-Native Recruiting Platform | Human Decisions, AI Acceleration</title>
        <meta name="description" content="The AI-native recruiting platform for startups and agencies. AI candidate sourcing, WhatsApp outreach, client portal, and pipeline management. Start free." />
        <link rel="canonical" href="https://vantahire.com/" />
        <meta property="og:title" content="VantaHire — AI-Native Recruiting Platform | Human Decisions, AI Acceleration" />
        <meta property="og:description" content="The AI-native recruiting platform for startups and agencies. AI candidate sourcing, WhatsApp outreach, client portal, and pipeline management. Start free." />
        <meta property="og:url" content="https://vantahire.com/" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://vantahire.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="VantaHire — AI-Native Recruiting Platform | Human Decisions, AI Acceleration" />
        <meta name="twitter:description" content="The AI-native recruiting platform for startups and agencies. AI candidate sourcing, WhatsApp outreach, client portal, and pipeline management. Start free." />
        <meta name="twitter:image" content="https://vantahire.com/twitter-image.jpg" />
      </Helmet>
      <div className="font-dm leading-normal bg-hr-bg text-hr-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />
          <Hero />
          <ThreeLayers />
          <FeaturesGrid />
          <Cta />
          <HomepageFooter />
        </div>
      </div>
    </>
  );
};

export default Home;
