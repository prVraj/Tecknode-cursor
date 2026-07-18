import Container from "./Container";

const socials = [
  { icon: "linkedin-outline-icon", href: "#", label: "LinkedIn" },
  { icon: "instagram-outline-icon", href: "#", label: "Instagram" },
  { icon: "x-outline-icon", href: "#", label: "X" },
];

const links = [
  { label: "Home", href: "#top" },
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
];

export default function Footer() {
  return (
    <footer className="overflow-hidden rounded-t-3xl bg-[var(--color-surface)] px-6 pt-10">
      <Container>
        <div className="flex flex-col justify-between gap-10 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-medium text-white/50">Socials</p>
            <div className="mt-4 flex gap-3">
              {socials.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 text-white/80 transition-colors hover:border-white/30 hover:text-white"
                >
                  <svg width="16" height="16" aria-hidden="true">
                    <use href={`/icons.svg#${s.icon}`} />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          <div className="sm:text-right">
            <p className="text-xs font-medium text-white/50">Quick links</p>
            <div className="mt-4 flex flex-col gap-2">
              {links.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="text-sm text-white/70 transition-colors hover:text-white"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-white/10" />

        <p className="text-fade-vertical -mb-6 select-none text-center text-[19vw] font-medium leading-[0.85] tracking-tight sm:text-[9rem]">
          Tecknode
        </p>
      </Container>
    </footer>
  );
}
