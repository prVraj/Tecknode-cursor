"use client";

import {
  FileText,
  LayoutDashboard,
  MessageCircle,
  Plug,
  Settings,
  Target,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { MOCK_ENTITIES, MOCK_SIGNALS } from "@/lib/mock-dashboard-data";

const CRITICAL_COUNT = MOCK_SIGNALS.filter((s) => s.severity === "p0").length;
const COMPETITOR_COUNT = MOCK_ENTITIES.filter((e) => e.role === "competitor").length;

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, badge: CRITICAL_COUNT },
  { label: "Tracking", href: "/dashboard/tracking", icon: Target, badge: COMPETITOR_COUNT },
  { label: "Daily Brief", href: "/dashboard/digest", icon: FileText, badge: 0 },
  { label: "Integrations", href: "/dashboard/integrations", icon: Plug, badge: 0 },
  { label: "Ask Intel", href: "/dashboard/chat", icon: MessageCircle, badge: 0 },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, badge: 0 },
] as const;

// Placeholder until account-scoped auth (Task 2 of the migration plan) lands.
const MOCK_USER = {
  name: "Demo User",
  email: "demo@signals.dev",
};

export function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  // Close mobile sidebar on navigation
  useEffect(() => {
    setOpenMobile(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathname is the trigger; setOpenMobile is stable
  }, [pathname]);

  return (
    <Sidebar className="bg-[#0f0f0f] border-r border-neutral-800">
      <SidebarHeader className="p-3">
        <span className="text-sm font-semibold text-neutral-100">Signals</span>
      </SidebarHeader>

      <SidebarContent className="p-2">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="pt-1 gap-1">
              {NAV_ITEMS.map((item) => {
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                      className={`px-2 py-1.5 rounded-lg text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 data-[active=true]:bg-neutral-800 data-[active=true]:text-neutral-100 ${isActive ? "bg-neutral-800" : ""}`}
                    >
                      <Link href={item.href} className="flex items-center gap-2 w-full">
                        <Icon
                          size={16}
                          color={isActive ? "#ededed" : "#a3a3a3"}
                        />
                        <span
                          className={`flex-1 text-sm font-normal ${isActive ? "text-neutral-100" : "text-neutral-300"}`}
                        >
                          {item.label}
                        </span>
                        {item.badge > 0 ? (
                          <span className="px-1.5 py-0.5 rounded-md bg-neutral-700 text-[10px] font-medium text-neutral-200 leading-none">
                            {item.badge}
                          </span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-0 gap-2 pb-2">
        <div className="px-2">
          <div className="p-2 bg-neutral-900 rounded-xl border border-neutral-800 flex items-center gap-2">
            <div className="size-8 shrink-0 rounded-lg bg-neutral-700" />
            <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
              <span className="truncate text-neutral-100 text-sm font-medium">
                {MOCK_USER.name}
              </span>
              <span className="truncate text-neutral-400 text-xs font-normal leading-none">
                {MOCK_USER.email}
              </span>
            </div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
