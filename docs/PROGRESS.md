# État d'avancement

Reprise après interruption : lire ce fichier, `CLAUDE.md`, puis `docs/domain-model.md`. Branche : `feat/create-nuera-os`, locale, rien n'est poussé. Détail par lot : `docs/progress/<lot>.md`.

## Fait

- Reconnaissance du dépôt, de Figma et de la spécification. 33 écrans cartographiés (`docs/design/`).
- Contrat de domaine et arbitrages (`docs/domain-model.md`).
- Twenty v2.55.0 local (`docker-compose.twenty.yml`) et adaptateur vérifié sur l'instance réelle.
- Socle données : schéma, migration, rôles, permissions, événements.
- Socle interface : tokens, mouvement, composants, barre latérale, connexion.
- Lots métier, chacun construit puis audité : Messages, Documents, Temps et équipe, Projets, CRM et ventes, Devis, Contrats, Sites, Support, Finances.

## En cours

- Stabilisation : demandes croisées entre lots, migration d'archivage, correctifs du kit d'interface.

## Restant, dans l'ordre

1. Portail client, Pilotage (tableau de bord, reporting, recherche), Automatisations et administration.
2. Parcours de bout en bout (`tests/journeys/`), revue de sécurité (permissions, cloisonnement du portail, 2FA).
3. Déploiement et exploitation : Coolify, Docker, sauvegarde et restauration, sondes de santé.
4. README, documentation, vérification complète (`npm run check`, build, e2e), rapport final.

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

## Environnement local

- Node 24 absent de la machine : copie portable hors dépôt, à ajouter au `PATH`.
- Conteneurs : `nuera-os-postgres-1`, `nuera-twenty-*`.
- La base de développement garde des lignes d'essai archivées : `npm run db:seed` sur une base neuve repart propre.
