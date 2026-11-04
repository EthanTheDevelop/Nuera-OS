# Lot Sites et infrastructure · avancement

**Fait**

- Services : sites, environnements, déploiements, domaines et TLS, sauvegardes, surveillance, sync Coolify et Kuma. `activateSiteAfterGoLive`, `listSitesForCompany`, `listExpiringDomains`, `listFailedBackups`, `getSitesHealthSummary`.
- Écrans : `/sites` (cartes et tableau), `/sites/[id]` (19 et M3), `/sites/domaines`. Vrai 404 par `[id]/layout.tsx`, au-dessus du chargement ; la liste vit dans le groupe `(liste)`.
- Adaptateurs `src/integrations/{coolify,uptime-kuma}`, webhook `/api/webhooks/coolify`.
- Audit indépendant : défauts corrigés et couverts par `tests/integration/sites/audit-regressions.test.ts` et `webhook-route.test.ts`.

**Restant** : rien dans mes chemins. Voir les vérifications impossibles ci-dessous.

**Non vérifié**

- Coolify et Kuma réels : testés contre un serveur HTTP local, aucun service réel contacté.
- Déploiement réussi à l'écran, boutons Synchroniser et bandeaux de péremption : le serveur de dev n'a pas Coolify configuré. Dialogues et états du bouton vus par une page temporaire, retirée.

**Décisions**

- Sauvegardes Coolify : par base de données seulement, attribuées à un environnement si une seule application reliée vit dans le même environnement Coolify.
- Erreurs serveur (M3) : aucune route publique de Kuma ne les donne, « indisponible ».
- Kuma répond 200 et des listes vides pour une page inconnue : « connexion requise », jamais un succès.
- Un domaine n'a pas d'`archived_at` : le retirer est une suppression auditée, confirmée. Colonne demandée.
- Une application Coolify et une sonde ne se relient qu'à un seul site actif (contrôle de service, pas de contrainte au schéma).
- Seul un site `live` ouvre une panne et un incident. Les autres gardent leur mesure.
- Un déploiement ou une sauvegarde découvert fini depuis plus de 24 h entre dans l'historique sans événement.

**Demandes aux autres lots**

- Automatisations : `/api/jobs` doit appeler `runCoolifySync`, `runUptimeKumaSync`, `runDomainTlsChecks`. `/reglages/connexions` répond encore 404.
- Route `/api/webhooks/uptime-kuma` hors de mes chemins : `parseUptimeKumaWebhook`, `isValidWebhookToken` et `handleUptimeKumaNotification` sont prêts.
- Responsable : `tests/integration/contract-stubs.test.ts` attend encore des squelettes qui lèvent.
