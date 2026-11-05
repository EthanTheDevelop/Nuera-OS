# État d'avancement

Reprise après interruption : lire ce fichier, `CLAUDE.md`, puis `docs/domain-model.md`. Branche : `feat/create-nuera-os`, sur GitHub à `10afe57`, les commits suivants sont locaux. Elle intègre `origin/staging` (`72a6693`). Détail par lot : `docs/progress/<lot>.md`.

## Fait

- Reconnaissance du dépôt, de Figma et de la spécification. 33 écrans cartographiés (`docs/design/`).
- Contrat de domaine et arbitrages (`docs/domain-model.md`).
- Twenty v2.55.0 local (`docker-compose.twenty.yml`) et adaptateur vérifié sur l'instance réelle.
- Socle données : schéma, migration, rôles, permissions, événements.
- Socle interface : tokens, mouvement, composants, barre latérale, connexion.
- Lots métier, chacun construit puis audité : Messages, Documents, Temps et équipe, Projets, CRM et ventes, Devis, Contrats, Sites, Support, Finances.
- Stabilisation (`docs/progress/stabilisation.md`) : tests fiables, formulaires d'authentification en POST, migration d'archivage, factures, avenants, kit d'interface, 404.
- Portail client, Pilotage, Automatisations et administration. Les six parcours : `tests/journeys/`, `tests/e2e/journeys.spec.ts`.
- Revue de sécurité (`docs/security-review.md`).
- Exploitation : image vérifiée dans Docker, volume des documents, sondes de santé, sauvegarde et restauration essayées pour de vrai (`docs/ops/sauvegarde-restauration.md`), guide de déploiement (`docs/deployment-coolify.md`), README.

- Données fictives de staging : `npm run db:seed:staging`, `cli/db-seed-staging.mjs` dans l'image, garde-fous `SEED_ALLOWED=true` et base `nuera_os_staging` (`docs/ops/donnees-staging.md`). Essayé sur PostgreSQL 16 local, production refusée.

## En cours

- Rien.

## Restant, dans l'ordre

1. Vérification complète finale (e2e sur le code fusionné) et rapport final.
2. Par le responsable, avec ses accès : déploiement Coolify, base hébergée, destination de sauvegarde chiffrée, planification des tâches et de la sauvegarde, Twenty de production.

## Arbitrages du responsable après la vague métier

- Documents de type facture : lisibles avec `finance:read` ou par la personne qui les a déposés, 404 sinon.
- Marge estimée sur un devis : reste visible avec `quotes:update`, car elle sert à construire l'offre. Les coûts des membres restent réservés à `team:read_costs`.
- Avenant signé : il augmente le budget et le temps prévus du projet, une seule fois, sauf s'il vient d'une demande de changement déjà comptée.
- Rendez-vous : visibles côté client seulement si `client_visible` est coché.

## Limites connues, à reprendre dans le rapport final

- `sites.contract_id` et `contract_sites` portent le même lien : le module Contrats lit les deux, le formulaire de site n'écrit que le premier.
- Les verrous `FOR UPDATE` ne sont pas couverts par les tests PGlite. Ils ont été éprouvés par des scripts ponctuels sur PostgreSQL.
- Aucun appel réel à DocuSeal, Coolify, Uptime Kuma, OpenAI ni Cal : adaptateurs vérifiés contre des bouchons locaux et la documentation officielle.
- Migrations automatiques de Twenty en production : chemin non exercé.
- Sauvegarde : rclone essayé vers un dossier local seulement. Rien n'a été exécuté sur Coolify ni sur un serveur réel.
- Image de base `node:24-alpine` non épinglée par digest, contrairement à la recommandation du `Dockerfile` : à trancher.

## Environnement local

- Node 24 absent de la machine : copie portable hors dépôt, à ajouter au `PATH`.
- Conteneurs : `nuera-os-postgres-1`, `nuera-twenty-*`.
- La base de développement garde des lignes d'essai archivées : `npm run db:seed` sur une base neuve repart propre.
