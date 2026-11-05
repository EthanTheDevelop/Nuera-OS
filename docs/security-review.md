# Revue de sécurité de Nuera OS

Revue indépendante de toute l'application, le 5 novembre 2026, sur la branche `feat/create-nuera-os`. Elle s'ajoute aux audits par lot : ceux-ci regardaient un module, celle-ci regarde ce qui les traverse.

Méthode : lecture du code, sondes sur le serveur de développement (port 3000, base seedée) et tests de non-régression sur PGlite. Une route supposée fermée n'a été sondée qu'à vide et sans session. Les lignes créées pour les essais ont été retirées.

**Bilan.** Six défauts corrigés, de gravité moyenne à faible. Aucune fuite de données entre clients ou entre rôles, aucune injection, aucun secret dans l'historique. Trois points attendent une décision ou un contrôle (voir « Ce qui reste »).

**À faire après cette revue : redémarrer le serveur.** L'instance better-auth vit sur `globalThis` et survit au rechargement à chaud. Tant que le serveur de développement n'a pas redémarré, il garde les anciennes routes ouvertes. La fermeture a été vérifiée par le vrai routeur (`auth.handler`) en test, pas encore sur le port 3000.

## Ce qui a été trouvé et corrigé

| #   | Gravité | Défaut                                       | Correction                                                              | Test                                                 |
| --- | ------- | -------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Moyenne | Routes better-auth inutilisées mais ouvertes | 25 routes fermées, en plus des 15 routes admin                          | `tests/integration/security/auth-surface.test.ts`    |
| 2   | Moyenne | Corps de webhook lu sans limite              | `readBodyWithin` (`src/server/http/limited-body.ts`) sur les 6 webhooks | `tests/integration/security/hardening.test.ts`       |
| 3   | Faible  | Mot de passe client accepté à la connexion   | Refus en production, même réponse qu'un mauvais mot de passe            | `auth-surface.test.ts`                               |
| 4   | Faible  | Coque visible sans double authentification   | Notifications, compteurs et associés non lus pour un compte à enrôler   | `tests/integration/security/enrolment-shell.test.ts` |
| 5   | Faible  | Lien de notification à tabulation accepté    | `isInternalHref` refuse les caractères de contrôle                      | `hardening.test.ts`                                  |
| 6   | Faible  | Formes IPv6 absentes du filtre SSRF          | `::/96`, 6to4, Teredo et NAT64 local refusés                            | `hardening.test.ts`                                  |

### 1. Routes better-auth ouvertes

Les routes admin étaient déjà fermées. Il restait toutes les autres, y compris celles que l'interface n'appelle jamais. Constaté avec un compte de test jetable :

- `POST /api/auth/update-user` avec `{"name":"<img src=x onerror=alert(1)>","image":"javascript:alert(1)"}` répondait 200 et écrivait les deux champs : ni validation, ni limite de longueur, ni journal. N'importe quelle session pouvait le faire, client compris, et prendre le nom de quelqu'un d'autre dans une conversation. React échappe ce nom à l'affichage : c'est une usurpation de nom, pas une faille XSS.
- `GET /api/auth/list-sessions` et `GET /api/auth/get-session` rendaient le jeton de session en JSON, ce qui annule en partie le cookie `HttpOnly` si un script s'exécute un jour dans la page.
- `POST /api/auth/verify-password` permettait de tester un mot de passe depuis une session volée.

Les champs protégés tenaient déjà : `role`, `email`, `banned` et `twoFactorEnabled` étaient refusés par `/update-user`. Il n'y a pas eu d'élévation de privilège.

La liste est dans `CLOSED_AUTH_PATHS` (`src/server/auth/auth.ts`). Un test énumère `auth.api` : une route ajoutée par une mise à jour de better-auth fait échouer la suite tant qu'elle n'est pas classée. Le client navigateur a été rejoué en test sur le parcours de connexion, sans appel à une route fermée.

### 2. Corps de webhook sans limite

Les six routes appelaient `request.text()` avant tout contrôle. Twenty, DocuSeal et n8n le faisaient avant de vérifier la signature : un inconnu pouvait donc faire charger en mémoire tout ce qu'il envoyait, la limite n'étant contrôlée qu'après la lecture. DocuSeal et Cal n'avaient aucune limite. Constat sur le code, sans mesure de mémoire avant correction.

Vérifié après correction sur le port 3000 : 3 Mo annoncés donnent 413 ; un flux sans taille annoncée est coupé après 29 morceaux de 64 Ko sur 4000 ; un petit corps non signé donne toujours 401. Limite de 1 Mo, 64 Ko pour n8n, Coolify et Uptime Kuma.

### 3. Mot de passe d'un client

**Décision.** En production, un client n'a pas de mot de passe et n'en utilise pas.

- Un compte invité n'a aucune ligne `accounts` (`ensureClientAccount`). `/change-password` et `/two-factor/enable` exigent un mot de passe existant, `/set-password` n'existe pas en HTTP, et un e-mail de réinitialisation ne part jamais vers un client (`sendPasswordResetMail`).
- Il ne reste que deux sources : le seed, interdit en production, et `npm run user:create --role client`.

`/sign-in/email` refuse donc tout compte `client` quand `NODE_ENV=production`, avec la réponse et le coût de calcul d'un mauvais mot de passe, pour ne pas révéler l'adresse. Le refus est le comportement par défaut de `buildAuth`. Hors production, `allowClientPassword` reste vrai : les parcours de `tests/e2e/journeys.spec.ts` connectent les clients du seed par mot de passe.

### 4. Coque sans double authentification

Quand l'agence exige la double authentification, `getServiceContext` renvoie vers `/profil`, mais le layout qui entoure `/profil` lisait quand même notifications, compteurs et noms des associés. Un mot de passe seul y donnait accès, sans plus. Les titres de notification peuvent nommer un client. Le layout passe désormais une coque vide tant que le compte n'est pas enrôlé.

### 5 et 6. Durcissements

- `isInternalHref("/\t/evil.example")` valait vrai, or un navigateur retire la tabulation et lit `//evil.example`. Seul un scénario n8n signé pouvait fournir un tel lien : défaut réel, exposition très faible.
- `isPrivateAddress` laissait passer `2002:7f00:1::`, `::7f00:1`, `2001:0:7f00:1::` et `64:ff9b:1::7f00:1`. Le contrôle ne vise que le port 443 et ne rend que l'état du certificat : l'exposition reste faible.

### Journal

`auth.signed_out` était déclaré mais jamais écrit : la déconnexion est maintenant journalisée. Les échecs de connexion et de second facteur laissent une ligne `auth.sign_in_failed` dans les journaux, sans l'adresse visée.

## Ce qui a été contrôlé, sans défaut trouvé

### Server Actions et routes

- **218 Server Actions dans 22 fichiers, toutes énumérées par script.** Chacune passe par `getServiceContext`, `getEnrolmentServiceContext` ou `requirePortalPage`, directement ou par un assistant (`form`, `command`, `run`). Les trois de `src/app/dev/ui` appellent `assertDevelopment`.
- **18 routes `route.ts`, toutes lues.** Sans session : 401 sur les exports et les documents, redirection sur les routes de page. Client, prestataire et lecture sur les trois exports : 403.
- Services sans permission visible, relus un à un : ils portent sur le compte connecté, sur un `PortalContext`, ou sont internes et appelés après un contrôle.
- Identifiants fournis : contrôle de périmètre dans la requête ou le service. Temps et demandes d'un prestataire relus dans `resolveWork` et `getTicketAccess`. Les clés étrangères composites `(id, company_id)` refusent un lien entre deux clients.

### Pages et données par rôle

- Toutes les routes internes parcourues avec le prestataire, le rôle lecture, le collaborateur et un client, identifiants réels à l'appui. Le prestataire reçoit 200 sur `/finances` avec l'état « Accès réservé ».
- 168 valeurs de la base (clients, contacts, affaires, contrats, devis, demandes…) cherchées dans le HTML et la charge RSC du prestataire : seul son projet, Atelier Lune, et ce qui s'y rattache apparaissent.
- Noms de champs sérialisés relevés dans la charge RSC, pour le prestataire et le client. `hourlyCostCents`, `dayRateCents`, marges et notes internes en sont absents. `budgetCents` vaut `null` pour le prestataire.
- Le collaborateur reçoit `estimatedCostCents` sur `/devis/[id]/modifier` et le catalogue. C'est voulu : `canSeeQuoteCosts` réserve ce coût à qui compose le devis.
- Rôle lecture et collaborateur : `/finances/**` refusé ; `/reporting` ne lit rien de financier sans `finance:read`.

### Portail

- Client A sur les objets du client B : document, demande et rendez-vous en 404 ; document interne de sa propre société en 404.
- Dépôt avec le `projectId` d'un autre client : 404. Aucun champ ne porte `companyId`, le contexte vient de `portal_memberships`, relu à chaque requête.
- Un client sur une URL interne repart vers `/espace`. Archive ZIP : chaque fichier passe par `openDocumentDownload`, noms assainis, plafond de 200 fichiers et 1 Go.
- Fichier agenda : texte échappé.

### Authentification

- Cookie de session : `HttpOnly`, `SameSite=Lax`, `Max-Age` de 7 jours. `Secure` et préfixe `__Secure-` dès que `BETTER_AUTH_URL` est en https (lu dans le code de better-auth, pas observé en local).
- Inscription fermée. Origine absente ou étrangère : 403 sur les routes en POST.
- Redirections hostiles sur `magic-link/verify`, `reset-password/:token`, `request-password-reset` et `sign-in/magic-link` : 403. `/login?next=` ignore `//`, `/\` et les URL absolues.
- Lien de connexion : jeton haché en base, usage unique et expiration à 24 h. Un client désactivé après l'envoi n'ouvre aucune session (tests ajoutés à `tests/integration/auth-plugins.test.ts`).
- Réponses identiques pour une adresse inconnue, un client et un membre de l'équipe, sur les liens de connexion, la réinitialisation et la connexion. Temps de réponse sans écart notable sur quelques essais (mesure sur serveur de développement).
- Limitation : 429 dès le troisième essai de connexion en 10 secondes, depuis une même adresse.
- Lien de connexion et membre de l'équipe : le lien ne part que vers un client à l'adhésion valide, donc il ne contourne ni le mot de passe ni le second facteur.
- Compte désactivé : sessions supprimées dans la même transaction, connexion refusée.
- Changement de mot de passe : ferme les autres sessions. Réinitialisation : ferme toutes les sessions.

### Webhooks et tâches

| Route       | Authentification                 | Sans configuration | Rejeu                                                |
| ----------- | -------------------------------- | ------------------ | ---------------------------------------------------- |
| Twenty      | HMAC et horodatage (5 min)       | 404                | `webhook_receipts`                                   |
| DocuSeal    | HMAC et horodatage (5 min)       | 503                | `webhook_receipts`                                   |
| n8n         | HMAC et horodatage               | 404                | `webhook_receipts`                                   |
| Cal         | HMAC, sans horodatage côté Cal   | 404                | `webhook_receipts`                                   |
| Coolify     | Secret dans l'URL                | 503                | Sans objet : le service relit l'état par l'API       |
| Uptime Kuma | Secret en en-tête                | 404                | Sans objet : la lecture planifiée reste la référence |
| Jobs        | `Bearer`, comparé sur empreintes | 404                | Verrou de tâche                                      |

Toutes les comparaisons de secret se font à temps constant. Sonde à vide sur chaque route : aucune ne s'exécute.

### Fichiers

- Dépôt : extension sur liste fermée puis signature du contenu, type enregistré depuis la table et jamais depuis le navigateur. `.html` refusé. Taille coupée au fil de l'eau. Même origine exigée.
- Clé de stockage générée, le nom du fichier n'y entre pas. Un `..%2f` dans l'identifiant donne 404.
- Téléchargement en pièce jointe avec `nosniff` et `sandbox`. Aperçu limité au PDF et à quatre formats d'image : SVG et texte ne s'ouvrent jamais dans le navigateur.
- `Content-Disposition` encodé selon RFC 6266.

### Injections et redirections

- **XSS :** aucun `dangerouslySetInnerHTML` sur une donnée (le seul porte un script constant, à nonce). E-mails échappés. Adresses de site et de document limitées à http et https.
- **`/api/auth/error` :** le paramètre `error` est échappé. Cette page n'a pas la CSP de l'application, le proxy excluant `/api`.
- **SQL :** les `sql.raw` ne portent que des constantes ou un sens de tri réduit à `asc`/`desc`. Requêtes hostiles (`'&|!(:*`, `sens=;drop`) : 200 sans erreur.
- **CSV :** `escapeCsvCell` est le passage commun des trois exports. Les noms de fichiers sont construits côté serveur.
- **SSRF :** le contrôle TLS se connecte à l'adresse vérifiée, sur le port 443 seulement. Les autres adaptateurs ne prennent leur URL que dans l'environnement.

### Secrets et en-têtes

- Historique Git parcouru avec des motifs de clés : seul un secret factice de test (`whsec_parcours_…`). `.env` ignoré, et exclu de l'image Docker, qui tourne sans privilège root.
- Composants client : les imports serveur relevés sont des constantes ou des fonctions pures (`password-policy`, `status-machine`, `file-types`, `indy.csv`). Le reste est `import type`. Aucune variable `NEXT_PUBLIC_`. Aucun build n'existait à inspecter.
- Journaux : `redact` masque les clés sensibles, et les erreurs Drizzle perdent leurs paramètres.
- `email_outbox` : `html` et `text` effacés après envoi, après échec définitif et à expiration du lien. L'export exclut cette table.
- En-têtes observés sur `/login` : CSP à nonce, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS, `noindex`.
- `/dev/ui` : garde `NODE_ENV` dans le proxy, les pages et les actions (lu dans le code, production non lancée).

### Journal d'audit

Sont journalisés : connexion, déconnexion, mot de passe, second facteur, rôle, désactivation, sessions, invitations et révocations du portail, lien de portail émis, exports, téléchargements, fusions et réglages de l'agence.

## Ce qui reste

### Décisions et contrôles du propriétaire

1. **Vérifier la limitation de débit derrière Traefik.** better-auth lit la première valeur de `X-Forwarded-For`. En accès direct, changer cet en-tête contourne la limite : 6 essais sur 6 passés, contre un blocage au troisième sans lui. Traefik retire cet en-tête par défaut, sauf si `forwardedHeaders.insecure` ou `trustedIPs` le laisse passer ; je n'ai pas contacté la production. À tester une fois sur la préproduction, avec une adresse inexistante et un en-tête différent à chaque essai : le 429 doit arriver au troisième. S'il n'arrive pas, corriger Traefik.
2. **Choisir une politique de blocage par compte.** La limite est par adresse IP, gardée en mémoire et remise à zéro à chaque redémarrage. Il n'y a ni blocage par compte, ni alerte. Avec des mots de passe de 12 caractères au minimum et le second facteur, ce choix est défendable pour une petite équipe. Le journal `auth.sign_in_failed` permet d'alerter sans changer ce choix.
3. **Fixer un quota de dépôt pour les clients.** La taille par fichier est bornée, pas le volume total ni le nombre de messages par client. Un client authentifié et malveillant pourrait remplir le disque. Risque faible au vu des clients concernés, mais la limite relève d'un choix commercial.

### Risques acceptés

- Le secret du webhook Coolify passe dans l'URL, car Coolify ne signe rien : il peut figurer dans les journaux d'accès du proxy. À ne pas partager, à faire tourner en cas de doute.
- `email_outbox` garde le lien en clair tant que le SMTP n'est pas configuré, jusqu'à expiration du lien. Le jeton n'existe en clair que là.
- `/callback/:id` et `/api/auth/error` restent joignables : `disabledPaths` ne filtre que le chemin exact, et aucun fournisseur OAuth n'est configuré.
- Une fiche d'équipe archivée ne désactive pas le compte : ses projets disparaissent de son périmètre (`getAssignedProjectIds`), mais la désactivation reste un geste distinct dans Administration.
- `npm run user:create --role client` crée encore un mot de passe, inutilisable en production depuis cette revue.

### Non vérifié

- Le comportement en production : aucun build n'a été lancé, le serveur de développement partageant `.next`. `Secure`, la CSP sans `unsafe-inline`, `/dev/ui` fermé et le refus du mot de passe client en production sont établis par le code et les tests.
- Les routes fermées sur le port 3000, faute de redémarrage (voir plus haut).
- La connexion dans un vrai navigateur après ces changements. Le client better-auth a été rejoué en test pour la connexion par mot de passe seulement ; la double authentification reste couverte par les tests existants.
- Le contenu de chacune des 218 actions, au-delà de la session et de la permission : la logique métier et l'appartenance des identifiants reposent, hors points cités, sur les tests d'intégration de chaque lot.

### Dépendances

`npm audit` : 12 vulnérabilités modérées, aucune haute ni critique. Aucune mise à jour faite.

- `esbuild` <= 0.24.2, par `drizzle-kit` : concerne le serveur de développement d'esbuild, que l'application n'utilise pas.
- `minimatch`, par `eslint-config-next` et `typescript-eslint` : outillage de lint.

Les deux chemins passent par des paquets de développement, aucun n'est chargé à l'exécution en production. La seule correction proposée est une rétrogradation majeure (`drizzle-kit` 0.18.1, `eslint-config-next` 15.5.29) : à ne pas appliquer, à revoir à la prochaine mise à jour de ces outils.

## Vérification

`npm run check` : format, lint et types sans erreur, 106 fichiers de tests, 2517 tests réussis, 5 ignorés.
