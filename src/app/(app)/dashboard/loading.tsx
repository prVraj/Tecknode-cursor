import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col bg-neutral-950 min-h-svh">
      <div className="flex items-center gap-3 px-6 pt-4 pb-4 border-b border-neutral-800">
        <h1 className="flex-1 text-xl font-semibold text-neutral-100">Dashboard</h1>
        <Skeleton className="h-8 w-24 rounded-lg bg-neutral-900" />
      </div>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
            <Skeleton key={i} className="min-h-40 rounded-2xl bg-neutral-900" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Skeleton className="lg:col-span-2 h-80 rounded-2xl bg-neutral-900" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-44 rounded-2xl bg-neutral-900" />
            <Skeleton className="h-56 rounded-2xl bg-neutral-900" />
          </div>
        </div>
        <Skeleton className="h-64 rounded-2xl bg-neutral-900" />
      </div>
    </div>
  );
}
