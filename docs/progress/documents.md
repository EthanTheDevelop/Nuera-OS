# Lot Documents et connaissances · avancement

État : terminé et audité, en attente de relecture et de commit par le responsable.

## Fait

- Stockage `src/integrations/storage` : interface prête pour S3, disque local sous `STORAGE_DIR`, clés générées, liste de types contrôlée sur l'extension et le contenu, taille maximale, sha256.
- Routes `src/app/api/documents` : dépôt en flux, nouvelle version, téléchargement sécurisé (pièce jointe, nosniff, 404 hors périmètre), aperçu `?apercu=1` pour PDF et images.
- Services documents, connaissances et modèles. Tests dans `tests/integration/documents` : service, connaissances, stockage, routes HTTP (`routes.test.ts`), défauts d'audit (`regressions.test.ts`).
- Écrans `/documents` (classement par type et partage), fiche document, `/documents/connaissances` et fiche article, `/documents/modeles` et fiche modèle. Champ `UploadField` réutilisable.

## Décisions

- Le corps de la requête de dépôt est le fichier, les champs viennent de l'URL : aucun chargement en mémoire.
- Le portail ne télécharge que la version de référence.
- Listes dans le groupe `(liste)` : un `loading.tsx` parent fige le statut à 200, ce qui empêchait tout vrai 404 sur les fiches. Les fiches n'ont donc pas de squelette de chargement.
- Prestataire : documents de ses projets et de ses demandes assignées, jamais devis, contrat, facture ni document lié à un contrat ou un devis.
- Changer la version de référence fait retomber un accord en brouillon, comme un nouveau fichier.
- Un lien déjà en place reste valable et proposé si son objet a été archivé depuis.
- Aperçu : nouvel onglet, jamais de SVG ni de texte. Journalisé comme un téléchargement, avec `preview: true`.

## À trancher

- Un collaborateur ou un lecteur lit les documents de type facture alors que `finance:read` est réservé aux associés.

## Liens à poser par les autres lots

- Fiche client, projet, contrat, site, demande : `/documents?client=`, `projet=`, `contrat=`, `site=`, `demande=`, et `listDocumentsFor` (aussi `quoteId`).
- Fiche site ou projet : `/documents/connaissances?site=` ou `projet=`, et `listKnowledgeArticles(ctx, { siteId })`.
- Projets : `listProjectPlanTemplates(ctx, { activity })`.
- Portail : `listDocumentsForPortal`, `uploadClientFile`, route `/api/documents/upload` et `UploadField`.
- Fiche client 360° : `listDocumentsForCompany(ctx, companyId, { limit })`.
