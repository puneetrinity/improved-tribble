// @charset "utf-8"
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
import CTA from "@/components/marketing/sections/CTA";
import ShiftShowcase from "@/components/marketing/sections/ShiftShowcase";
import LoopHandoff from "@/components/marketing/sections/LoopHandoff";
import HeroSection from "@/components/marketing/sections/HeroSection";
import Stats from "@/components/marketing/sections/Stats";
import { Helmet } from "react-helmet-async";

const Home = () => {
  return (
    <>
      <Helmet>
        <title>ealana — The Neural OS for Talent</title>
        <meta name="description" content="ealana remembers every candidate, every search — so your next hire starts smarter than your last. The Neural OS for Talent. Start free." />
        <link rel="canonical" href="https://ealana.com/" />
        <meta property="og:title" content="ealana — The Neural OS for Talent" />
        <meta property="og:description" content="ealana remembers every candidate, every search — so your next hire starts smarter than your last. The Neural OS for Talent. Start free." />
        <meta property="og:url" content="https://ealana.com/" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://ealana.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="ealana — The Neural OS for Talent" />
        <meta name="twitter:description" content="ealana remembers every candidate, every search — so your next hire starts smarter than your last. The Neural OS for Talent. Start free." />
        <meta name="twitter:image" content="https://ealana.com/twitter-image.jpg" />
      </Helmet>
      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />
          <HeroSection />
          <ShiftShowcase />
          <LoopHandoff />
          <Stats />
          <CTA />
          <HomepageFooter />
        </div>
      </div>
    </>
  );
};

export default Home;
