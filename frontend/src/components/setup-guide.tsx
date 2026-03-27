"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";

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
  // Don't show if everything is configured
  if (hasRoleMappings && hasPanelChannel && hasWhitelistEnabled) {
    return null;
  }

  const steps = [
    {
      done: hasWhitelistEnabled,
      label: "Enable a whitelist",
      description: "Go to Setup → Whitelists and toggle one on",
    },
    {
      done: hasRoleMappings,
      label: "Add role mappings",
      description: "Go to Setup → Panels → Manage Roles to link Discord roles to slot counts",
    },
    {
      done: hasPanelChannel,
      label: "Set a panel channel",
      description: "Go to Setup → Panels and assign a Discord channel, then push the panel",
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return (
    <Card
      style={{
        borderColor: "color-mix(in srgb, var(--accent-primary) 25%, transparent)",
        background: "color-mix(in srgb, var(--accent-primary) 5%, oklch(0.265 0 0))",
      }}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: "color-mix(in srgb, var(--accent-primary) 18%, transparent)" }}
          >
            <Sparkles className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Get Started — {completed}/{steps.length} complete
              </h3>
              <p className="text-xs text-muted-foreground">
                Complete these steps to start managing your whitelist.
              </p>
            </div>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <div
                    className="h-5 w-5 rounded-full border-2 flex items-center justify-center text-xs font-bold shrink-0"
                    style={
                      step.done
                        ? {
                            borderColor: "var(--accent-primary)",
                            background: "color-mix(in srgb, var(--accent-primary) 20%, transparent)",
                            color: "var(--accent-primary)",
                          }
                        : {
                            borderColor: "rgba(255,255,255,0.15)",
                            color: "rgba(255,255,255,0.35)",
                          }
                    }
                  >
                    {step.done ? "✓" : i + 1}
                  </div>
                  <div>
                    <span className={step.done ? "text-muted-foreground line-through" : "text-foreground"}>
                      {step.label}
                    </span>
                    {!step.done && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        — {step.description}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Link href="/dashboard/panels">
              <Button
                size="sm"
                className="text-black font-semibold"
                style={{ background: "var(--accent-primary)" }}
              >
                <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                Go to Setup
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
