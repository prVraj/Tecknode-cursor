import { Radar, Send, Sparkles } from "lucide-react";
import Container from "./Container";
import SectionLabel from "./SectionLabel";
import Reveal from "./Reveal";

const steps = [
  {
    icon: Radar,
    title: "Track your brand & competitors",
    description:
      "Add your primary brand and competitors, plus target keywords and locations. No onboarding wizard and no calendar connection required to get started.",
  },
  {
    icon: Sparkles,
    title: "64 signals run around the clock",
    description:
      "Tecknode continuously checks 32 SEO, 25 GEO, and 7 mentions & brand-protection capabilities — from rankings to AI citations to lookalike domains.",
  },
  {
    icon: Send,
    title: "Get a brief, or just ask",
    description:
      "A daily or weekly digest lands in your inbox and in Slack, Telegram, or Discord. Or ask Intel a question and get a grounded answer with sources.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-white/5 py-24">
      <Container>
        <Reveal>
          <SectionLabel>How it works</SectionLabel>
          <h2 className="mx-auto mt-3 max-w-lg text-center text-4xl font-bold tracking-tight md:text-5xl">
            From blind spots to signal in minutes
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {steps.map((step, i) => (
            <Reveal key={step.title} delay={i * 120}>
              <div className="h-full rounded-2xl border border-white/10 bg-[var(--color-surface)] p-8 transition-colors hover:border-white/20">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-white">
                  <step.icon size={22} />
                </div>
                
                <h3 className="mt-2 text-lg font-semibold text-white">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">
                  {step.description}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
