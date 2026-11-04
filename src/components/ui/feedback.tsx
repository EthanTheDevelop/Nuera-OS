import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icon";

export type AlertTone = "info" | "success" | "warn" | "danger";

const ALERT: Record<AlertTone, { box: string; icon: IconName }> = {
  info: { box: "bg-accent-pale text-accent", icon: "alert" },
  success: { box: "bg-success-pale text-success", icon: "check" },
  warn: { box: "bg-warn-pale text-warn", icon: "alert" },
  danger: { box: "bg-danger-pale text-danger", icon: "alert" },
};

/** Message d'information ou d'erreur, annoncé aux lecteurs d'écran (fond pâle, comme C2). */
export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: AlertTone;
  children: ReactNode;
  className?: string;
}) {
  const { box, icon } = ALERT[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex items-start gap-2 rounded-md px-4 py-3 text-sm", box, className)}
    >
      <Icon name={icon} size={16} className="mt-px" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
