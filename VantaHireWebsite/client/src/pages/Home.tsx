import HomepageNav from "@/components/HomepageNav";
import Hero from "@/components/Hero";
import ThreeLayers from "@/components/ThreeLayers";
import FeaturesGrid from "@/components/FeaturesGrid";
import Cta from "@/components/Cta";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
import { Helmet } from "react-helmet-async";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/components.css";
import "@/styles/homepage.css";

const Home = () => {
  return (
    <>
      <Helmet>
        <title>VantaHire — AI-Powered Recruitment Infrastructure</title>
        <meta name="description" content="VantaHire is the ATS that understands who you're looking for. Level up your team with intelligent matching and seamless workflows. AI sourcing, WhatsApp outreach, client portal, and pipeline management in one platform." />
        <link rel="canonical" href="https://vantahire.com/" />
        <meta property="og:title" content="VantaHire — AI-Powered Recruitment Infrastructure" />
        <meta property="og:description" content="VantaHire is the ATS that understands who you're looking for. Level up your team with intelligent matching and seamless workflows." />
        <meta property="og:url" content="https://vantahire.com/" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://vantahire.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="VantaHire — AI-Powered Recruitment Infrastructure" />
        <meta name="twitter:description" content="VantaHire is the ATS that understands who you're looking for. Level up your team with intelligent matching and seamless workflows." />
        <meta name="twitter:image" content="https://vantahire.com/twitter-image.jpg" />
      </Helmet>
      <div className="homepage-redesign public-theme min-h-screen">
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
