export default function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-center text-sm font-medium uppercase tracking-widest text-[var(--color-muted)]">
      {children}
    </p>
  );
}
