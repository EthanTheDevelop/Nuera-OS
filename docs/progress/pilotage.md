# Pilotage

Écrans 01, 06, 16, M1, M2, recherche globale. Terminé. Calculs partagés (A3) : `src/modules/dashboard/metrics.service.ts`.

## Fait

- 26 tuiles (`dashboard.tiles.ts`) : 15 sur le tableau d'un nouveau compte (12 de la maquette, Priorités, Alertes, Vue d'ensemble), 11 en galerie. Chacune vérifie sa permission et échoue seule.
- Édition : glisser, galerie, format, retrait, clavier (flèches, Suppr), Annuler, Terminé. Disposition validée côté serveur, par compte, dans `user_preferences.dashboard_layout`.
- Reporting : période, activité, découpage, 4 mesures, tableau par activité, ventes, prévision, export CSV (`/api/reporting/export`).
- Recherche ⌘K : 10 sources, branchée dans `(app)/layout.tsx`.
- Accueil : prestataire redirigé, `home_path` suivi à l'arrivée.
- Tests : `tests/integration/dashboard` (49), `tests/e2e/pilotage.spec.ts` (5, sans écriture, comptes par `E2E_ADMIN_*` et `E2E_VIEWER_*`).

## Audit indépendant

Parcouru en navigateur avec associé, membre, lecture, prestataire et deux clients, à 1440 et 390 px, au clavier, au doigt, hors ligne et en mouvement réduit.

Corrigé, chaque fois prouvé avant :

- `/reporting?mesure=marge` en membre ou lecture : aucun onglet actif. Une mesure hors du rôle retombe sur la première.
- Export d'un compte à enrôler en double authentification : 500 au lieu de la redirection (`unstable_rethrow`).
- Priorités : interventions de contrats résiliés, expirés, suspendus ou archivés proposées comme à venir.
- `/` tombait entièrement si les notifications ne se lisaient pas : la cloche manque, le tableau reste.
- Terminé ou poignée hors ligne : écran d'erreur et édition perdue. Désormais un message, le tableau reste en cours.
- Export hors ligne ou en échec : la page quittait l'application vers une erreur brute. Désormais `fetch`, puis téléchargement ou message.
- Focus du clavier perdu en retirant une tuile ou en ajoutant depuis la galerie : il passe à la voisine.
- États vides : « Créer une affaire » et « Planifier un rendez-vous » ne sont plus proposés sans le droit d'écrire.
- Carte CA en erreur : plus de « Rien à comparer » trompeur sous le tiret.

Vérifié sans défaut : la recherche ne sort rien du périmètre d'un prestataire (2 tâches, 1 projet, ses documents) ni de facture sans `finance:read` ; membre et lecture ne reçoivent aucun chiffre des finances, même avec une disposition d'un ancien rôle ; adresses fantaisistes ; 390 px sans défilement horizontal ; poignée au doigt.

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

## Limites connues

- Grille du tableau : `TileGrid` indexe ses enfants par position et remonterait une tuile déplacée. Le tableau pose donc sa propre grille, mêmes classes.
- Édition à 1440 px : comme dans la maquette 06, le panneau recouvre les colonnes 5 et 6. Une tuile dessous ne s'atteint qu'au clavier.
- Au doigt, le glisser ne fait pas défiler la page : une tuile se déplace de proche en proche, entre tuiles visibles.
- Pipeline et Devis à signer montrent des montants commerciaux à membre et lecture, qui les lisent déjà sur `/pipeline` et `/devis` (`sales:read`, `quotes:read`). Ce ne sont pas des chiffres de `finance:read`.
- États d'erreur et « connexion requise » d'une tuile, base vide : couverts par les tests, pas vus en navigateur (il faudrait casser la base partagée).
