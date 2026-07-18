import { listDigestsAction } from "@/server/actions/intel-digest.actions";
import type { DigestRun } from "@/server/db/schema";

const STATUS_BADGE: Record<DigestRun["status"], { label: string; className: string }> = {
  ready: {
    label: "Ready",
    className: "bg-green-950/60 border border-green-900/50 text-green-400",
  },
  empty: {
    label: "Empty",
    className: "bg-neutral-800 border border-neutral-700 text-neutral-400",
  },
  failed: {
    label: "Failed",
    className: "bg-red-950/60 border border-red-900/50 text-red-400",
  },
};

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatPeriod(start: Date, end: Date): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function PageHeader() {
  return (
    <div className="flex items-center gap-3 px-6 pt-4 pb-4 border-b border-neutral-800">
      <h1 className="flex-1 text-xl font-semibold text-neutral-100">Daily Brief</h1>
    </div>
  );
}

export default async function DigestPage() {
  const result = await listDigestsAction({ limit: 20 });

  if ("error" in result) {
    return (
      <div className="flex flex-col bg-neutral-950 min-h-svh">
        <PageHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
          <p className="text-sm text-red-400">{result.error}</p>
        </div>
      </div>
    );
  }

  const [latest, ...previous] = result;

  if (!latest) {
    return (
      <div className="flex flex-col bg-neutral-950 min-h-svh">
        <PageHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
          <div className="w-96 max-w-full p-10 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col items-center gap-2">
            <h2 className="text-lg font-semibold text-neutral-100">No digests yet</h2>
            <p className="text-sm text-neutral-400">
              Daily briefs appear here once your tracked entities produce signals.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-neutral-950 min-h-svh">
      <PageHeader />

      <div className="space-y-5 p-5 max-w-3xl">
        <div className="p-5 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-neutral-500">
              {formatPeriod(latest.periodStart, latest.periodEnd)}
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`px-2 py-1 rounded-md text-xs font-medium ${STATUS_BADGE[latest.status].className}`}
              >
                {STATUS_BADGE[latest.status].label}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-400">
                {latest.signalCount} signals
              </span>
            </div>
          </div>

          {latest.output ? (
            <>
              <h2 className="text-lg font-semibold text-neutral-100">
                {latest.output.headline}
              </h2>

              {latest.output.sections.map((section) => (
                <div key={section.heading} className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-neutral-200">{section.heading}</h3>
                  <ul className="flex flex-col gap-1.5 list-disc list-inside">
                    {section.bullets.map((bullet, i) => (
                      <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: bullet text can repeat
                        key={i}
                        className="text-sm text-neutral-400"
                      >
                        {bullet.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {latest.output.suggestedActions.length > 0 ? (
                <div className="flex flex-col gap-2 pt-2 border-t border-neutral-800">
                  <h3 className="text-sm font-medium text-neutral-200">Suggested actions</h3>
                  <ul className="flex flex-col gap-1.5 list-disc list-inside">
                    {latest.output.suggestedActions.map((action, i) => (
                      <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: action text can repeat
                        key={i}
                        className="text-sm text-neutral-400"
                      >
                        {action.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-neutral-400">
              {latest.errorMessage ?? "No content was generated for this period."}
            </p>
          )}
        </div>

        {previous.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-neutral-100 text-sm font-medium">Previous digests</span>
            {previous.map((digest) => (
              <div
                key={digest.id}
                className="p-3 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center gap-3"
              >
                <span className="flex-1 text-sm text-neutral-300">
                  {formatPeriod(digest.periodStart, digest.periodEnd)}
                </span>
                <span
                  className={`px-2 py-1 rounded-md text-xs font-medium ${STATUS_BADGE[digest.status].className}`}
                >
                  {STATUS_BADGE[digest.status].label}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-400">
                  {digest.signalCount} signals
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
