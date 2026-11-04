# État d'avancement

Reprise après interruption : lire ce fichier, `CLAUDE.md`, puis `docs/domain-model.md`. Branche : `feat/create-nuera-os`.

## Fait

- Reconnaissance du dépôt, de Figma et de la spécification. 33 écrans cartographiés (`docs/design/`).
- Contrat de domaine et arbitrages (`docs/domain-model.md`).
- Twenty v2.55.0 local (`docker-compose.twenty.yml`).

## En cours

- Adaptateur Twenty, vérifié sur l'instance réelle.

## Restant, dans l'ordre

1. Socle données : schéma complet, migration, rôles, permissions, événements.
2. Socle interface : tokens, polices, mouvement, composants, barre latérale, connexion.
3. Lots métier en parallèle (répartition en `docs/domain-model.md` §8).
4. Portail, pilotage, automatisations et administration.
5. Parcours de bout en bout, revue de sécurité, finitions, documentation.

## Environnement local

- Node 24 absent de la machine : copie portable hors dépôt, à ajouter au `PATH`.
- Conteneurs : `nuera-os-postgres-1`, `nuera-twenty-*`.
