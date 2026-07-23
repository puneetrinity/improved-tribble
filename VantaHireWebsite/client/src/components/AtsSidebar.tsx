import * as React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Organization, Membership } from "@/hooks/use-organization";
import { useSubscription } from "@/hooks/use-subscription";
import { cn } from "@/lib/utils";
import type { User as SelectUser } from "@shared/schema";
import type { LucideIcon } from "lucide-react";
import {
  ChevronRight,
  BarChart3,
  Briefcase,
  Building2,
  ChevronDown,
  CreditCard,
  FileText,
  Home,
  Inbox,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import ealanaMoth from "@/assets/ealana-moth (1).svg";
import { atsShellCopy } from "@/lib/internal-copy";

type NavItem = {
  label: string;
  path?: string;
  icon: LucideIcon;
  visible: boolean;
  active: boolean;
  onClick?: () => void;
  className?: string;
};

interface AtsSidebarProps {
  location: string;
  navigate: (path: string) => void;
  onLogout: () => void;
  user: SelectUser | null;
  organizationData: { organization: Organization; membership: Membership } | null | undefined;
  isRecruiter: boolean;
  isAdmin: boolean;
  isHiringManager: boolean;
  isCandidate: boolean;
  isOrgOwner: boolean;
  isOrgOwnerOrAdmin: boolean;
  displayName: string;
}

const matchesPath = (location: string, path: string) =>
  location === path || location.startsWith(`${path}/`);

const ORG_MANAGEMENT_STORAGE_KEY = "ats_sidebar_org_management_open";

export default function AtsSidebar({
  location,
  navigate,
  onLogout,
  user,
  organizationData,
  isRecruiter,
  isAdmin,
  isHiringManager,
  isCandidate,
  isOrgOwner,
  isOrgOwnerOrAdmin,
  displayName,
}: AtsSidebarProps) {
  const { state, isMobile, toggleSidebar } = useSidebar();
  const { data: subscription } = useSubscription();
  const isCollapsed = !isMobile && state === "collapsed";
  const [orgManagementOpen, setOrgManagementOpen] = React.useState(() => {
    if (typeof window === "undefined") return false;

    return window.localStorage.getItem(ORG_MANAGEMENT_STORAGE_KEY) === "true";
  });
  const [collapsedOrgOpen, setCollapsedOrgOpen] = React.useState(false);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ORG_MANAGEMENT_STORAGE_KEY, String(orgManagementOpen));
    }
  }, [orgManagementOpen]);

  React.useEffect(() => {
    setCollapsedOrgOpen(false);
  }, [location]);

  const mainItems: NavItem[] = [
    {
      label: atsShellCopy.routes.dashboard.label,
      path: isCandidate ? "/my-dashboard" : isHiringManager ? "/hiring-manager" : "/recruiter-dashboard",
      icon: Home,
      visible: isRecruiter || isAdmin || isHiringManager || isCandidate,
      active: isCandidate
        ? location === "/my-dashboard"
        : isHiringManager
        ? location === "/hiring-manager" || /^\/hiring-manager\/jobs\/\d+\/review/.test(location)
        : location === "/recruiter-dashboard",
    },
    {
      label: atsShellCopy.routes.applications.label,
      path: "/applications",
      icon: Inbox,
      visible: isRecruiter || isAdmin,
      active: matchesPath(location, "/applications"),
    },
    {
      label: atsShellCopy.routes.talentSearch.label,
      path: "/candidates",
      icon: Search,
      visible: isRecruiter || isAdmin,
      active: matchesPath(location, "/candidates"),
    },
    {
      label: atsShellCopy.routes.myJobs.label,
      path: "/my-jobs",
      icon: Briefcase,
      visible: isRecruiter || isAdmin,
      active:
        matchesPath(location, "/my-jobs") ||
        /^\/jobs\/\d+\/(applications|edit|pipeline|analytics|sourcing|bulk-import)/.test(location),
    },
    {
      label: atsShellCopy.routes.forms.label,
      path: "/admin/forms",
      icon: FileText,
      visible: isRecruiter || isAdmin,
      active: matchesPath(location, "/admin/forms"),
    },
    {
      label: atsShellCopy.routes.clients.label,
      path: "/clients",
      icon: Users,
      visible: isRecruiter || isAdmin,
      active: matchesPath(location, "/clients"),
    },
    {
      label: atsShellCopy.routes.email.label,
      path: "/admin/email-templates",
      icon: Sparkles,
      visible: isRecruiter || isAdmin,
      active: matchesPath(location, "/admin/email-templates"),
    },
    {
      label: atsShellCopy.routes.adminDashboard.label,
      path: "/admin",
      icon: Shield,
      visible: isAdmin,
      active: location === "/admin",
    },
    {
      label: atsShellCopy.routes.jobAnalytics.label,
      path: "/analytics",
      icon: BarChart3,
      visible: isAdmin,
      active: matchesPath(location, "/analytics"),
    },
  ];

  const accountItems: NavItem[] = [
    {
      label: atsShellCopy.routes.profileSettings.label,
      path: "/profile/settings",
      icon: Settings,
      visible: isRecruiter || isAdmin || isHiringManager,
      active: matchesPath(location, "/profile/settings"),
    },
    {
      label: atsShellCopy.routes.orgSettings.label,
      path: "/org/settings",
      icon: Building2,
      visible: !!organizationData && isOrgOwnerOrAdmin,
      active: matchesPath(location, "/org/settings"),
    },
    {
      label: atsShellCopy.routes.teamMembers.label,
      path: "/org/team",
      icon: Users,
      visible: !!organizationData && isOrgOwnerOrAdmin,
      active: matchesPath(location, "/org/team"),
    },
    {
      label: atsShellCopy.routes.billing.label,
      path: "/org/billing",
      icon: CreditCard,
      visible: !!organizationData && isOrgOwner,
      active: matchesPath(location, "/org/billing"),
    },
    {
      label: atsShellCopy.routes.organizationAnalytics.label,
      path: "/org/analytics",
      icon: BarChart3,
      visible: !!organizationData && isOrgOwnerOrAdmin,
      active: matchesPath(location, "/org/analytics"),
    },
    {
      label: atsShellCopy.routes.logout.label,
      icon: LogOut,
      visible: true,
      active: false,
      onClick: onLogout,
      className: "text-destructive hover:text-destructive",
    },
  ];

  const visibleMainItems = mainItems.filter((item) => item.visible);
  const visibleAccountItems = accountItems.filter((item) => item.visible);
  const profileSettingsItem = visibleAccountItems.find((item) => item.label === "Profile Settings");
  const orgManagementItems = visibleAccountItems.filter(
    (item) => item.label !== "Logout" && item.label !== "Profile Settings"
  );
  const logoutItem = visibleAccountItems.find((item) => item.label === atsShellCopy.routes.logout.label);
  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? user?.username?.[0] ?? "U"}`.toUpperCase();
  const accountSubtitle = user?.username ?? "";
  const currentPlanName = subscription?.plan?.displayName || "Free";
  const planName = subscription?.plan?.name?.toLowerCase();
  const shouldShowUpgradePlan = !planName || planName === "free";
  const organizationName = organizationData?.organization?.name?.replace(/VantaHire/gi, "ealana");

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[0_18px_50px_rgba(0,0,0,0.22)]"
    >
      <SidebarHeader className="gap-3 border-b border-sidebar-border bg-sidebar px-3 py-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3">
        <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl text-left transition-opacity hover:opacity-90 group-data-[collapsible=icon]:hidden"
          >
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-sidebar-border bg-[radial-gradient(circle_at_30%_30%,rgba(75,142,240,0.2),transparent_58%),radial-gradient(circle_at_70%_70%,rgba(52,209,122,0.16),transparent_62%),rgba(255,255,255,0.03)] shadow-[0_16px_34px_rgba(0,0,0,0.22)]">
              <img
                src={ealanaMoth}
                alt="ealana moth"
                className="h-9 w-9 object-contain drop-shadow-[0_0_18px_rgba(75,142,240,0.22)]"
              />
            </div>
            <div className="min-w-0 space-y-1 group-data-[collapsible=icon]:hidden">
              <div className="flex items-center gap-2">
                <div className="rounded-full border border-sidebar-border bg-[rgba(245,200,66,0.14)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#B8860B]">{atsShellCopy.brand.badge}</div>
              </div>
              {organizationName && (
                <div className="truncate text-[12px] font-medium text-sidebar-foreground/70">
                  {organizationName}
                </div>
              )}
            </div>
          </button>
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-sidebar-foreground/60 transition-colors hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-primary"
            aria-label={isCollapsed ? "Open sidebar" : "Collapse sidebar"}
            title={isCollapsed ? "Open sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent
        className={cn(
          "overflow-x-hidden bg-transparent px-0 py-3 group-data-[collapsible=icon]:overflow-hidden group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-2",
          orgManagementOpen ? "overflow-y-auto" : "overflow-hidden"
        )}
      >
        <SidebarGroup className="gap-2 p-0">
          <SidebarGroupLabel className="px-6 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
            {atsShellCopy.sections.workspace}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 group-data-[collapsible=icon]:gap-2">
              {visibleMainItems.map((item) => {
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      tooltip={item.label}
                      isActive={item.active}
                      onClick={() => item.path && navigate(item.path)}
                      className={cn(
                        "mx-2 h-10 rounded-2xl bg-transparent pl-6 pr-3 text-[13px] font-medium text-sidebar-foreground/70 transition-colors duration-100 ease-out hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground",
                        "group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:h-11 group-data-[collapsible=icon]:w-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-xl group-data-[collapsible=icon]:px-0",
                        "group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:hover:bg-sidebar-accent group-data-[collapsible=icon]:data-[active=true]:bg-sidebar-accent",
                        "group-data-[collapsible=icon]:text-sidebar-foreground/70 group-data-[collapsible=icon]:hover:text-sidebar-foreground group-data-[collapsible=icon]:data-[active=true]:text-sidebar-primary",
                        "[&>span]:transition-opacity [&>span]:duration-150 group-data-[collapsible=icon]:[&>span]:opacity-0",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 group-data-[collapsible=icon]:m-0" />
                      <span className="min-w-0 truncate">
                        <span>{item.label}</span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="mx-0 my-3 bg-sidebar-border" />

        {orgManagementItems.length > 0 && (
          isCollapsed ? (
            <SidebarGroup className="p-0">
              <SidebarGroupContent>
                <DropdownMenu open={collapsedOrgOpen} onOpenChange={setCollapsedOrgOpen}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl text-sidebar-foreground/70 transition-colors duration-200 hover:bg-sidebar-accent hover:text-sidebar-primary"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="right" align="center">
                      Org Management
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent
                    align="end"
                    side="right"
                    sideOffset={12}
                    className="w-60 rounded-xl border-sidebar-border bg-sidebar p-2 text-sidebar-foreground"
                  >
                    <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/50">
                      Org Management
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {orgManagementItems.map((item) => {
                      const Icon = item.icon;

                      return (
                        <DropdownMenuItem
                          key={item.label}
                          onClick={item.onClick ?? (() => item.path && navigate(item.path))}
                          className="cursor-pointer rounded-lg px-2 py-2 text-[13px] font-medium text-sidebar-foreground/70 focus:bg-sidebar-accent focus:text-sidebar-primary"
                        >
                          <Icon className="mr-2 h-4 w-4" />
                          <span>{item.label}</span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : (
            <SidebarGroup className="gap-1 p-0">
              <button
                type="button"
                onClick={() => setOrgManagementOpen((open) => !open)}
                className="mx-2 flex h-10 w-[calc(100%-1rem)] items-center justify-between rounded-2xl bg-transparent pl-6 pr-3 text-left transition-colors duration-100 ease-out hover:bg-sidebar-accent/70"
              >
                <span className="text-[13px] font-medium text-sidebar-foreground/70">{atsShellCopy.menu.organizationManagement}</span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-sidebar-foreground/60 transition-transform duration-150 ease-out",
                    orgManagementOpen && "rotate-180 text-sidebar-primary"
                  )}
                />
              </button>

              {orgManagementOpen && (
                <SidebarGroupContent>
                  <SidebarMenu className="gap-1 pb-1">
                    {orgManagementItems.map((item) => {
                      const Icon = item.icon;

                      return (
                        <SidebarMenuItem key={item.label}>
                          <SidebarMenuButton
                            tooltip={item.label}
                            isActive={item.active}
                            onClick={item.onClick ?? (() => item.path && navigate(item.path))}
                            className="mx-2 h-10 rounded-2xl bg-transparent pl-6 pr-3 text-[13px] font-medium text-sidebar-foreground/70 transition-colors duration-100 ease-out hover:bg-sidebar-accent/70 hover:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span>{item.label}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          )
        )}
      </SidebarContent>

      <SidebarFooter className="mt-auto gap-2 bg-sidebar px-0 py-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <div className="w-full">
          <div className="mb-2 h-px w-full bg-sidebar-border" />
          <div className="overflow-hidden transition-all duration-200">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "mx-2 flex h-12 w-[calc(100%-1rem)] items-center gap-3 rounded-2xl border border-transparent bg-sidebar-accent/70 pl-4 pr-2 text-left shadow-[0_10px_24px_rgba(0,0,0,0.14)] transition-colors duration-200 hover:border-sidebar-border hover:bg-sidebar-accent",
                    isCollapsed && "mx-auto h-11 w-11 justify-center rounded-2xl px-0 hover:bg-sidebar-accent"
                  )}
                  title={profileSettingsItem?.label ?? "Profile Settings"}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                    <div className="truncate text-sm font-semibold text-sidebar-foreground">{displayName}</div>
                    <div className="truncate text-xs text-sidebar-foreground/60">{accountSubtitle}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side={isCollapsed ? "right" : "top"} sideOffset={12} className="w-60 rounded-xl border-sidebar-border bg-sidebar p-2 text-sidebar-foreground">
                {profileSettingsItem && (
                  <DropdownMenuItem
                    onClick={() => profileSettingsItem.path && navigate(profileSettingsItem.path)}
                    className="cursor-pointer rounded-lg px-2 py-2 text-[13px] font-medium text-sidebar-foreground/70 focus:bg-sidebar-accent focus:text-sidebar-foreground"
                  >
                    <Settings className="mr-2 h-4 w-4" />
                    <span>{profileSettingsItem.label}</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuLabel className="px-2 py-2 text-[12px] font-medium text-sidebar-foreground/60">
                  Current Plan :- {currentPlanName}
                </DropdownMenuLabel>
                {shouldShowUpgradePlan && (
                  <DropdownMenuItem
                    onClick={() => navigate("/pricing")}
                    className="cursor-pointer rounded-lg px-2 py-2 text-[13px] font-medium text-sidebar-foreground/70 focus:bg-sidebar-accent focus:text-sidebar-foreground"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    <span>Upgrade Plan</span>
                  </DropdownMenuItem>
                )}
                {logoutItem && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={logoutItem.onClick}
                      className="cursor-pointer rounded-lg px-2 py-2 text-[13px] font-medium text-destructive focus:bg-destructive/10 focus:text-destructive"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>{logoutItem.label}</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail className="after:bg-sidebar-border" />
    </Sidebar>
  );
}
