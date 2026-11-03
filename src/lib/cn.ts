import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose des classes Tailwind en résolvant les conflits (`px-2` puis `px-4` → `px-4`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
