"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Révélation au défilement : l'entrée type joue quand l'élément arrive à l'écran, une seule fois.
 * Animation CSS en pause jusqu'à l'intersection : respecte d'emblée la réduction des animations,
 * la mémoire de session et le préréglage client.
 */
export function Reveal({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} data-inview={inView ? "" : undefined} className={cn("anim-reveal", className)}>
      {children}
    </div>
  );
}
