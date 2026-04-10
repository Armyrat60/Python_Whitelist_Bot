"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  Users,
  List,
  Settings2,
  Settings,
  ChevronsUpDown,
  Check,
  BookUser,
  Sprout,
  Trophy,
  ArrowUpDown,
  Search,
  AlertTriangle,
  Globe,
  ChevronRight,
  LogOut,
  History,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useGuild } from "@/hooks/use-guild";
import { useSession } from "@/hooks/use-session";

// ─── Link definitions ────────────────────────────────────────────────────────

const dashboardLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/search", label: "Search", icon: Search },
  { href: "/dashboard/conflicts", label: "Conflicts", icon: AlertTriangle },
  { href: "/dashboard/logs", label: "Logs", icon: History },
];

const whitelistLinks = [
  { href: "/dashboard/users", label: "Discord Roster", icon: Users },
  { href: "/dashboard/manual-roster", label: "Manual Roster", icon: BookUser },
  { href: "/dashboard/config", label: "Configuration", icon: Settings2 },
];

const seedingLinks = [
  { href: "/dashboard/seeding", label: "Dashboard", icon: Sprout },
  { href: "/dashboard/seeding/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/dashboard/seeding/settings", label: "Configuration", icon: Settings2 },
];

const serverLinks = [
  { href: "/dashboard/servers", label: "Live Dashboard", icon: Radio },
];

const toolLinks = [
  { href: "/dashboard/import-export", label: "Import / Export", icon: ArrowUpDown },
];

const publicLinks = [
  { href: "/my-whitelist", label: "My Whitelist", icon: List },
  { href: "/seeding/leaderboard", label: "Seeding Leaderboard", icon: Trophy },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COLLAPSED_KEY = "sidebar_collapsed_v1";

function loadCollapsed(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCollapsed(state: Record<string, boolean>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(state));
  } catch {}
}

function guildIconUrl(guildId: string, icon: string | null) {
  if (!icon) return null;
  if (icon.startsWith("http")) return icon;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.webp?size=64`;
}

function avatarUrl(userId: string, avatar: string) {
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.webp?size=64`;
}

// ─── Guild Switcher ──────────────────────────────────────────────────────────

function SidebarGuildCard() {
  const { activeGuild, guilds, switchGuild } = useGuild();
  const [open, setOpen] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const prevGuildId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (prevGuildId.current !== undefined && prevGuildId.current !== activeGuild?.id) {
      setFlashing(false);
      requestAnimationFrame(() => setFlashing(true));
    }
    prevGuildId.current = activeGuild?.id;
  }, [activeGuild?.id]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>
        <div
          onAnimationEnd={() => setFlashing(false)}
          className={cn(
            "mx-3 mt-3 mb-1 flex cursor-pointer items-center gap-3 rounded-lg border border-white/[0.08] px-3 py-2.5 transition-colors hover:border-white/[0.15] hover:bg-white/[0.04]",
            flashing && "guild-switch-flash"
          )}
        >
          <Avatar>
            <AvatarImage
              src={guildIconUrl(activeGuild?.id ?? "", activeGuild?.icon ?? null) ?? undefined}
              alt={activeGuild?.name ?? ""}
            />
            <AvatarFallback className="text-xs font-bold">
              {activeGuild?.name?.slice(0, 2).toUpperCase() ?? "??"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-semibold text-white/90 leading-tight">
              {activeGuild?.name ?? "Select server"}
            </p>
            <p className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--accent-primary)" }}>
              Active Server
            </p>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-white/50" />
        </div>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="w-56 p-0">
        <Command>
          <CommandInput placeholder="Search server..." />
          <CommandList>
            <CommandEmpty>No servers found.</CommandEmpty>
            <CommandGroup>
              {guilds.map((guild) => (
                <CommandItem
                  key={guild.id}
                  data-checked={guild.id === activeGuild?.id || undefined}
                  onSelect={() => {
                    switchGuild(guild.id);
                    setOpen(false);
                  }}
                >
                  <Avatar size="sm">
                    <AvatarImage
                      src={guildIconUrl(guild.id, guild.icon) ?? undefined}
                      alt={guild.name}
                    />
                    <AvatarFallback className="text-xs">
                      {guild.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{guild.name}</span>
                  {guild.id === activeGuild?.id && (
                    <Check className="ml-auto h-3.5 w-3.5 shrink-0" style={{ color: "var(--accent-primary)" }} />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Collapsible Section ─────────────────────────────────────────────────────

function CollapsibleSection({
  label,
  sectionKey,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  sectionKey: string;
  collapsed: Record<string, boolean>;
  onToggle: (key: string) => void;
  children: React.ReactNode;
}) {
  const isCollapsed = collapsed[sectionKey] ?? false;

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(sectionKey)}
        className="flex w-full items-center gap-1 pt-4 pb-1 px-3 group"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 transition-transform duration-150",
            !isCollapsed && "rotate-90"
          )}
          style={{ color: "color-mix(in srgb, var(--accent-primary) 50%, var(--muted-foreground, #9CA3AF))" }}
        />
        <p
          className="text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: "color-mix(in srgb, var(--accent-primary) 50%, var(--muted-foreground, #9CA3AF))" }}
        >
          {label}
        </p>
      </button>
      {!isCollapsed && (
        <div className="space-y-0.5">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Account Bar ─────────────────────────────────────────────────────────────

function AccountBar() {
  const { data: session } = useSession();
  const { activeGuild } = useGuild();

  if (!session?.logged_in) return null;

  return (
    <div className="shrink-0 border-t border-white/[0.06] px-3 py-2">
      <div className="flex items-center gap-2.5">
        <Avatar size="sm">
          <AvatarImage src={avatarUrl(session.discord_id, session.avatar)} alt={session.username} />
          <AvatarFallback className="text-xs">{session.username.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white/90 leading-tight">{session.username}</p>
          {activeGuild && (
            <p className="truncate text-[10px] text-muted-foreground leading-tight">{activeGuild.name}</p>
          )}
        </div>
        <Link
          href="/dashboard/settings"
          className="rounded-md p-1.5 text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
          title="Settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </Link>
        <a
          href="/logout"
          className="rounded-md p-1.5 text-white/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
          title="Sign Out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

// ─── Main Sidebar ────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isRosterManager = session?.permission_level === "roster_manager" && !session?.is_mod;

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);

  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveCollapsed(next);
      return next;
    });
  }

  const isActive = (href: string) => {
    if (href === "/dashboard" && pathname === "/dashboard") return true;
    if (href === "/dashboard/seeding" && pathname === "/dashboard/seeding") return true;
    if (href === "/dashboard/seeding/leaderboard" && pathname === "/dashboard/seeding/leaderboard") return true;
    if (href === "/dashboard/seeding/settings" && pathname === "/dashboard/seeding/settings") return true;
    if (href !== "/dashboard" && !href.startsWith("/dashboard/seeding") && pathname.startsWith(href)) return true;
    return false;
  };

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-white/[0.06] md:flex"
      style={{ background: "oklch(0.185 0 0 / 0.97)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "1px 0 0 rgba(255,255,255,0.05)" }}
    >
      {/* Brand */}
      <Link href="/dashboard" className="flex h-16 items-center gap-3 border-b border-white/[0.06] px-4 transition-colors hover:bg-white/[0.02]">
        <div className="relative">
          <Image src="/logo.png" alt="Squad Whitelister" width={32} height={32} className="rounded-lg" />
          <span
            className="absolute inset-0 rounded-lg"
            style={{ boxShadow: "0 0 10px color-mix(in srgb, var(--accent-primary) 40%, transparent)" }}
          />
        </div>
        <div>
          <span className="block text-sm font-semibold tracking-wide text-white/90">
            Squad Whitelister
          </span>
          <span className="block text-[10px] font-medium uppercase tracking-widest"
            style={{ color: "var(--accent-primary)" }}
          >
            Command Center
          </span>
        </div>
      </Link>

      {/* Active guild card */}
      <SidebarGuildCard />

      {/* Scrollable primary navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-2">
        <div className="pt-2 pb-1">
          <div className="h-px bg-white/[0.06]" />
        </div>

        {!isRosterManager && dashboardLinks.map((link) => (
          <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} active={isActive(link.href)} />
        ))}

        <CollapsibleSection label="Whitelist" sectionKey="whitelist" collapsed={collapsed} onToggle={toggleSection}>
          {whitelistLinks.map((link) => {
            if (isRosterManager && (link.href === "/dashboard/config" || link.href === "/dashboard/conflicts")) return null;
            return <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} active={isActive(link.href)} />;
          })}
        </CollapsibleSection>

        {!isRosterManager && (
          <CollapsibleSection label="Seeding" sectionKey="seeding" collapsed={collapsed} onToggle={toggleSection}>
            {seedingLinks.map((link) => (
              <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} active={isActive(link.href)} />
            ))}
          </CollapsibleSection>
        )}

        {!isRosterManager && (
          <CollapsibleSection label="Servers" sectionKey="servers" collapsed={collapsed} onToggle={toggleSection}>
            {serverLinks.map((link) => (
              <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} active={isActive(link.href)} />
            ))}
          </CollapsibleSection>
        )}

        {!isRosterManager && (
          <CollapsibleSection label="Tools" sectionKey="tools" collapsed={collapsed} onToggle={toggleSection}>
            {toolLinks.map((link) => (
              <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} active={isActive(link.href)} />
            ))}
          </CollapsibleSection>
        )}
      </nav>

      {/* Public-facing pages */}
      <div className="shrink-0 border-t border-white/[0.06] px-3 pt-1 pb-1">
        <p
          className="flex items-center gap-1 pt-2 pb-1 px-0 text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: "color-mix(in srgb, var(--accent-primary) 50%, var(--muted-foreground, #9CA3AF))" }}
        >
          <Globe className="h-3 w-3" />
          Public Sites
        </p>
        <div className="space-y-0.5">
          {publicLinks.map((link) => (
            <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} active={isActive(link.href)} />
          ))}
        </div>
      </div>

      {/* Account bar */}
      <AccountBar />

      {/* Bottom accent bar */}
      <div
        className="h-0.5 w-full shrink-0"
        style={{ background: "linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)", opacity: 0.4 }}
      />
    </aside>
  );
}

// ─── Shared Components ───────────────────────────────────────────────────────

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
        active
          ? "nav-active"
          : "nav-inactive text-white/60"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", !active && "opacity-60")} />
      {label}
    </Link>
  );
}

// ─── Mobile Sidebar ──────────────────────────────────────────────────────────

export function MobileSidebar({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isRosterManager = session?.permission_level === "roster_manager" && !session?.is_mod;

  const isActive = (href: string) => {
    if (href === "/dashboard" && pathname === "/dashboard") return true;
    if (href !== "/dashboard" && pathname.startsWith(href)) return true;
    return false;
  };

  const allLinks = isRosterManager
    ? [
        ...whitelistLinks.filter((l) => l.href !== "/dashboard/config" && l.href !== "/dashboard/conflicts"),
        ...publicLinks,
      ]
    : [...dashboardLinks, ...whitelistLinks, ...seedingLinks, ...serverLinks, ...toolLinks, ...publicLinks];

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-white/[0.06] md:hidden"
        style={{ background: "oklch(0.185 0 0 / 0.98)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <div className="flex h-16 items-center gap-3 border-b border-white/[0.06] px-4">
          <Image src="/logo.png" alt="Squad Whitelister" width={32} height={32} className="rounded-lg" />
          <div>
            <span className="block text-sm font-semibold text-white/90">Squad Whitelister</span>
            <span className="block text-[10px] font-medium uppercase tracking-widest"
              style={{ color: "var(--accent-primary)" }}
            >
              Command Center
            </span>
          </div>
        </div>
        <SidebarGuildCard />
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
          <div className="pt-2 pb-1">
            <div className="h-px bg-white/[0.06]" />
          </div>
          {allLinks.map((link) => (
            <NavLink
              key={link.href}
              href={link.href}
              label={link.label}
              icon={link.icon}
              active={isActive(link.href)}
              onClick={onClose}
            />
          ))}
        </nav>
        <AccountBar />
        <div
          className="h-0.5 w-full"
          style={{ background: "linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)", opacity: 0.4 }}
        />
      </aside>
    </>
  );
}
