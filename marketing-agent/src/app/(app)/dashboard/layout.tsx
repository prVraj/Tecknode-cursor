import { AppSidebar } from "@/components/sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

// NOTE: session gating (auth.api.getSession + redirect) is deferred until
// Task 2 (authentication) of the migration plan lands. This layout renders
// unconditionally for the UI-shell pass.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
