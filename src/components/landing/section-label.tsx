export default function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-center text-sm font-medium uppercase tracking-widest text-[var(--color-landing-muted)]">
      {children}
    </p>
  );
}
