# Lot CRM et ventes · avancement

## Fait

- Services, repositories, schémas, machine à états, `markQuoteSent`, `markOpportunityWon`, `reconcileCrm` (tâche), `syncCrmNow` (bouton), import CSV, doublons, fusion.
- Route `POST /api/webhooks/twenty` (`crm.webhook.ts`), vérifiée avec de vraies livraisons de Twenty local.
- Écrans : `/clients` (07), `/clients/[id]` (04), `/clients/contacts`, `/clients/contacts/[id]`, `/clients/doublons`, `/pipeline` (03, Kanban et liste), `/pipeline/[id]`.
- Fiche 360° : `company.related.ts` lit projets, devis, contrats, demandes, documents, sites, marge et factures par les services de leurs modules ; `record/related-sections.tsx` les affiche. Une section en panne se dit indisponible sans faire tomber la fiche.
- Historique du client : échanges, étapes, rendez-vous passés, événements (`domain_events`) ; une facture payée exige `finance:read`.
- Fiche d'une affaire : section « Devis et projet », lien « Nouveau devis » prérempli, rendez-vous liés.
- Tests : `tests/integration/crm-ventes/`, dont `audit.test.ts`.

## Audit : corrigé

- Modifier une affaire effaçait son contact, ici et dans Twenty (`opportunity-form.tsx`).
- Une activité liée à une affaire ou un contact sans client finissait en erreur SQL, la note déjà partie dans Twenty.
- Écritures acceptées sur une fiche archivée ou absorbée : seul l'écran les masquait.
- Deux déplacements simultanés contournaient la machine : la ligne reste verrouillée pendant l'appel à Twenty.
- Cases du formulaire de contact perdues après une erreur de validation ; titre illisible des doublons par nom.

## Non vérifié

- « Connexion requise » et Twenty coupé dans le navigateur : l'environnement partagé configure Twenty. Couvert par les tests de service.
- `markQuoteSent` et `markOpportunityWon` : appelés par `quote-signature.service.ts`, parcours complet non rejoué ici contre le vrai Twenty.
- Acompte et solde de la frise de l'écran 04 : pas de lecture d'échéancier par client exposée par Finances.

## Tests navigateur

- `tests/e2e/crm-forms.spec.ts` (sans écriture) : `E2E_ADMIN_EMAIL` et `E2E_ADMIN_PASSWORD` requis, sinon ignoré.

## Décisions

- Clic sur une carte : fiche de l'affaire `/pipeline/[id]`, qui mène à la fiche client (la maquette dit 04). Une affaire peut n'avoir aucun client, et ses échanges n'ont pas d'autre place.
- 6 colonnes (A2), défilement interne au tableau, comme la maquette qui dépasse déjà.
- `ToggleChip` local : `FilterChip` ne sait ni retirer un filtre au clic, ni lever plusieurs paramètres.
- Vérifications d'existence dans `[id]/layout.tsx`, au-dessus de `loading.tsx` : vrai 404. Listes dans des groupes `(liste)`.

## Demandes aux autres lots

- Portail : bouton « Inviter dans son espace » et ligne « Espace client » de la carte Contact (`src/modules/portal` n'existe pas encore).
- Socle interface : `KanbanColumnDef` sans total : le compteur d'une colonne plafonne à 40 cartes.
- Automatisations : planifier `reconcileCrm({ db, crm })`.
