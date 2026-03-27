import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <Shield className="mb-6 h-16 w-16" style={{ color: "color-mix(in srgb, var(--accent-primary) 50%, transparent)" }} />
      <h1 className="mb-2 text-6xl font-bold text-foreground">404</h1>
      <p className="mb-6 text-lg text-muted-foreground">
        Page not found. The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <a href="/">
        <Button variant="outline">Go Home</Button>
      </a>
    </div>
  );
}
