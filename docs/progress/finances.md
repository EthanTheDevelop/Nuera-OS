# Lot Finances et rentabilité · avancement

## Fait

- Services : `finance.service.ts`, `import.service.ts`, `profitability.service.ts` (getMargin, source unique), `finance.export.ts`. Portées projet, client, site, contrat ; prévu et réel séparés, détail lisible.
- Écrans : `/finances`, `(listes)/{echeancier,couts,imports,rentabilite}`, détails `factures/[id]`, `echeancier/[id]`, `imports/[id]`, `rentabilite/[scope]/[id]`, `not-found`, chargements. Route `/api/finance/export` (401 anonyme, 403 hors associé).
- Indy : `src/integrations/indy`. Recherche refaite le 2026-11-04 (indy.fr, wikicompta.indy.fr) : aucune API publique documentée. État « API à vérifier », CSV et saisie manuelle.
- Tests : `tests/integration/finance` (89 verts, dont `hardening.test.ts` issu de l'audit).
- Navigateur : parcours complet à 1440, pas de défilement horizontal à 390, marquage payé, annulation, co-traitance, import, rapport, export, 404, rôles, thème sombre.
- Audit (2026-11-05) : verrou de ligne sur l'échéance, `?vue=constructor` et identifiants d'URL en 404, recherche longue, fichier trop lourd, export d'avoirs, émetteur associé seulement, journal avant/après, filtres de coûts, retards de paiement, liens archivés conservés.

## Reste

- Rien dans le périmètre du lot. Voir les demandes ci-dessous.

## Décisions

- Émetteur : un associé (A12). Actif à la saisie ; à l'import, un associé parti reste reconnu, ses factures restent vraies.
- Échéance : `getScheduleItemForUpdate` avant de lire ses totaux. Sans lui, sur le PostgreSQL de développement, 12 essais sur 12 dépassaient le montant et laissaient une échéance payée en « facturée ». PGlite ne peut pas le montrer.
- Import d'une référence d'échéance : un montant Indy qui dépasse l'échéance n'est pas refusé, Indy fait foi.
- Pas d'action « Relancer » : la relance part d'Indy. `/finances` liste les retards et leur ancienneté.

- Marge : `getMargins` par lots, `getMargin` en est le cas unitaire. Temps via `getTimeTotals` du module Temps (`getTimeCostCents` le lit aussi ; il faut ici les minutes).
- Pages de détail hors de tout `loading.tsx` : sinon la réponse part en 200 avant le `notFound()`. D'où les groupes `(synthese)` et `(listes)`.
- `AmountRows` dans le lot : `InfoRows` du kit laisse le montant déborder quand le libellé est long.
- Le statut affiché d'une facture se calcule depuis l'échéance : l'écran reste juste même si la tâche quotidienne n'a pas tourné.

## Demandes aux autres lots

- Automatisations : appeler `markOverdueInvoices(db, now)` depuis `src/app/api/jobs` (aucun appelant aujourd'hui, `invoice.overdue` n'est donc pas émis hors import et saisie).
- Socle données : `archived_at` sur `direct_costs` et `payment_schedule_items` (retrait physique tracé dans l'audit pour l'instant).
- Socle interface : `InfoRow` (`dd` en `min-w-0`) ; message React « script tag » sur les pages 404, aussi vu sur `/contrats/…`.
- Portail : brancher `listInvoicesForPortal`. Pilotage : `getFinanceSummary`, `listOverdueInvoices`.
- Authentification : un envoi du formulaire de connexion avant l'hydratation part en GET, mot de passe dans l'URL (vu en dev : `/login?email=…&password=…`).
