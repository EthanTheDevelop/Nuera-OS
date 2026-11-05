# Pilotage

Écrans 01, 06, 16, M1, M2, recherche globale. Terminé. Calculs partagés (A3) : `src/modules/dashboard/metrics.service.ts`.

## Fait

- 26 tuiles (`dashboard.tiles.ts`) : 15 sur le tableau d'un nouveau compte (12 de la maquette, Priorités, Alertes, Vue d'ensemble), 11 en galerie. Chacune vérifie sa permission et échoue seule.
- Édition : glisser, galerie, format, retrait, clavier (flèches, Suppr), Annuler, Terminé. Disposition validée côté serveur, par compte, dans `user_preferences.dashboard_layout`.
- Reporting : période, activité, découpage, 4 mesures, tableau par activité, ventes, prévision, export CSV (`/api/reporting/export`).
- Recherche ⌘K : 10 sources, branchée dans `(app)/layout.tsx`.
- Accueil : prestataire redirigé, `home_path` suivi à l'arrivée.
- Tests : `tests/integration/dashboard` (39).

## Décisions

- Mode édition : état de l'adresse, `/?edition=1`. Il charge aussi les tuiles de la galerie, pour montrer de vraies données à l'ajout.
- La poignée parcourt les formats de la tuile et enregistre aussitôt hors édition (note de 01, prototype `59:481`). 4×2 réservé au chiffre d'affaires.
- « journées prévues » plutôt que « vendues » : `plannedMinutes` est du temps saisi plus le reste à faire.
- `home_path` suivi à l'arrivée seulement (adresse saisie, favori, sortie de connexion, d'après le `Referer`) : un clic sur « Tableau de bord » reste libre.
- Marge du reporting : total par client (une facture à la fois sur un projet et un contrat ne compte qu'une fois), ventilation par projet et contrat, toujours via `getMargins`. La courbe part de 0 : une marge négative se lit dans l'info-bulle.
- Prévision : certain = échéances non facturées ; probable = devis ouverts × probabilité de l'affaire ; hypothétique = affaires ouvertes sans devis en cours. Récurrent à venir non compté.
- Enregistrer une disposition : audit, pas d'événement métier (`domain_events` ne décrit pas les préférences).
- Filtre « contexte » du cadrage : activité, dans le menu de période. Il porte sur le CA, la marge et le tableau, pas sur le MRR ni la conversion (les affaires n'ont pas d'activité).
- Recherche : sans accents ni casse (`translate`), `%` et `_` échappés, 5 lignes par source. Documents via `searchDocuments`, qui garde les factures et le périmètre.

## Limite connue

- Grille du tableau : `TileGrid` indexe ses enfants par position et remonterait une tuile déplacée. Le tableau pose donc sa propre grille, mêmes classes.
