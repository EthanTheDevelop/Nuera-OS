import type { ReactNode } from "react";
import { staggerIndex } from "@/components/motion/stagger";
import type { NavKey, NavSection } from "@/config/navigation";
import { Logo } from "./logo";
import { NavLink } from "./nav-link";
import { SidebarSearchTrigger } from "./shell-context";

/**
 * Barre latérale (Figma 57:578), 248 de large, fond `--near-black`. Compatible serveur.
 *
 * - `sections` : déjà filtrées par permission (`visibleNavigation`).
 * - `counters` : compteurs à droite des entrées (Messages, Support), fournis par le layout.
 * - `userBlock` : bloc du bas, ouvre le menu du profil (écran 13).
 */
export function Sidebar({
  sections,
  counters = {},
  userBlock,
}: {
  sections: readonly NavSection[];
  counters?: Partial<Record<NavKey, number>>;
  userBlock: ReactNode;
}) {
  let itemIndex = 0;
  return (
    <div className="flex h-full w-(--sidebar-w) flex-col gap-4 bg-near-black px-4 pt-5 pb-4">
      <div className="anim-frame shrink-0 pl-2" style={staggerIndex(0)}>
        <Logo />
      </div>
      <div className="anim-frame shrink-0" style={staggerIndex(1)}>
        <SidebarSearchTrigger />
      </div>
      <nav
        aria-label="Navigation principale"
        className="-mx-1 flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-4 overflow-y-auto px-1"
      >
        {sections.map((section) => (
          <div key={section.key}>
            <p className="pb-2 pl-3 font-mono text-nav-group text-accent-on-dark uppercase opacity-60">
              {section.label}
            </p>
            <ul>
              {section.items.map((item) => (
                <li key={item.key}>
                  <NavLink
                    href={item.href}
                    icon={item.icon}
                    label={item.label}
                    counter={counters[item.key]}
                    activePrefixes={item.activePrefixes}
                    index={itemIndex++}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="anim-frame shrink-0" style={staggerIndex(itemIndex)}>
        {userBlock}
      </div>
    </div>
  );
}
