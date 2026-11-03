import { visibleNavigation } from "@/config/navigation";
import { can, type Actor } from "@/server/auth/permissions";
import { ROLE_LABELS } from "@/server/auth/roles";
import { NavLink } from "./nav-link";
import { SignOutButton } from "./sign-out-button";

/** Sidebar rendue côté serveur : n'affiche que les entrées autorisées pour l'utilisateur. */
export function Sidebar({ actor }: { actor: Actor }) {
  const sections = visibleNavigation((permission) => can(actor, permission));

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-4 font-semibold">Nuera OS</div>

      <nav aria-label="Navigation principale" className="flex-1 space-y-4 overflow-y-auto px-2">
        {sections.map((section) => (
          <div key={section.key}>
            {section.label ? (
              <p className="mb-1 px-2 text-xs text-ink-subtle uppercase">{section.label}</p>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.key}>
                  <NavLink
                    href={item.href}
                    label={item.label}
                    icon={<item.icon aria-hidden="true" />}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{actor.name}</p>
          <p className="truncate text-xs text-ink-muted">{ROLE_LABELS[actor.role]}</p>
        </div>
        <SignOutButton />
      </div>
    </div>
  );
}
