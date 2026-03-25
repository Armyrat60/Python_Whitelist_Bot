"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Roster is the new name for Users - redirect to the existing users page
export default function RosterRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/users");
  }, [router]);
  return null;
}
