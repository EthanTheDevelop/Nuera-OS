# Parcours de bout en bout

Terminé.

## Fait

- Six parcours sous `tests/journeys/` : vrais services sur PGlite, faux seulement pour Twenty et DocuSeal. `tests/e2e/journeys.spec.ts` joue les parcours 1 et 6 dans un navigateur.
- Défauts trouvés et corrigés : contrats jamais démarrés à la mise en ligne ; aucune marge sur la fiche projet ; routes de documents sans contrôle d'enrôlement à la double authentification ; 500 sur l'export des finances pour un compte à enrôler.
- Reprises de l'audit : barre latérale sur `/profil`, thème du menu enregistré, seed des automatisations, `domain-model.md`, enseignements.

## Décisions

- `activateContractsForSite` est appelé par `changeSiteStatus` et `activateSiteAfterGoLive`, y compris si le site était déjà en ligne.
- Une route de documents redirige un compte à enrôler ; un dépôt en `fetch` reçoit donc une erreur générique. Les écrans le redirigent avant.
- Thème : une bascule refusée revient à l'ancien thème.

## Limites

- Les documents du seed n'ont pas de fichier : leur téléchargement répond 404. Le navigateur dépose donc son propre fichier.
- Parcours 6 dans le navigateur : demande et fichiers ; la validation n'est éprouvée que sous `tests/journeys/`.
- Deux navigateurs peuvent garder des thèmes différents : le cookie reste le choix du navigateur.
