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
    <Card className="border-orange-500/30 bg-orange-500/5">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-500/20">
            <Sparkles className="h-4 w-4 text-orange-400" />
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
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm"
                >
                  <div
                    className={`h-5 w-5 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
                      step.done
                        ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                        : "border-zinc-600 text-zinc-500"
                    }`}
                  >
                    {step.done ? "✓" : i + 1}
                  </div>
                  <div>
                    <span
                      className={
                        step.done
                          ? "text-muted-foreground line-through"
                          : "text-foreground"
                      }
                    >
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
            <Link href="/dashboard/setup">
              <Button size="sm" className="bg-orange-500 text-white hover:bg-orange-600">
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
