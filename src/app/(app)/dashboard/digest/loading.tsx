import { Skeleton } from "@/components/ui/skeleton";

export default function DigestLoading() {
  return (
    <div className="flex flex-col bg-neutral-950 min-h-svh">
      <div className="flex items-center gap-3 px-6 pt-4 pb-4 border-b border-neutral-800">
        <Skeleton className="h-6 w-28 bg-neutral-800" />
      </div>
      <div className="p-5 flex flex-col gap-5 max-w-3xl">
        <Skeleton className="h-64 w-full rounded-2xl bg-neutral-900" />
        <Skeleton className="h-16 w-full rounded-xl bg-neutral-900" />
      </div>
    </div>
  );
}
