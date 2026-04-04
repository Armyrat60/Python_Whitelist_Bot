"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  Users,
  List,
  PanelTop,
  Shield,
  Settings2,
  ChevronsUpDown,
  Check,
  BookUser,
  Search,
  Layers,
  Sprout,
  Trophy,
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

const dashboardLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

const rosterLinks = [
  { href: "/dashboard/roster", label: "Discord Roster", icon: Users },
  { href: "/dashboard/manual-roster", label: "Manual Roster", icon: BookUser },
  { href: "/dashboard/search", label: "Player Search", icon: Search },
];

const configLinks = [
  { href: "/dashboard/panels", label: "Signup Panels", icon: PanelTop },
  { href: "/dashboard/whitelists", label: "Whitelists", icon: Shield },
  { href: "/dashboard/squad-groups", label: "Permission Groups", icon: Layers },
];

const seedingLinks = [
  { href: "/dashboard/seeding", label: "Dashboard", icon: Sprout },
  { href: "/dashboard/seeding/leaderboard", label: "Leaderboard", icon: Trophy },
];

const bottomLinks = [
  { href: "/dashboard/settings", label: "Settings", icon: Settings2 },
];

const userLinks = [
  { href: "/my-whitelist", label: "My Whitelist", icon: List },
  { href: "/seeding/leaderboard", label: "Seeding Leaderboard", icon: Trophy },
];

function guildIconUrl(guildId: string, icon: string | null) {
  if (!icon) return null;
  if (icon.startsWith("http")) return icon;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.webp?size=64`;
}

function SidebarGuildCard() {
  const { activeGuild, guilds, switchGuild } = useGuild();
  const [open, setOpen] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const prevGuildId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (prevGuildId.current !== undefined && prevGuildId.current !== activeGuild?.id) {
      setFlashing(false);
      // Re-trigger animation by toggling off then on next frame
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
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-white/30" />
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

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isRosterManager = session?.permission_level === "roster_manager" && !session?.is_mod;

  const isActive = (href: string) => {
    if (href === "/dashboard" && pathname === "/dashboard") return true;
    if (href === "/dashboard/roster" && pathname === "/dashboard/users") return true;
    if (href === "/dashboard/panels" && pathname === "/dashboard/setup") return true;
    // Exact match for seeding sub-pages to avoid parent highlighting
    if (href === "/dashboard/seeding" && pathname === "/dashboard/seeding") return true;
    if (href === "/dashboard/seeding/leaderboard" && pathname === "/dashboard/seeding/leaderboard") return true;
    if (href === "/dashboard/seeding/settings" && pathname === "/dashboard/seeding/settings") return true;
    // Default: startsWith for other pages (but not /dashboard/seeding which is handled above)
    if (href !== "/dashboard" && !href.startsWith("/dashboard/seeding") && pathname.startsWith(href)) return true;
    return false;
  };

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-white/[0.06] md:flex"
      style={{ background: "oklch(0.185 0 0 / 0.97)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", boxShadow: "1px 0 0 rgba(255,255,255,0.05)" }}
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-white/[0.06] px-4">
        <div className="relative">
          <img src="/logo.png" alt="Squad Whitelister" className="h-8 w-8 rounded-lg" />
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
      </div>

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

        <SectionLabel>Rosters</SectionLabel>
        {rosterLinks.map((link) => (
          <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} active={isActive(link.href)} />
        ))}

        {!isRosterManager && (
          <>
            <SectionLabel>Configuration</SectionLabel>
            {configLinks.map((link) => (
              <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} active={isActive(link.href)} />
            ))}

            <SectionLabel>Seeding</SectionLabel>
            {seedingLinks.map((link) => (
              <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} active={isActive(link.href)} />
            ))}
          </>
        )}
      </nav>

      {/* Fixed bottom section — Settings, Data, My Whitelist */}
      <div className="shrink-0 border-t border-white/[0.06] px-3 pt-2 pb-2 space-y-0.5">
        {!isRosterManager && bottomLinks.map((link) => (
          <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} active={isActive(link.href)} />
        ))}
        <div className="my-1.5 h-px bg-white/[0.06]" />
        {userLinks.map((link) => (
          <NavLink key={link.href} href={link.href} label={link.label} icon={link.icon} active={isActive(link.href)} />
        ))}
      </div>

      {/* Bottom accent bar */}
      <div
        className="h-0.5 w-full shrink-0"
        style={{ background: "linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)", opacity: 0.4 }}
      />
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-4 pb-1">
      <p
        className="px-3 text-[10px] font-semibold uppercase tracking-widest"
        style={{ color: "color-mix(in srgb, var(--accent-primary) 50%, var(--muted-foreground, #9CA3AF))" }}
      >
        {children}
      </p>
    </div>
  );
}

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
  if (active) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className="nav-active flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150"
      >
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      className="nav-inactive flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/40 transition-all duration-150"
    >
      <Icon className="h-4 w-4 shrink-0 opacity-60" />
      {label}
    </Link>
  );
}

export function MobileSidebar({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isRosterManager = session?.permission_level === "roster_manager" && !session?.is_mod;

  const isActive = (href: string) => {
    if (href === "/dashboard" && pathname === "/dashboard") return true;
    if (href === "/dashboard/roster" && pathname === "/dashboard/users") return true;
    if (href !== "/dashboard" && pathname.startsWith(href)) return true;
    return false;
  };

  const allLinks = isRosterManager
    ? [...rosterLinks, ...userLinks]
    : [...dashboardLinks, ...rosterLinks, ...configLinks, ...bottomLinks, ...userLinks];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
        onClick={onClose}
      />
      {/* Slide-in panel */}
      <aside className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-white/[0.06] md:hidden"
        style={{ background: "oklch(0.185 0 0 / 0.98)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <div className="flex h-16 items-center gap-3 border-b border-white/[0.06] px-4">
          <img src="/logo.png" alt="Squad Whitelister" className="h-8 w-8 rounded-lg" />
          <div>
            <span className="block text-sm font-semibold text-white/90">Squad Whitelister</span>
            <span className="block text-[10px] font-medium uppercase tracking-widest"
              style={{ color: "var(--accent-primary)" }}
            >
              Command Center
            </span>
          </div>
        </div>
        {/* Guild card in mobile sidebar too */}
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
        <div
          className="h-0.5 w-full"
          style={{ background: "linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)", opacity: 0.4 }}
        />
      </aside>
    </>
  );
}
