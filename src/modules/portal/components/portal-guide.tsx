"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { CompactButton } from "@/components/ui/compact-button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import { DURATION_MS } from "@/lib/motion";
import { completeGuideAction } from "../portal.actions";

interface GuideStep {
  /** Sélecteur de l'élément réel à éclairer. Absent ou masqué pour ce client : l'étape saute. */
  target: string;
  title: string;
  text: string;
}

const STEPS: readonly GuideStep[] = [
  {
    target: "#parcours",
    title: "Où en est votre projet",
    text: "Les grandes étapes, de la première à la mise en ligne, avec celle en cours.",
  },
  {
    target: "#a-vous",
    title: "À vous de jouer",
    text: "Ce qu'il nous faut de votre part est ici : déposez vos contenus, un par un.",
  },
  {
    target: "#a-valider",
    title: "Vos validations",
    text: "Quand une version est prête, vous la consultez ici, puis vous la validez ou nous envoyez vos retours.",
  },
  {
    target: '[data-guide="tab-messages"]',
    title: "Vos messages",
    text: "Une question ? Écrivez-nous ici : nos réponses arrivent dans le même fil.",
  },
  {
    target: '[data-guide="tab-documents"]',
    title: "Vos documents",
    text: "Devis, factures et maquettes partagés restent ici, prêts à être téléchargés.",
  },
  {
    target: '[data-guide="tab-site"]',
    title: "Votre site",
    text: "Demandez le changement d'un texte ou d'une photo, et suivez toutes vos demandes.",
  },
];

/** Écart entre l'élément éclairé, son halo, la bulle et le bord de l'écran. */
const HALO = 6;
const GAP = 12;
const EDGE = 8;
/** En dessous, la bulle devient une feuille posée en bas de l'écran. */
const SHEET_BELOW = 640;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findTarget(selector: string): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return null;
  const { width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0 ? element : null;
}

/** Sous l'élément, sinon au-dessus, à côté, et en dernier recours en bas de l'écran, sans déborder. */
function placeBubble(target: Box | null, width: number, height: number) {
  const viewportW = document.documentElement.clientWidth;
  const viewportH = window.innerHeight;
  const clampLeft = (left: number) => Math.max(EDGE, Math.min(left, viewportW - width - EDGE));
  const clampTop = (top: number) => Math.max(EDGE, Math.min(top, viewportH - height - EDGE));
  if (!target) {
    return { left: clampLeft((viewportW - width) / 2), top: clampTop((viewportH - height) / 2) };
  }
  const below = target.top + target.height + GAP;
  if (below + height <= viewportH - EDGE) return { left: clampLeft(target.left), top: below };
  const above = target.top - GAP - height;
  if (above >= EDGE) return { left: clampLeft(target.left), top: above };
  const right = target.left + target.width + GAP;
  if (right + width <= viewportW - EDGE) return { left: right, top: clampTop(target.top) };
  const left = target.left - GAP - width;
  if (left >= EDGE) return { left, top: clampTop(target.top) };
  return { left: clampLeft(target.left), top: viewportH - height - EDGE };
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height);

function GuideTour({ steps, onFinish }: { steps: readonly GuideStep[]; onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Box | null>(null);
  const [bubble, setBubble] = useState<{ width: number; height: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const selector = step?.target ?? "";
  const last = index === steps.length - 1;

  // Chaque image : l'élément suit le défilement, un redimensionnement ou une animation de la page.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const element = document.querySelector<HTMLElement>(selector);
      const rect = element?.getBoundingClientRect();
      const box =
        rect && rect.width > 0
          ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
          : null;
      setTarget((current) => (sameBox(current, box) ? current : box));
      setSheet(document.documentElement.clientWidth < SHEET_BELOW);
      const node = panel.current;
      if (node) {
        const width = node.offsetWidth;
        const height = node.offsetHeight;
        setBubble((current) =>
          current?.width === width && current.height === height ? current : { width, height },
        );
      }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [selector]);

  // Amène l'élément dans la zone que la bulle laisse libre, seulement s'il n'y est pas déjà.
  useLayoutEffect(() => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const isSheet = document.documentElement.clientWidth < SHEET_BELOW;
    const free = window.innerHeight - (isSheet ? (panel.current?.offsetHeight ?? 0) : 0);
    if (rect.top >= GAP && rect.bottom <= free - GAP) return;
    const offset = rect.height < free - 2 * GAP ? (free - rect.height) / 2 : GAP;
    window.scrollBy({ top: rect.top - offset });
  }, [selector, sheet]);

  // Le focus reste sur « Suivant » : Entrée enchaîne les étapes, le texte est annoncé par la zone vivante.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("[data-guide-next]")?.focus({ preventScroll: true });
  }, [index]);

  // Sur le document : Échap et le piège du focus marchent aussi après un clic hors de la bulle.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onFinish();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
      const first = items[0];
      const end = items[items.length - 1];
      const active = document.activeElement;
      if (!panel.current.contains(active)) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        end?.focus();
      } else if (!event.shiftKey && active === end) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onFinish]);

  if (!step) return null;
  const position = bubble && !sheet ? placeBubble(target, bubble.width, bubble.height) : null;

  return (
    <>
      {/* Le reste de la page ne répond pas pendant la visite. */}
      <div aria-hidden="true" className="fixed inset-0 z-[70]" />
      {target ? (
        <div
          aria-hidden="true"
          style={{
            top: target.top - HALO,
            left: target.left - HALO,
            width: target.width + 2 * HALO,
            height: target.height + 2 * HALO,
            boxShadow: "0 0 0 100vmax var(--veil-window)",
          }}
          className="pointer-events-none fixed z-[70] rounded-xl outline-2 outline-accent transition-[top,left,width,height] duration-(--dur-fast) motion-reduce:transition-none"
        />
      ) : null}
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="portal-guide-title"
        aria-describedby="portal-guide-text"
        style={position ?? undefined}
        className={cn(
          "fixed z-[71] flex flex-col gap-2 bg-surface p-4 text-text shadow-float transition-opacity duration-(--dur-fast) motion-reduce:transition-none",
          sheet
            ? "inset-x-0 bottom-0 rounded-t-lg pb-[max(1rem,env(safe-area-inset-bottom))]"
            : "w-[min(360px,calc(100vw-16px))] rounded-lg",
          !sheet && !position && "opacity-0",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="tabular text-xs text-muted">
            Étape {index + 1} sur {steps.length}
          </p>
          <button
            type="button"
            onClick={onFinish}
            className="hit-44 rounded-sm text-sm font-medium text-accent outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-focus"
          >
            Passer
          </button>
        </div>
        <div aria-live="polite">
          <h2 id="portal-guide-title" className="text-base font-semibold text-ink">
            {step.title}
          </h2>
          <p id="portal-guide-text" className="mt-1 text-sm text-muted">
            {step.text}
          </p>
        </div>
        <div className="mt-1 flex items-center justify-end gap-2">
          <CompactButton variant="quiet" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            Précédent
          </CompactButton>
          <CompactButton data-guide-next onClick={() => (last ? onFinish() : setIndex(index + 1))}>
            {last ? "Terminer" : "Suivant"}
          </CompactButton>
        </div>
      </div>
    </>
  );
}

const subscribeNever = () => () => undefined;

/**
 * Accueil et visite guidée de la première visite, sur `/espace` uniquement. Rendu seulement si le
 * serveur le demande (aucun clignotement sinon) et ouvert après l'hydratation : `Modal` dépend du
 * mouvement réduit, inconnu du serveur. Un enregistrement raté ne bloque rien : le guide se ferme, et
 * il se reproposera au prochain chargement.
 */
export function PortalGuide({ firstName }: { firstName: string | null }) {
  const onClient = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [stage, setStage] = useState<"welcome" | "leaving" | "tour" | "done">("welcome");
  const [steps, setSteps] = useState<readonly GuideStep[]>([]);
  const [, startTransition] = useTransition();
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );

  const finish = useCallback(() => {
    setStage("done");
    startTransition(async () => {
      await completeGuideAction().catch(() => undefined);
    });
  }, []);

  // La bulle partie, le focus revient au titre de la page plutôt que de se perdre. L'accueil, lui,
  // rend le focus par le `<dialog>` natif.
  const finishTour = useCallback(() => {
    const heading = document.querySelector<HTMLElement>("main h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    finish();
  }, [finish]);

  const start = () => {
    setStage("leaving");
    // Le `<dialog>` doit avoir quitté la couche supérieure : il rend le reste de la page inerte.
    leaveTimer.current = setTimeout(() => {
      const present = STEPS.filter((step) => findTarget(step.target));
      if (present.length === 0) {
        finish();
        return;
      }
      setSteps(present);
      setStage("tour");
    }, DURATION_MS.exit + 50);
  };

  if (!onClient) return null;

  return createPortal(
    <>
      <Modal
        open={stage === "welcome"}
        onClose={finish}
        width={480}
        title={firstName ? `Bienvenue, ${firstName}` : "Bienvenue"}
        description="Cet espace réunit tout votre projet : où il en est, ce qu'il nous faut de votre part, vos documents et nos échanges."
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <CompactButton variant="quiet" onClick={finish}>
              Plus tard
            </CompactButton>
            <CompactButton data-autofocus onClick={start}>
              Découvrir mon espace
            </CompactButton>
          </div>
        }
      >
        <p className="text-sm text-muted">
          La visite prend une minute. Vous pourrez la revoir à tout moment depuis le menu de votre
          profil.
        </p>
      </Modal>
      {stage === "tour" ? <GuideTour steps={steps} onFinish={finishTour} /> : null}
    </>,
    document.body,
  );
}
