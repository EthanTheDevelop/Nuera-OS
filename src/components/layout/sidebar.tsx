import type { ReactNode } from "react";
import { staggerIndex } from "@/components/motion/stagger";
import { Icon, type IconName } from "@/components/ui/icon";
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
 * - `externalLinks` : outils hébergés à part, ajoutés au groupe Outils, ouverts dans un nouvel onglet.
 */
export interface ExternalNavLink {
  label: string;
  href: string;
  icon: IconName;
}

export function Sidebar({
  sections,
  counters = {},
  userBlock,
  externalLinks = [],
}: {
  sections: readonly NavSection[];
  counters?: Partial<Record<NavKey, number>>;
  userBlock: ReactNode;
  externalLinks?: readonly ExternalNavLink[];
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
              {section.key === "outils"
                ? externalLinks.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={staggerIndex(itemIndex++)}
                        className="anim-frame flex min-h-[34px] items-center gap-3 rounded-sm px-3 py-2 text-nav font-medium text-accent-on-dark transition-colors duration-(--dur-fast) ease-out outline-none hover:bg-surface-raised-dark hover:text-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-on-dark max-lg:min-h-11 pointer-coarse:min-h-11"
                      >
                        <Icon name={link.icon} size={18} />
                        <span className="min-w-0 flex-1 truncate">{link.label}</span>
                        <span className="sr-only"> (nouvel onglet)</span>
                      </a>
                    </li>
                  ))
                : null}
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
