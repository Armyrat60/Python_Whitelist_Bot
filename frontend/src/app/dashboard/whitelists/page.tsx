"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WhitelistsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/setup?tab=whitelists");
  }, [router]);
  return null;
}
