import Image from "next/image";
import { ArrowRight, PlayCircle } from "lucide-react";
import Container from "./container";
import heroImage from "@/assets/landing/hero.png";

export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-40 pb-24 md:pt-48 md:pb-32">
      <div className="bg-landing-dot-grid absolute inset-0" />

      <Image
        src={heroImage}
        alt=""
        aria-hidden="true"
        className="animate-landing-float pointer-events-none absolute -top-4 right-[8%] hidden w-40 opacity-80 drop-shadow-[0_20px_40px_rgba(139,92,246,0.35)] sm:block md:right-[14%] md:w-56"
      />

      <Container className="relative flex flex-col items-center text-center">
        <h1 className="mt-6 max-w-4xl mx-auto text-5xl font-bold leading-[1.05] tracking-tight text-white md:text-7xl">
          AI Agents keep track of your Competitors
        </h1>

        <p className="mt-6 max-w-2xl mx-auto text-lg text-white/80 md:text-xl">
          Agents track your competitors 24/7 and ship a daily brief. Pricing diffs, launches, AI citation shifts, press wins, brand mentions
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href="#pricing"
            className="flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
          >
            Start Tracking Free
            <ArrowRight size={16} />
          </a>
          <a
            href="#how-it-works"
            className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            <PlayCircle size={16} />
            See how it works
          </a>
        </div>
      </Container>
    </section>
  );
}
