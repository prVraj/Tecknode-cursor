import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Nav from "@/components/landing/nav";
import Hero from "@/components/landing/hero";
import TrustedBy from "@/components/landing/trusted-by";
import HowItWorks from "@/components/landing/how-it-works";
import Features from "@/components/landing/features";
import Pricing from "@/components/landing/pricing";
import Testimonials from "@/components/landing/testimonials";
import FAQ from "@/components/landing/faq";
import FinalCTA from "@/components/landing/final-cta";
import Footer from "@/components/landing/footer";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Tecknode — SEO, GEO & brand signals in one feed",
  description:
    "Tecknode tracks your brand and competitors across SEO, AI search (GEO), and brand mentions — then turns 64 signals into a daily brief you can act on.",
};

export default function Home() {
  return (
    <div className={`${inter.className} min-h-screen bg-black text-white`}>
      <Nav />
      <main>
        <Hero />
        <TrustedBy />
        <HowItWorks />
        <Features />
        <Pricing />
        <Testimonials />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
