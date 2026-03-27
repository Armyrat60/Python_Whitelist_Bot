import { Shield, Zap, Users, Globe, BarChart3, Lock, RefreshCw, Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-20 flex items-center justify-between border-b border-white/[0.06] px-6 py-4 backdrop-blur-md"
        style={{ background: "oklch(0.17 0.018 240 / 0.88)" }}>
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-semibold text-foreground">Squad Whitelister</span>
        </div>
        <a href="/login">
          <Button variant="outline" size="sm">Sign In</Button>
        </a>
      </nav>

      {/* Hero */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-20 text-center">
        <div
          className="mb-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium"
          style={{
            border: "1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)",
            background: "color-mix(in srgb, var(--accent-primary) 10%, transparent)",
            color: "var(--accent-primary)",
          }}
        >
          <Gamepad2 className="h-3.5 w-3.5" />
          Built for Squad server communities
        </div>
        <h1 className="mb-4 text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
          Whitelist management
          <br />
          <span style={{ color: "var(--accent-primary)" }}>made simple.</span>
        </h1>
        <p className="mb-10 max-w-lg text-lg text-muted-foreground">
          Discord-powered whitelist bot with role-based tiers, real-time sync,
          and a modern admin dashboard. Set up in minutes.
        </p>
        <div className="flex gap-3">
          <a href="/login">
            <Button
              size="lg"
              className="bg-[#5865F2] text-white hover:bg-[#4752C4] px-8 py-6 text-base"
            >
              <svg
                className="mr-2 h-5 w-5"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
              </svg>
              Sign in with Discord
            </Button>
          </a>
        </div>
      </div>

      {/* Features */}
      <div className="border-t border-white/[0.06] bg-background/50 px-4 py-20">
        <h2 className="mb-12 text-center text-2xl font-bold text-foreground">
          Everything you need to manage server access
        </h2>
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Feature
            icon={Shield}
            title="Role-Based Tiers"
            description="Map Discord roles to whitelist slots. Create custom tiers with flexible slot counts."
          />
          <Feature
            icon={Zap}
            title="Instant Sync"
            description="Whitelist files update in real-time. Your Squad server always has the latest data."
          />
          <Feature
            icon={Users}
            title="Multi-Community"
            description="One bot, multiple servers. Each community gets its own config and whitelist."
          />
          <Feature
            icon={Globe}
            title="Web Dashboard"
            description="Full admin panel with import/export, audit logs, and user management."
          />
          <Feature
            icon={Lock}
            title="Secure URLs"
            description="Unique, unguessable whitelist file URLs. Only your server can access them."
          />
          <Feature
            icon={BarChart3}
            title="Analytics"
            description="Track active users, slot usage, and audit trail for complete visibility."
          />
          <Feature
            icon={RefreshCw}
            title="Auto Role Sync"
            description="Whitelist deactivates when roles are removed, reactivates when returned."
          />
          <Feature
            icon={Gamepad2}
            title="Squad Native"
            description="Generates RemoteAdminList format. Just add the URL to your server config."
          />
        </div>
      </div>

      {/* CTA */}
      <div className="px-4 py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold text-foreground">
          Ready to get started?
        </h2>
        <p className="mb-6 text-muted-foreground">
          Add the bot to your Discord server and configure in minutes.
        </p>
        <a href="/login">
          <Button
            size="lg"
            className="px-8 py-6 text-base font-semibold text-black"
            style={{ background: "var(--accent-primary)" }}
          >
            Get Started Free
          </Button>
        </a>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] px-4 py-6 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-4">
          <span>Squad Whitelister</span>
          <span>·</span>
          <a href="/terms" className="hover:text-foreground">Terms</a>
          <span>·</span>
          <a href="/privacy" className="hover:text-foreground">Privacy</a>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center">
      <div
        className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl"
        style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}
      >
        <Icon className="h-6 w-6" style={{ color: "var(--accent-primary)" }} />
      </div>
      <h3 className="mb-1 text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
