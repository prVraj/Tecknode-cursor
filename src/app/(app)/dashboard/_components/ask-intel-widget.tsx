import { Sparkles } from "lucide-react";
import Link from "next/link";

export function AskIntelWidget() {
  return (
    <div className="p-5 bg-neutral-900 rounded-2xl border border-neutral-800 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="size-9 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
          <Sparkles size={16} className="text-white" />
        </div>
        <div>
          <p className="text-neutral-100 text-sm font-medium">Ask Intel</p>
          <p className="text-neutral-500 text-xs">Grounded answers from your signals</p>
        </div>
      </div>

      <Link
        href="/dashboard/chat"
        className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-400 hover:bg-neutral-700 hover:text-neutral-300 transition-colors"
      >
        Ask me anything…
      </Link>
    </div>
  );
}
