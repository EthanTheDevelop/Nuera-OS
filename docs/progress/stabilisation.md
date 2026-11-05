# Stabilisation

Terminé. Les points 1 à 9 de la consigne sont livrés.

## Fait

1. Vitest plafonné à 4 processus (`vitest.config.ts`) : plus de plantage mémoire, tous les fichiers finissent. Test à retardement corrigé (`deployments.test.ts`, horloge fixée) ; suite contrôlée horloge à +60 et +400 jours et en UTC.
2. `method="post"` sur tous les formulaires d'authentification, `tests/e2e/auth-native-submit.spec.ts`.
3. Migration `0002` : archivage (domaines, coûts, échéances, jalons, livrables, contenus attendus, passation), `appointments.client_visible`, `change_requests.budget_applied_at`. Boutons « Archiver » sur la fiche projet, case « Visible par le client ».
4. Factures : portée `invoicesOfUserId` dans le dépôt documents, `requireDocument` refuse aussi les écritures, listes de documents des fiches projet et tâche alignées.
5. Avenants : `raiseProjectBudgetFromAmendment`, clé d'événement `project.budget_raised:<quoteId>`.
6. `createTimeEntry` refuse une demande clôturée ; `updateTimeEntry` refuse d'y déplacer une saisie.
7. Kit : Modal, SelectField, CommentComposer (saisie gardée, curseur aligné), InfoRow, Kanban `total`, ConnectionRequired `showSettingsLink`, BuildScript.
8. 404 : toutes les routes `[id]` répondent 404, aucun correctif nécessaire, `tests/e2e/routes-404.spec.ts`.
9. Seed, `twenty.md`, `tokens.md`, `motion.md`, `PROGRESS.md`, `domain-model.md`.

Tests : `tests/integration/stabilisation.test.ts`, `src/components/ui/form.test.ts`.

## Décisions

- `change_requests.budget_applied_at` ajouté à la migration : `converted` ne dit pas si `accepted` a précédé, et une demande sans projet n'a rien augmenté. Le statut seul ne suffit pas.
- Idempotence de l'avenant par `domain_events.dedupe_key`, comme les autres répétitions. `emitEvent` renvoie désormais un booléen.
- Un projet clôturé ou archivé reçoit quand même l'avenant signé : le vendu reste exact.
- Le mélange des tests dans un fichier (`--sequence.shuffle`) casse 6 fichiers écrits en scénario continu : seul l'ordre par défaut est garanti.

## Limite connue

- `npx playwright test` complet avec `E2E_ADMIN_*` : les connexions parallèles déclenchent le limiteur de better-auth (3 par 10 s), et « identifiants refusés » lit alors « Trop de tentatives ». Le test passe seul.
