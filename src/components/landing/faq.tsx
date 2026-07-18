"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import Container from "./container";
import SectionLabel from "./section-label";
import Reveal from "./reveal";

const faqs = [
  {
    question: "What's GEO, and why do I need to track it?",
    answer:
      "GEO — Generative Engine Optimization — measures how AI answer engines like ChatGPT, Perplexity, and AI Overviews cite, mention, and rank your brand. Tecknode runs 25 GEO capabilities alongside SEO so you see classic search and AI search in one place.",
  },
  {
    question: "Do I need to connect analytics to get value?",
    answer:
      "No. Tracking a brand and its competitors works immediately with zero integrations. Connecting GA4, Search Console, Ahrefs, or Semrush adds first-party data on top of what Tecknode already monitors.",
  },
  {
    question: "How is this different from a rank tracker?",
    answer:
      "Rank trackers stop at search position. Tecknode also watches AI citations, brand mentions, lookalike domains, phishing attempts, and trademark abuse — 64 capabilities in one signal feed.",
  },
  {
    question: "How do I get notified when something changes?",
    answer:
      "Daily or weekly briefs are delivered by email and broadcast to any connected Slack, Telegram, or Discord channel. You can also ask Intel directly for a grounded, cited answer any time.",
  },
  {
    question: "Is my data shared with anyone else?",
    answer:
      "No. Every tracked brand, signal, integration, and conversation belongs directly to your account — there are no shared organizations or workspaces to manage.",
  },
  {
    question: "Can I try it before connecting integrations or paying?",
    answer:
      "Yes. The Starter plan tracks one brand with weekly signal refreshes and email digests at no cost, so you can see real signals before upgrading.",
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="border-t border-white/5 py-24">
      <Container>
        <Reveal>
          <SectionLabel>FAQs</SectionLabel>
          <h2 className="mx-auto mt-3 max-w-lg text-center text-4xl font-bold tracking-tight md:text-5xl">
            Have any questions? We have answers!
          </h2>
        </Reveal>

        <div className="mx-auto mt-12 max-w-2xl space-y-3">
          {faqs.map((faq, i) => {
            const isOpen = openIndex === i;
            return (
              <Reveal key={faq.question} delay={i * 60}>
                <div className="rounded-xl border border-white/10 bg-[var(--color-landing-surface)]">
                  <button
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                  >
                    <span className="text-sm font-medium text-white md:text-base">
                      {faq.question}
                    </span>
                    <Plus
                      size={18}
                      className={`shrink-0 text-white/60 transition-transform ${
                        isOpen ? "rotate-45" : ""
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <p className="px-6 pb-5 text-sm leading-relaxed text-[var(--color-landing-muted)]">
                      {faq.answer}
                    </p>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
