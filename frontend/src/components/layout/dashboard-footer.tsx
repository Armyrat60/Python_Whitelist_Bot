import Link from "next/link";
import { APP_VERSION } from "@/lib/version";

export function DashboardFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-white/[0.06] px-4 py-3 md:px-6"
      style={{ background: "oklch(0.175 0 0 / 0.60)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>© {year} Squad Whitelister</span>
          <span className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono">
            v{APP_VERSION}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms of Service
          </Link>
        </div>
      </div>
    </footer>
  );
}
