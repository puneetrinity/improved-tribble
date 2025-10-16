import { useEffect } from "react";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import About from "@/components/About";
import Services from "@/components/Services";
import Industries from "@/components/Industries";
import Testimonials from "@/components/Testimonials";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";

const Home = () => {
  useEffect(() => {
    document.title = "VantaHire - Your Trusted Recruitment Partner";
    document.documentElement.classList.add("dark");
    
    // Apply gradient background to body
    document.body.classList.add("bg-gradient");
    
    return () => {
      document.body.classList.remove("bg-gradient");
    };
  }, []);

  return (
    <div className="min-h-screen text-white">
      <Header />
      <Hero />
      <About />
      <Services />
      <Industries />
      <Testimonials />
      <Contact />
      <Footer />
    </div>
  );
};

export default Home;
