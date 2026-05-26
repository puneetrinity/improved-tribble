import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Home,
  Briefcase,
  Users,
  BarChart3,
  Settings,
  Plus,
  Search,
  FileText,
  Target,
  UserCheck
} from "lucide-react";

export default function QuickAccessBar() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  if (!user) return null;

  // Role-based navigation items
  const getNavItems = () => {
    if (user.role === 'recruiter' || user.role === 'super_admin') {
      return [
        {
          label: "Dashboard",
          icon: Home,
          path: "/recruiter-dashboard",
          shortcut: "D"
        },
        {
          label: "Post Job",
          icon: Plus,
          path: "/jobs/post",
          shortcut: "P",
          primary: true
        },
        {
          label: "Jobs",
          icon: Briefcase,
          path: "/jobs",
          shortcut: "J"
        },
        {
          label: "Consultants",
          icon: UserCheck,
          path: "/consultants",
          shortcut: "C"
        },
        {
          label: "Analytics",
          icon: BarChart3,
          path: "/analytics",
          shortcut: "A"
        },
      ];
    } else if (user.role === 'candidate') {
      return [
        {
          label: "Dashboard",
          icon: Home,
          path: "/my-dashboard",
          shortcut: "D"
        },
        {
          label: "Browse Jobs",
          icon: Search,
          path: "/jobs",
          shortcut: "B",
          primary: true
        },
        {
          label: "My Applications",
          icon: FileText,
          path: "/my-dashboard",
          shortcut: "M"
        },
      ];
    }
    return [];
  };

  const navItems = getNavItems();
  const isActive = (path: string) => location === path;

  // Admin-only settings link
  const showAdminSettings = user.role === 'super_admin';

  return (
    <div className="sticky top-0 z-50 border-b border-white/10 bg-gradient-to-r from-slate-900/95 via-[#111326]/95 to-slate-900/95 backdrop-blur-lg">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo/Brand */}
          <div className="flex items-center gap-2">
            <Target className="h-6 w-6 text-[#4B8EF0]" />
            <span className="text-white font-bold text-lg hidden sm:inline">ealana</span>
          </div>

          {/* Navigation Items */}
          <nav className="flex items-center gap-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);

              return (
                <Button
                  key={item.path}
                  onClick={() => setLocation(item.path)}
                  variant={active ? "default" : "ghost"}
                  size="sm"
                  className={`
                    ${active
                      ? "bg-[linear-gradient(135deg,#4B8EF0_0%,#34D17A_100%)] text-white"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                    }
                    ${item.primary ? "hidden sm:flex" : ""}
                    transition-all duration-200
                  `}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  <span className="hidden md:inline">{item.label}</span>
                  {/* Keyboard shortcut hint */}
                  {!active && (
                    <kbd className="hidden lg:inline ml-2 px-1.5 py-0.5 text-xs bg-white/10 rounded border border-white/20">
                      {item.shortcut}
                    </kbd>
                  )}
                </Button>
              );
            })}

            {/* Admin Settings */}
            {showAdminSettings && (
              <>
                <div className="w-px h-6 bg-white/20 mx-2" />
                <Button
                  onClick={() => setLocation("/admin/super")}
                  variant={isActive("/admin/super") ? "default" : "ghost"}
                  size="sm"
                  className={`
                    ${isActive("/admin/super")
                      ? "bg-gradient-to-r from-red-500 to-pink-500 text-white"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                    }
                  `}
                >
                  <Settings className="h-4 w-4 md:mr-2" />
                  <span className="hidden md:inline">Admin</span>
                </Button>
              </>
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}
