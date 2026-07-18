import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="text-sm font-semibold text-neutral-100">
            Signals
          </Link>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/dashboard">
                Open app
                <ArrowRight />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-20">
        <section className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <p className="mb-4 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-400">
            Marketing intelligence platform
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-neutral-50 sm:text-5xl">
            Know what changed before your competitors do
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-neutral-400 sm:text-lg">
            Monitor rankings, track competitor moves, and catch brand signals
            across search and AI — all in one dashboard.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/dashboard">
                Go to dashboard
                <ArrowRight />
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="/dashboard/tracking">View tracking</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
