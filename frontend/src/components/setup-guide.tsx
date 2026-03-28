"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, ChevronUp, ChevronDown, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "setup_guide_dismissed_v1";

interface SetupGuideProps {
  hasRoleMappings: boolean;
  hasPanelChannel: boolean;
  hasWhitelistEnabled: boolean;
}

export function SetupGuide({
  hasRoleMappings,
  hasPanelChannel,
  hasWhitelistEnabled,
}: SetupGuideProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(true); // start hidden until hydrated

  // Hydrate from localStorage after mount
  useEffect(() => {
    const saved = localStorage.getItem(DISMISS_KEY);
    setDismissed(saved === "true");
  }, []);

  const steps = [
    {
      done: hasWhitelistEnabled,
      label: "Enable a whitelist",
      description: "Go to Whitelists and toggle one on",
      href: "/dashboard/whitelists",
    },
    {
      done: hasRoleMappings,
      label: "Add role mappings or tier categories",
      description: "Link Discord roles to slot counts under Tiers",
      href: "/dashboard/tiers",
    },
    {
      done: hasPanelChannel,
      label: "Set a panel channel and push to Discord",
      description: "Go to Panels, assign a channel and click Push",
      href: "/dashboard/panels",
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const allDone = completed === steps.length;

  // Don't show if everything is configured or user dismissed
  if (allDone || dismissed) return null;

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 px-4 sm:px-0"
      role="complementary"
      aria-label="Setup guide"
    >
      <div
        className="rounded-xl border shadow-2xl overflow-hidden"
        style={{
          borderColor: "color-mix(in srgb, var(--accent-primary) 30%, transparent)",
          background: "color-mix(in srgb, var(--accent-primary) 6%, oklch(0.20 0 0))",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px color-mix(in srgb, var(--accent-primary) 15%, transparent)",
        }}
      >
        {/* Header bar — always visible */}
        <div
          className="flex cursor-pointer items-center gap-2.5 px-4 py-3"
          onClick={() => setExpanded((v) => !v)}
        >
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
            style={{ background: "color-mix(in srgb, var(--accent-primary) 20%, transparent)" }}
          >
            <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--accent-primary)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-foreground">
              Get Started
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              {completed}/{steps.length} steps complete
            </span>
          </div>
          {/* Progress dots */}
          <div className="flex items-center gap-1 shrink-0">
            {steps.map((s, i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full transition-colors"
                style={{
                  background: s.done
                    ? "var(--accent-primary)"
                    : "rgba(255,255,255,0.15)",
                }}
              />
            ))}
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <button
            className="ml-1 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Expanded steps */}
        {expanded && (
          <div
            className="border-t px-4 pb-4 pt-3 space-y-2"
            style={{ borderColor: "color-mix(in srgb, var(--accent-primary) 15%, transparent)" }}
          >
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <div
                  className="mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center shrink-0"
                  style={
                    step.done
                      ? {
                          borderColor: "var(--accent-primary)",
                          background: "color-mix(in srgb, var(--accent-primary) 20%, transparent)",
                        }
                      : { borderColor: "rgba(255,255,255,0.15)" }
                  }
                >
                  {step.done && (
                    <Check className="h-2.5 w-2.5" style={{ color: "var(--accent-primary)" }} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={step.href}
                    className={
                      step.done
                        ? "text-muted-foreground line-through"
                        : "font-medium text-foreground hover:underline"
                    }
                  >
                    {step.label}
                  </Link>
                  {!step.done && (
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  )}
                </div>
              </div>
            ))}

            {/* Find first incomplete step and link to it */}
            {(() => {
              const next = steps.find((s) => !s.done);
              return next ? (
                <div className="pt-1">
                  <Link href={next.href}>
                    <Button
                      size="sm"
                      className="w-full text-black font-semibold"
                      style={{ background: "var(--accent-primary)" }}
                    >
                      <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                      Continue Setup
                    </Button>
                  </Link>
                </div>
              ) : null;
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
