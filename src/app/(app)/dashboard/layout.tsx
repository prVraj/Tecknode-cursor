import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "@/lib/auth";
import {
  listSignalsAction,
  listTrackedEntitiesAction,
} from "@/server/actions/intel.actions";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }

  const [entitiesRes, signalsRes] = await Promise.all([
    listTrackedEntitiesAction(),
    listSignalsAction({ since: new Date(Date.now() - 7 * DAY_MS), limit: 200 }),
  ]);

  const competitorCount =
    "error" in entitiesRes
      ? 0
      : entitiesRes.filter((e) => e.role === "competitor").length;
  const criticalCount =
    "error" in signalsRes
      ? 0
      : signalsRes.filter((s) => s.severity === "p0").length;

  return (
    <SidebarProvider>
      <AppSidebar
        user={session.user}
        badges={{ criticalCount, competitorCount }}
      />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
