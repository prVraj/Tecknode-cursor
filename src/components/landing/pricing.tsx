"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import Container from "./container";
import SectionLabel from "./section-label";
import Reveal from "./reveal";

type Plan = {
  name: string;
  description: string;
  priceMonthly: number | null;
  priceAnnual: number | null;
  priceLabel?: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
};

const plans: Plan[] = [
  {
    name: "Starter",
    description: "Best for tracking your first brand",
    priceMonthly: 0,
    priceAnnual: 0,
    features: [
      "Track 1 brand, no competitors",
      "Weekly signal refresh",
      "Email digest",
      "7-day signal history",
    ],
    cta: "Start for Free",
  },
  {
    name: "Pro",
    description: "Best for teams tracking competitors",
    priceMonthly: 29,
    priceAnnual: 23,
    features: [
      "1 brand + up to 5 competitors",
      "All 64 SEO, GEO & mentions signals",
      "Daily digest + Slack, Telegram & Discord",
      "Ask Intel grounded chat",
      "90-day signal history",
    ],
    cta: "Get Started",
    highlighted: true,
  },
  {
    name: "Enterprise",
    description: "Best for larger marketing teams",
    priceMonthly: null,
    priceAnnual: null,
    priceLabel: "Custom",
    features: [
      "Everything in Pro",
      "Unlimited competitors & keywords",
      "Custom data retention",
      "Dedicated onboarding & support",
    ],
    cta: "Contact Sales",
  },
];

export default function Pricing() {
  const [annual, setAnnual] = useState(true);

  return (
    <section id="pricing" className="border-t border-white/5 py-24">
      <Container>
        <Reveal>
          <SectionLabel>Pricing</SectionLabel>
          <h2 className="mx-auto mt-3 max-w-lg text-center text-4xl font-bold tracking-tight md:text-5xl">
            Simple plans to keep your team on track
          </h2>
        </Reveal>

        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={() => setAnnual(false)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              !annual ? "bg-white text-black" : "text-white/60 hover:text-white"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              annual ? "bg-white text-black" : "text-white/60 hover:text-white"
            }`}
          >
            Annually
          </button>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {plans.map((plan, i) => {
            const price = annual ? plan.priceAnnual : plan.priceMonthly;
            return (
              <Reveal key={plan.name} delay={i * 120} className="h-full">
              <div
                className={`flex h-full flex-col rounded-2xl border p-8 ${
                  plan.highlighted
                    ? "border-[var(--color-landing-accent)]/60 bg-[var(--color-landing-surface-2)] shadow-[0_0_0_1px_rgba(91,141,239,0.3)]"
                    : "border-white/10 bg-[var(--color-landing-surface)]"
                }`}
              >
                <p className="text-sm font-medium text-white/70">{plan.name}</p>
                <div className="mt-4 flex items-end gap-1">
                  {price !== null ? (
                    <>
                      <span className="text-4xl font-bold text-white">
                        {price === 0 ? "Free" : `$${price}`}
                      </span>
                      {price !== 0 && (
                        <span className="pb-1 text-sm text-[var(--color-landing-muted)]">
                          /mo
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-4xl font-bold text-white">
                      {plan.priceLabel}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-[var(--color-landing-muted)]">
                  {plan.description}
                </p>

                <ul className="mt-6 flex-1 space-y-3">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm text-white/85"
                    >
                      <Check
                        size={16}
                        className="mt-0.5 shrink-0 text-[var(--color-landing-accent)]"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                <a
                  href="#top"
                  className={`mt-8 rounded-lg px-5 py-2.5 text-center text-sm font-semibold transition-opacity hover:opacity-90 ${
                    plan.highlighted
                      ? "bg-white text-black"
                      : "border border-white/15 bg-white/5 text-white"
                  }`}
                >
                  {plan.cta}
                </a>
              </div>
              </Reveal>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
