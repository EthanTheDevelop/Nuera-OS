"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icon";

export type PopoverPlacement =
  "bottom-start" | "bottom-end" | "top-start" | "top-end" | "right-end";

const VIEWPORT_MARGIN = 8;
const GAP = 8;

function positionPanel(trigger: HTMLElement, panel: HTMLElement, placement: PopoverPlacement) {
  const anchor = trigger.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = panel;
  const fitsBelow = anchor.bottom + GAP + height <= window.innerHeight - VIEWPORT_MARGIN;
  const fitsAbove = anchor.top - GAP - height >= VIEWPORT_MARGIN;

  let top: number;
  let left: number;
  if (placement === "right-end") {
    left = anchor.right + GAP;
    top = anchor.bottom - height;
  } else {
    const wantsBelow = placement.startsWith("bottom");
    const below = wantsBelow ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
    top = below ? anchor.bottom + GAP : anchor.top - GAP - height;
    left = placement.endsWith("end") ? anchor.right - width : anchor.left;
  }

  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
  const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
  panel.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft))}px`;
  panel.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop))}px`;
}

export interface PopoverTriggerProps {
  ref: Ref<HTMLButtonElement>;
  onPointerDown: () => void;
  onClick: (event: ReactMouseEvent) => void;
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  "aria-haspopup": "menu" | "dialog";
}

/**
 * Panneau flottant sur le popover natif : couche haute (ne se fait pas couper par un parent),
 * fermeture à Échap et au clic extérieur, focus rendu au déclencheur.
 *
 * - `trigger` reçoit les props à étaler sur le bouton.
 * - `veil="menu"` : voile `--near-black` 25 % de l'écran 13, cliquable.
 */
export function Popover({
  trigger,
  placement = "bottom-start",
  label,
  role = "dialog",
  veil,
  open: controlledOpen,
  onOpenChange,
  initialFocus = "first",
  className,
  children,
}: {
  trigger: (props: PopoverTriggerProps) => ReactNode;
  placement?: PopoverPlacement;
  /** Nom accessible du panneau. */
  label: string;
  role?: "dialog" | "menu";
  veil?: "menu";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Élément qui reçoit le focus à l'ouverture. */
  initialFocus?: "first" | "panel";
  className?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openAtPointerDown = useRef(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = triggerRef.current;
    if (!open || !panel || !anchor) return;
    panel.showPopover();
    positionPanel(anchor, panel, placement);
    const target =
      initialFocus === "first"
        ? panel.querySelector<HTMLElement>(
            '[role="menuitem"],[role="menuitemcheckbox"],a[href],button:not(:disabled),input,textarea,select',
          )
        : null;
    (target ?? panel).focus({ preventScroll: true });

    const reposition = () => positionPanel(anchor, panel, placement);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      if (panel.matches(":popover-open")) panel.hidePopover();
      // Clic sur un autre élément : il garde le focus. Sinon, retour au déclencheur.
      const active = document.activeElement;
      if (!active || active === document.body) anchor.focus({ preventScroll: true });
    };
  }, [open, placement, initialFocus]);

  // Échap et clic extérieur passent par le navigateur : on suit son événement `toggle`.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== "closed" || !open) return;
      setOpen(false);
    };
    panel.addEventListener("toggle", onToggle);
    return () => panel.removeEventListener("toggle", onToggle);
  }, [open, setOpen]);

  return (
    <>
      {trigger({
        ref: triggerRef,
        onPointerDown: () => {
          openAtPointerDown.current = open;
        },
        onClick: (event) => {
          // Le clic souris sur le déclencheur a déjà fermé le panneau (fermeture par clic
          // extérieur, à l'appui) : il ne doit pas le rouvrir. Clavier : `detail` vaut 0.
          const wasOpen = event.detail === 0 ? open : openAtPointerDown.current;
          setOpen(!wasOpen);
        },
        "aria-expanded": open,
        "aria-controls": open ? id : undefined,
        "aria-haspopup": role,
      })}
      {open ? (
        <div
          ref={panelRef}
          id={id}
          popover="auto"
          data-veil={veil}
          role={role}
          aria-label={label}
          tabIndex={-1}
          className={cn(
            "anim-pop rounded-lg bg-surface text-text shadow-menu outline-none",
            className,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </>
  );
}

const MENU_ITEM = cn(
  "flex min-h-[34px] w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-nav font-medium outline-none",
  "transition-colors duration-(--dur-fast) hover:bg-surface-raised focus-visible:bg-surface-raised",
  "pointer-coarse:min-h-11",
);

function moveFocus(event: ReactKeyboardEvent<HTMLElement>) {
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not(:disabled):not([aria-disabled="true"]),[role="menuitemcheckbox"]',
    ),
  ];
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next: Record<string, number> = {
    ArrowDown: (index + 1) % items.length,
    ArrowUp: (index - 1 + items.length) % items.length,
    Home: 0,
    End: items.length - 1,
  };
  const target = next[event.key];
  if (target === undefined) return;
  event.preventDefault();
  items[target]?.focus();
}

/**
 * Corps d'un menu : flèches, Début et Fin déplacent le focus. Pour composer avec `Popover`.
 * `label` : à fournir quand le panneau contient autre chose que le menu (`role="menu"` sur la
 * liste, `Popover` en `role="dialog"`), comme le menu du profil et son en-tête.
 */
export function MenuList({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={label ? "menu" : undefined}
      aria-label={label}
      onKeyDown={moveFocus}
      className={cn("flex flex-col gap-1", className)}
    >
      {children}
    </div>
  );
}

/** Entrée de menu à bascule (Thème sombre, écran 13) : dessin de l'interrupteur, rôle de menu. */
export function MenuSwitchItem({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(MENU_ITEM, "text-text")}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-(--dur-fast) ease-out",
          checked ? "bg-accent" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-paper transition-transform duration-(--dur-fast) ease-out",
            checked && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

export function MenuItem({
  icon,
  href,
  onSelect,
  aside,
  danger = false,
  disabled = false,
  children,
}: {
  icon?: IconName;
  href?: string;
  onSelect?: () => void;
  aside?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const classes = cn(MENU_ITEM, danger ? "text-danger" : "text-text", disabled && "opacity-50");
  const content = (
    <>
      {icon ? <Icon name={icon} size={18} className={danger ? undefined : "text-ink"} /> : null}
      <span className="min-w-0 flex-1">{children}</span>
      {aside}
    </>
  );
  if (href && !disabled) {
    return (
      <Link role="menuitem" href={href} onClick={onSelect} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={classes}
    >
      {content}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-0.5 h-px w-full bg-border" />;
}

export interface MenuEntry {
  key: string;
  label: string;
  icon?: IconName;
  href?: string;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  aside?: ReactNode;
  /** Filet avant l'entrée. */
  separatorBefore?: boolean;
}

/** Menu déroulant simple. Pour un contenu composé (écran 13), voir `Popover` + `MenuList`. */
export function Menu({
  trigger,
  label,
  items,
  placement = "bottom-end",
  width = 240,
}: {
  trigger: (props: PopoverTriggerProps) => ReactNode;
  label: string;
  items: readonly MenuEntry[];
  placement?: PopoverPlacement;
  width?: number;
}) {
  return (
    <Popover trigger={trigger} label={label} role="menu" placement={placement}>
      {(close) => (
        <div style={{ width }}>
          <MenuList className="p-2">
            {items.map((item) => (
              <div key={item.key} className="contents">
                {item.separatorBefore ? <MenuSeparator /> : null}
                <MenuItem
                  icon={item.icon}
                  href={item.href}
                  danger={item.danger}
                  disabled={item.disabled}
                  aside={item.aside}
                  onSelect={() => {
                    item.onSelect?.();
                    close();
                  }}
                >
                  {item.label}
                </MenuItem>
              </div>
            ))}
          </MenuList>
        </div>
      )}
    </Popover>
  );
}
