import { Activity } from "lucide-react";
import Container from "./Container";
import SectionLabel from "./SectionLabel";
import Reveal from "./Reveal";

const stats = [
  {
    value: "64",
    description:
      "Signal capabilities monitored across SEO, GEO, and brand protection on every run.",
  },
  {
    value: "32",
    description:
      "SEO capabilities — rankings, indexing, technical health, and site structure.",
  },
  {
    value: "25",
    description:
      "GEO capabilities — how AI answer engines cite, mention, and rank your brand.",
  },
  {
    value: "7",
    description:
      "Mentions & brand-protection checks — lookalike domains, phishing, and trademark abuse.",
  },
];

export default function Features() {
  return (
    <section id="features" className="border-t border-white/5 py-24">
      <Container>
        <Reveal>
          <SectionLabel>Signals</SectionLabel>
          <h2 className="mx-auto mt-3 max-w-lg text-center text-4xl font-bold tracking-tight md:text-5xl">
            One feed for SEO, GEO & brand protection
          </h2>
        </Reveal>

        <div className="mx-auto mt-16 max-w-4xl">
          {stats.map((stat, i) => (
            <Reveal key={stat.value} delay={i * 100}>
              <div className="flex flex-col items-start justify-between gap-4 py-8 sm:flex-row sm:items-center">
                <div className="flex items-center gap-5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white">
                    <Activity size={20} strokeWidth={1.5} />
                  </div>
                  <p className="text-4xl font-bold tracking-tight text-white md:text-6xl">
                    {stat.value}
                  </p>
                </div>
                <p className="max-w-xs text-sm leading-relaxed text-[var(--color-muted)] sm:text-right">
                  {stat.description}
                </p>
              </div>
              {i < stats.length - 1 && (
                <div className="h-px w-full bg-white/5" />
              )}
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
