"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { getAuthClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await getAuthClient().signOut();
          router.replace("/login");
          router.refresh();
        })
      }
      className="flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      aria-label="Se déconnecter"
      title="Se déconnecter"
    >
      <LogOut className="size-4" aria-hidden="true" />
    </button>
  );
}
