# Portail client

Terminé. Écrans C1 à C9, invitation, révocation, aperçu de l'agence.

## Fait

- Connexion par lien (C2), lien expiré ou déjà utilisé (C9), accès retiré (`/espace/acces-retire`). `proxy.ts` mène `/espace/*` sans session vers C2.
- C3 Mon projet, C4 Messages, C5 menu, C6 Documents avec factures et archive ZIP, C7 Mon site, C8 Mon profil, `/espace/demandes` et fiche (domaine 11.03).
- `getPortalPreferences(db, userId)` et `listPortalRecipients(db, companyId)` pour les automatisations.
- Fiche client : bouton « Inviter dans son espace », carte « Espace client ». Fiche projet : « Ouvrir l'espace client » vers `/espace/apercu/[projectId]`.
- Tests : `tests/integration/portal/`, `tests/e2e/portal.spec.ts`.

## Décisions

- Lectures manquantes (projets, sites, paiements, identité) : fichiers `*.portal.ts` neufs dans les modules propriétaires, jamais de lecture de leurs tables depuis `src/modules/portal`. Même chose pour `users/client-account.service.ts` et `platform/email-outbox.status.ts`.
- Lien d'invitation : `createPortalLinkIssuer` (`server/auth/portal-link.ts`), une instance better-auth dédiée dont l'envoi capture le lien. La route publique ne peut rien renvoyer. L'instance de `getAuth()` reste sur `globalThis` et ne voit pas le rechargement à chaud.
- Prestataires exclus des interlocuteurs du client.
- `in_validation` et `blocked` restent internes : `getProjectForPortal` renvoie un `stage`. `qualified` s'affiche « Reçue ».
- Rail : jalons `client_visible` réels, pas 4 étapes figées.
- Paiements : échéancier du projet, à défaut montant vendu, avec le plus grand de « échéances payées » et « factures partagées payées ».
- `loading.tsx` : jamais au-dessus d'une route `[id]`, sinon un 404 part en 200. Groupes `(accueil)` et `(liste)`, garde dans `demandes/[id]/layout.tsx`.
- Fichier absent du stockage dans l'archive : écarté, et listé dans `fichiers-indisponibles.txt` dans l'archive.

## Non livré, volontairement

- « Changer la photo » : aucun stockage d'avatar. Non affiché.
- Dictée vocale de C4 : non affichée.
- Mode « Modifier » sur le vrai site : remplacé par une demande écrite, avec le même geste.
- Téléphone et e-mail : lecture seule. Twenty en est maître et `PortalContext` n'a pas de `crm`.
