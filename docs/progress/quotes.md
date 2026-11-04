# Lot Offres et devis : avancement

Chemins : `src/modules/{quotes,catalog}`, `src/app/(app)/devis`, `src/integrations/docuseal`, `src/app/api/webhooks/docuseal`, `tests/integration/quotes`.

## Fait

- Catalogue, éditeur, versions figées, avenants, machine à états, numérotation, aperçu imprimable, acceptation DocuSeal et manuelle (une transaction, idempotente), webhook, relance J+7 exposée.
- Reprise : vraie réponse 404, panneau d'abord en colonne unique, note de signature honnête, lien de la demande dans la transaction de l'avenant, tests de la route du webhook.
- Audit : coûts masqués au rôle Lecture (service et écrans), une affaire ne donne qu'un projet, affaire close refusée par identifiant, document signé rouvert depuis DocuSeal (`/devis/[id]/document-signe`), recherche longue sans page d'erreur, liens de ligne sans `version`, lien d'affaire vers `/pipeline/[id]`, boutons sans effet retirés, demande caduque à l'expiration, ajout au catalogue utilisable au clavier, matrice complète par rôle (`tests/integration/quotes/audit.test.ts`).

## Reste

- Rien dans le périmètre. Non vérifié : vraie instance DocuSeal, fenêtre d'envoi configurée et ouverture du document signé dans un navigateur (le serveur partagé n'a pas de configuration DocuSeal ; couvert par le serveur local de test).
- Pas d'état de chargement sur `/devis/[id]` : un `loading.tsx` y rendrait le 404 en 200.

## Décisions

- Une version envoyée reste figée ; contenu identique : aucune version créée.
- Un avenant ne crée ni projet ni gain d'affaire.
- Webhook sans utilisateur : acteur délégué, journal du devis à `actorId` NULL.
- Coûts visibles avec `quotes:update` ou `catalog:manage` : le collaborateur compose le devis, le rôle Lecture voit les prix seuls. À confirmer par le responsable.
- Second devis accepté sur une affaire : refus ; signature DocuSeal du même cas : tracée, sans effet, sans rejeu du webhook.

## Demandes aux autres lots

- Automatisations : brancher `listQuotesDueForReminder`, `recordQuoteReminder`, `expireOverdueQuotes`. Tant que ce n'est pas fait, la note « relance automatique à J+7 » n'est pas vraie.
- CRM : brancher `listQuotesForCompany` sur la fiche client ; sur `/pipeline/[id]`, lister les devis et lier `/devis?nouveau=1&client=…&affaire=…`.
- Projets : un avenant accepté ne modifie ni budget ni périmètre du projet.
- Socle interface : sur toute page 404, console « Encountered a script tag », probablement `BuildScript`.
