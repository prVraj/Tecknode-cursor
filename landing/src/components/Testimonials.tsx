import Container from "./Container";
import Reveal from "./Reveal";
import dp from "../assets/testimonials/dp.png";
import person01 from "../assets/testimonials/person-01.png";
import person02 from "../assets/testimonials/person-02.png";
import person03 from "../assets/testimonials/person-03.png";
import person04 from "../assets/testimonials/person-04.png";
import person05 from "../assets/testimonials/person-05.png";
import person06 from "../assets/testimonials/person-06.png";

const featured = {
  quote:
    "Tecknode caught a Google AI Overview citation drop three days before we saw the traffic hit — that alone paid for the year.",
  name: "Kabir Anand",
  role: "Head of SEO, Loop Metrics",
  photo: dp,
};

const testimonials = [
  {
    quote:
      "We finally have one dashboard for rankings, AI citations, and brand mentions instead of five spreadsheets.",
    name: "Marco Field",
    role: "Growth Lead",
    company: "Fenlight",
    logoInitial: "F",
    logoColor: "#f59e0b",
    photo: person05,
  },
  {
    quote:
      "Ask Intel answers 'what broke this week' faster than our analyst could pull the report.",
    name: "Dana Whitfield",
    role: "Founder & CEO",
    company: "Whitfield Labs",
    logoInitial: "W",
    logoColor: "#3b82f6",
    photo: person04,
  },
  {
    quote:
      "Catching a lookalike domain phishing our checkout page the same week it registered was huge for us.",
    name: "Owen Castillo",
    role: "Head of Brand",
    company: "Castworks",
    logoInitial: "C",
    logoColor: "#f43f5e",
    photo: person01,
  },
  {
    quote:
      "The daily brief lands in Slack, so nobody has to log in to know if we moved up or down.",
    name: "Selene Marchetti",
    role: "Marketing Director",
    company: "Marchetti & Co",
    logoInitial: "M",
    logoColor: "#8b5cf6",
    photo: person06,
  },
  {
    quote:
      "We caught a competitor's pricing change and shipped a counter-offer before their launch email even went out.",
    name: "Theo Bramwell",
    role: "Founder & Product Lead",
    company: "Bramline",
    logoInitial: "B",
    logoColor: "#10b981",
    photo: person03,
  },
  {
    quote:
      "Tecknode flagged a ranking drop on our top page within hours — we fixed it before the weekend traffic dip.",
    name: "Ivy Sokolova",
    role: "Head of Growth",
    company: "Sokol Growth",
    logoInitial: "S",
    logoColor: "#fb923c",
    photo: person02,
  },
];

function TestimonialCard({ t }: { t: (typeof testimonials)[number] }) {
  return (
    <div className="flex h-full w-[22rem] shrink-0 flex-col justify-between rounded-2xl border border-white/10 bg-[var(--color-surface)] p-6">
      <p className="text-sm leading-relaxed text-white/85">"{t.quote}"</p>
      <div className="mt-6 flex items-center gap-3">
        <div className="flex items-center">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: t.logoColor }}
          >
            {t.logoInitial}
          </div>
          <div className="-ml-3 h-9 w-9 overflow-hidden rounded-full border-2 border-[var(--color-surface)]">
            <img src={t.photo} alt={t.name} className="h-full w-full object-cover" />
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{t.name}</p>
          <p className="text-xs text-[var(--color-muted)]">{t.role}</p>
        </div>
      </div>
    </div>
  );
}

export default function Testimonials() {
  const row = [...testimonials, ...testimonials];

  return (
    <section className="border-t border-white/5 py-24">
      <Container>
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-2xl font-bold leading-relaxed text-white md:text-3xl">
              "{featured.quote}"
            </p>
            <div className="mt-6 flex flex-col items-center">
              <div className="h-14 w-14 overflow-hidden rounded-full border-2 border-white/80">
                <img
                  src={featured.photo}
                  alt={featured.name}
                  className="h-full w-full object-cover"
                />
              </div>
              <p className="mt-3 text-sm font-semibold text-white">{featured.name}</p>
              <p className="text-sm text-[var(--color-muted)]">{featured.role}</p>
            </div>
          </div>
        </Reveal>
      </Container>

      <Reveal delay={100}>
        <div
          className="relative mt-16 overflow-hidden"
          style={{
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
            maskImage:
              "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
          }}
        >
          <div className="flex w-max animate-marquee gap-6">
            {row.map((t, i) => (
              <TestimonialCard key={`${t.name}-${i}`} t={t} />
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
