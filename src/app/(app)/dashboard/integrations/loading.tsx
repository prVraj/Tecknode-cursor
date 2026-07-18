import { Skeleton } from "@/components/ui/skeleton";

export default function IntegrationsLoading() {
  return (
    <div className="flex flex-col bg-neutral-950 min-h-svh">
      <div className="flex flex-col gap-1 px-6 pt-4 pb-4 border-b border-neutral-800">
        <Skeleton className="h-6 w-32 bg-neutral-800" />
        <Skeleton className="h-4 w-64 bg-neutral-800" />
      </div>
      <div className="p-5 flex flex-col gap-3 max-w-3xl">
        <Skeleton className="h-56 w-full rounded-2xl bg-neutral-900" />
        <Skeleton className="h-56 w-full rounded-2xl bg-neutral-900" />
        <Skeleton className="h-40 w-full rounded-2xl bg-neutral-900" />
      </div>
    </div>
  );
}
