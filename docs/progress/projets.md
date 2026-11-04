# Lot Projets et production

## Fait

- Services, repositories, actions, machines de statuts : `src/modules/projects/*`.
- Écrans : `/projets` (08, dans le groupe `(liste)`), `/projets/[id]` (17), fenêtre tâche M4 par `?tache=<id>`, `/projets/calendrier`, chargement, introuvable.
- Formulaires en fenêtre : projet, jalon, tâche, sous-tâche, livrable, contenu attendu, blocage, demande de changement, intervenant.
- Transformation d'une demande en devis ou avenant, tout ou rien : `change-request.conversion.ts`.
- Tests : `tests/integration/projects/` (150, dont `hardening.test.ts` : périmètre, projets clôturés, répétitions simultanées, conversion).

## Décisions

- Écritures d'un projet : verrou de la ligne projet dans la transaction, puis relecture (`lockEditableProject`, `lockExistingProject`). Une répétition simultanée voit l'effet de la première.
- 404 réel : `[id]/layout.tsx` vérifie l'accès au-dessus de `loading.tsx`, `not-found.tsx` remonte d'un niveau, la liste passe dans `(liste)`.
- Prestataire : une fiche inactive ou un projet archivé ne donnent plus rien, tâches comprises. Documents lus par `listDocumentsFor`, jamais les pièces commerciales.
- Sans modèle `checklist`, un projet reçoit la passation standard (05.05.03).
- Machine des demandes : `accepted → converted`. Clé de `budget.threshold_80` alignée sur `time.service`.
- Retard client (figma-map §7) : chemin manuel, date du projet et décision du blocage, comme l'écran 17. Pas de report automatique.

## Reste

- « Ouvrir l'espace client » : aucune route `/espace`.
- Jalons, livrables, contenus attendus et points de passation ne se suppriment pas (pas de colonne d'archive).
- Pas de test Playwright sous `tests/e2e`.

## Demandes aux autres lots

- Portail : route d'aperçu agence (C3). Brancher `recordDeliverableReview`, `markRequirementReceived` avec `PortalContext`.
- Automatisations : planifier `sweepProjectBudgets(db)` et `listOverdueTasks(db, now)`.
- Devis : un avenant signé ne met à jour ni `budget_cents` ni `estimated_minutes` du projet. À trancher.
- Socle interface : `CommentComposer` vide le champ même en échec ; `BuildScript` émet un avertissement React sur les pages 404.
- Responsable : `tests/integration/contract-stubs.test.ts` est obsolète. `tests/integration/contracts` ne se termine pas.
