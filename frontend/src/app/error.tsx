"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <AlertTriangle className="mb-6 h-16 w-16 text-red-400/50" />
      <h1 className="mb-2 text-4xl font-bold text-foreground">
        Something went wrong
      </h1>
      <p className="mb-6 max-w-md text-muted-foreground">
        An unexpected error occurred. Please try again or contact support if the
        problem persists.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Try Again</Button>
        <a href="/">
          <Button variant="outline">Go Home</Button>
        </a>
      </div>
    </div>
  );
}
