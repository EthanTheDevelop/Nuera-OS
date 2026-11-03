import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Message d'information ou d'erreur, annoncé aux lecteurs d'écran. */
export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "danger";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2",
        tone === "danger" ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-subtle",
        className,
      )}
    >
      {children}
    </div>
  );
}
