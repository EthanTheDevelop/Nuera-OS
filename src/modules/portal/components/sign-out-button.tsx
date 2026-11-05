"use client";

import { useSignOut } from "@/components/layout/profile-menu";
import { CompactButton } from "@/components/ui/compact-button";

export function SignOutButton() {
  const { signOut, pending } = useSignOut("/espace/connexion");
  return (
    <CompactButton variant="secondary" onClick={signOut} disabled={pending}>
      Se déconnecter
    </CompactButton>
  );
}
