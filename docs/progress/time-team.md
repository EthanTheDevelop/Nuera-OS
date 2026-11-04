# Lot Temps et équipe

## Fait

- Pages : `/temps`, `/temps/historique`, `/equipe`, `/equipe/[id]`, `/equipe/missions`, `/equipe/missions/[id]`, `/equipe/prestataires`, `/equipe/archives`.
- Listes de l'équipe dans le groupe de routes `equipe/(listes)` avec leur `loading.tsx` : les fiches et missions restent hors du squelette, sinon Next répond 200 au lieu de 404.
- Exposé : `getProjectTimeTotals`, `getTimeCostCents`, `getTimeTotals`, `getCapacityOverview`, `getSixWeekLoad`, `listTimeEntriesForCompany`, `listMissionsForCompany`.
- Tests : `tests/integration/time-team/{time,team,audit}.test.ts`, `src/modules/time/time-format.test.ts`.
- Audit indépendant fait : voir « Corrigé à l'audit ». 25 mutations du code sensible, toutes détectées par les tests.

## Corrigé à l'audit

- 404 réel sur fiche ou mission hors périmètre (200 auparavant), page introuvable dans la coque.
- Mission annulée, tâche archivée, fiche archivée ou inactive : plus aucun accès au projet, à la tâche, à la demande.
- Modifier une saisie ou une mission ancienne ne détache plus un projet clos, une demande close, une tâche terminée, un membre archivé.
- Dates impossibles refusées à la validation, réception de livrable dans le futur refusée.
- Budget à 80 % visible dans Dépassements, y compris sans estimation (associés seulement).
- Renvoi identique d'une fiche ou d'une mission : aucun audit. Verrous sur créations, absences, transitions et jour de saisie.
- Archivage retenu aussi par demandes et projets ouverts ; restauration refusée si l'adresse est reprise.
- Couleur des barres au moment exact de la fin de montée : mesuré, warn et danger.

## Reste

- « Frise du jour avec trait maintenant » de `motion.md` : non livrée. Ni maquette ni note Figma, et `time_entries` ne porte aucune heure.

## Décisions

- `conditions` suit la règle des coûts (`team:read_costs`) : texte libre contenant des tarifs.
- Saisie dans le futur refusée, journée limitée à 24 h, doublon identique sous 10 s sans effet.
- Le forfait d'un contrat n'est pas consommé par une saisie : il l'est par les interventions (lot Contrats).
- Jours fériés non déduits de la capacité : aucune donnée ne les porte.

## Demandes aux autres lots

- Socle interface : `SelectField` transmet `defaultValue` même avec `value`. `BuildScript` déclenche en développement l'avertissement React « script tag » sur toute réponse 404.
- Administration : changer le rôle d'un compte relié vers ou depuis `contractor` doit respecter le type de la fiche.
- Pilotage : `getCapacityOverview` et `getSixWeekLoad` restent à brancher.
