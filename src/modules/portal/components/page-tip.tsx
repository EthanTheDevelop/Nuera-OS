import { loadPortalGuide } from "../portal.page";
import type { PortalTipKey } from "../portal.schema";
import { DismissibleTip } from "./portal-tip";

const TIPS: Record<PortalTipKey, string> = {
  messages:
    "Écrivez-nous ici : nos réponses arrivent dans ce fil, et vos fichiers restent à portée.",
  documents: "Tout ce que nous échangeons est ici : choisissez un document pour le télécharger.",
  "mon-site": "Dites-nous quoi changer sur votre site et suivez ici chacune de vos demandes.",
  demandes: "Une question, un souci ? Ouvrez une nouvelle demande et suivez ici son avancement.",
};

/** Le serveur décide : un conseil déjà fermé n'est jamais envoyé, donc rien ne clignote. */
export async function PortalPageTip({ tip }: { tip: PortalTipKey }) {
  const { dismissedTips } = await loadPortalGuide();
  if (dismissedTips.includes(tip)) return null;
  return <DismissibleTip tip={tip} text={TIPS[tip]} />;
}
