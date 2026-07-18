import { ArrowRight, Mail } from "lucide-react";
import Container from "./container";
import Reveal from "./reveal";

export default function FinalCTA() {
  return (
    <section className="bg-landing-grid border-t border-white/5 py-28 text-center">
      <Container>
        <Reveal>
          <h2 className="mx-auto max-w-2xl text-4xl font-bold tracking-tight md:text-5xl">
            Stop finding out about ranking & AI-visibility drops too late
          </h2>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#pricing"
              className="flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
            >
              Start Tracking Free
              <ArrowRight size={16} />
            </a>
            <a
              href="mailto:hello@tecknode.app"
              className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              <Mail size={16} />
              Contact us
            </a>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
