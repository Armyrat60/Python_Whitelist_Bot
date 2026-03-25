import { Shield, Zap, Users, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Hero */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <img
          src="/logo.png"
          alt="Squad Whitelister"
          className="mb-6 h-20 w-20 rounded-2xl"
        />
        <h1 className="mb-2 text-4xl font-bold tracking-tight text-foreground">
          Squad Whitelister
        </h1>
        <p className="mb-8 max-w-md text-lg text-muted-foreground">
          Manage your Squad game server whitelist with Discord.
          Role-based tiers, real-time sync, and a clean dashboard.
        </p>
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

      {/* Features */}
      <div className="border-t border-zinc-800 bg-zinc-950/50 px-4 py-16">
        <div className="mx-auto grid max-w-4xl gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <Feature
            icon={Shield}
            title="Role-Based Tiers"
            description="Map Discord roles to whitelist slots. Solo, Duo, Squad — any tier you want."
          />
          <Feature
            icon={Zap}
            title="Real-Time Sync"
            description="Whitelist files update instantly. Your Squad server always has the latest data."
          />
          <Feature
            icon={Users}
            title="Multi-Community"
            description="Manage multiple servers from one dashboard. Each gets its own config."
          />
          <Feature
            icon={Globe}
            title="Web Dashboard"
            description="Full admin panel. Import, export, audit logs, and user management."
          />
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-zinc-800 px-4 py-6 text-center text-xs text-muted-foreground">
        <p>Squad Whitelister — squadwhitelister.com</p>
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
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10">
        <Icon className="h-6 w-6 text-orange-400" />
      </div>
      <h3 className="mb-1 text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
