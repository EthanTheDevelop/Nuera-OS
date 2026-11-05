# Portail client

Écrans C1 à C9, invitation, révocation, aperçu de l'agence. Audit indépendant passé, voir plus bas.

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
- Aperçu de l'agence : paiements masqués sans `finance:read`, le client les voit toujours.
- Révoquer efface aussi les liens de connexion encore valables du compte.
- Adresse de la fiche différente de celle du compte : ni renvoi ni lien à copier, il faut retirer l'accès puis réinviter.
- Une validation porte la version affichée au client. Contrôle dans le service du portail, hors du verrou de `recordDeliverableReview` : la fenêtre restante est de quelques millisecondes.

## Corrigé par l'audit (preuve navigateur ou test, test de non-régression)

- Aperçu : un lecteur et un collaborateur lisaient les montants réglés sans `finance:read`.
- `/espace/apercu/abc` répondait 500 ; `/espace/documents/archive` et l'agenda répondaient 500 à un membre de l'équipe.
- `?page=99999999999999999999` faisait tomber C6. Une page au-delà de la dernière ramène à la dernière.
- Onglet ouvert après une révocation : une action menait à `/login`, la connexion de l'équipe.
- Un lien transmis avant une révocation revivait à la réinvitation.
- Fiche passée à l'adresse d'un autre client : le lien aurait ouvert le compte de cet autre client.
- Deux versions du même texte en une minute dans « Modifier mon site » ou « Nouvelle demande » : la seconde était perdue, le client lisait « envoyée ».
- Contenu attendu envoyé deux fois par écrit : deux messages. Marquage et message sont maintenant dans une seule transaction.
- C4 : texte effacé si le message joint échouait, rejets non gérés.

## Non livré, volontairement

- « Changer la photo » : aucun stockage d'avatar. Non affiché.
- Dictée vocale de C4 : non affichée.
- Mode « Modifier » sur le vrai site : remplacé par une demande écrite, avec le même geste.
- Téléphone et e-mail : lecture seule. Twenty en est maître et `PortalContext` n'a pas de `crm`.

## Reste à trancher ou à faire

- Mouvement réduit : `useMotionPreset` (`components/motion`, hors de ce lot) rend un préréglage différent au serveur et au client : avertissement d'hydratation sur C4 et C7.
- `/espace/demandes` : plafond de 100 demandes, sans pagination.
- Une fiche ou une entreprise archivée dans le CRM ne retire pas l'accès au portail : à révoquer à la main.
- Un e-mail d'invitation en attente part quand même après une révocation ; son lien mène alors à C9.
