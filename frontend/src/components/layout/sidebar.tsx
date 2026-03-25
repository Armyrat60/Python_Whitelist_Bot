"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Settings2,
  Sliders,
  Users,
  FileText,
  ArrowUpDown,
  List,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

const adminLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

const adminSectionLinks = [
  { href: "/dashboard/setup", label: "Setup", icon: Settings2 },
  { href: "/dashboard/settings", label: "Settings", icon: Sliders },
  { href: "/dashboard/users", label: "Users", icon: Users },
  { href: "/dashboard/audit", label: "Audit Log", icon: FileText },
  {
    href: "/dashboard/import-export",
    label: "Import / Export",
    icon: ArrowUpDown,
  },
];

const userLinks = [
  { href: "/my-whitelist", label: "My Whitelist", icon: List },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2 border-b border-zinc-800 px-4">
        <img src="/logo.png" alt="Squad Whitelister" className="h-8 w-8 rounded-lg" />
        <span className="text-sm font-semibold text-foreground">
          Squad Whitelister
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {adminLinks.map((link) => (
          <NavLink
            key={link.href}
            href={link.href}
            label={link.label}
            icon={link.icon}
            active={pathname === link.href}
          />
        ))}

        <div className="py-2">
          <Separator className="bg-zinc-800" />
          <p className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Admin
          </p>
        </div>

        {adminSectionLinks.map((link) => (
          <NavLink
            key={link.href}
            href={link.href}
            label={link.label}
            icon={link.icon}
            active={pathname === link.href}
          />
        ))}

        <div className="py-2">
          <Separator className="bg-zinc-800" />
        </div>

        {userLinks.map((link) => (
          <NavLink
            key={link.href}
            href={link.href}
            label={link.label}
            icon={link.icon}
            active={pathname === link.href}
          />
        ))}
      </nav>
    </aside>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-orange-500/10 text-orange-400 border-l-2 border-orange-500"
          : "text-muted-foreground hover:bg-zinc-900 hover:text-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}
