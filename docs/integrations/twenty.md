# Intégration Twenty CRM

Version figée : **Twenty v2.55.0** (`docker-compose.twenty.yml`). Toute montée de version passe par
`npm run test:live` avant d'être adoptée.

Code : `src/integrations/twenty/` (port `crm-gateway.ts`, seul contrat que voient les services).

## Qui détient quoi

| Donnée                                                                                        | Maître   | Dans Nuera OS                          |
| --------------------------------------------------------------------------------------------- | -------- | -------------------------------------- |
| Entreprise : nom, domaines, adresse, LinkedIn                                                 | Twenty   | Projection en lecture, clé = id Twenty |
| Personne : nom, e-mails, téléphones, poste, entreprise                                        | Twenty   | Projection en lecture                  |
| Opportunité : nom, étape, montant, date de clôture, entreprise, contact                       | Twenty   | Projection en lecture                  |
| Notes et tâches, et leurs liens                                                               | Twenty   | Projection en lecture                  |
| Probabilité, source, tags, rôles, motif de perte, prochaine action, tout champ propre à Nuera | Nuera OS | Tables Nuera, jointes par l'id Twenty  |

Aucun champ personnalisé n'est ajouté à Twenty : aucun besoin concret n'est apparu. Seules les options
du champ `stage` des opportunités sont configurées.

Nuera OS écrit via l'API, ne lit jamais une page en direct depuis Twenty, et tient sa projection à jour
par webhooks **et** réconciliation par curseur (les webhooks seuls ne suffisent pas, voir plus bas).

## Mise en route

**Local**

```bash
docker compose -f docker-compose.twenty.yml --env-file .env up -d
npm run twenty:bootstrap
npm run test:live   # facultatif : vérifie le port contre l'instance
```

Le script est idempotent. Il crée `dev@nuera.local` (mot de passe généré, conservé dans
`TWENTY_DEV_ADMIN_PASSWORD`), l'espace de travail et la clé d'API, écrit `TWENTY_API_URL` et
`TWENTY_API_KEY` dans `.env` (ignoré par Git), autorise `host.docker.internal` comme destination de
webhook, puis applique les étapes. Aucun secret n'est affiché. Aucune étape manuelle.

**Autre instance (production)**

Le script ne crée alors aucun compte. Créer une clé dans Paramètres → API & Webhooks, puis :

```bash
TWENTY_API_URL=https://crm.exemple.fr TWENTY_API_KEY=… npm run twenty:bootstrap
```

Étapes appliquées : Nouveau (`NEW`), Qualifié (`QUALIFIED`), Devis envoyé (`QUOTE_SENT`), Négociation
(`NEGOTIATION`), Gagné (`WON`), Perdu (`LOST`). Les étapes d'origine sont **renommées**, ce qui migre
les dossiers : `SCREENING`→`QUALIFIED`, `PROPOSAL`→`QUOTE_SENT`, `MEETING`→`NEGOTIATION`,
`CUSTOMER`→`WON`. Les colonnes Kanban suivent (vérifié sur une instance neuve, jeu d'essai inclus). Une
étape inconnue encore utilisée arrête le script sans rien modifier.

## Webhook

```bash
npm run twenty:bootstrap -- --webhook-url=https://nuera.exemple.fr/api/webhooks/twenty
```

Crée ou met à jour le webhook (`company`, `person`, `opportunity`, `note`, `task`, `noteTarget`,
`taskTarget`) et écrit `TWENTY_WEBHOOK_SECRET` dans `.env`, à recopier dans l'environnement de
déploiement. La route, à venir, appelle `receiveTwentyWebhook()` sur le **corps brut**.

Format vérifié sur des livraisons réelles (il diffère de la documentation) :

- Signature : HMAC-SHA256 hexadécimal de `{timestamp}:{corps}`, en-tête `X-Twenty-Webhook-Signature`.
- `X-Twenty-Webhook-Timestamp` est en **millisecondes**, pas en secondes Unix. Refus au-delà de 5 min.
- `X-Twenty-Webhook-Nonce` : 32 caractères hexadécimaux, utilisable pour détecter un rejeu.
- Le secret est celui du webhook : fourni à sa création, sinon généré par Twenty (64 caractères
  hexadécimaux), lisible par `GET /rest/metadata/webhooks/{id}`. Sans secret, aucun de ces en-têtes.
- Corps : `eventName`, `objectMetadata.nameSingular`, `record`, `updatedFields`, `eventDate`,
  `workspaceId`, `webhookId`, `targetUrl` (et non `event` / `data` / `timestamp`).
- Actions : `created`, `updated`, `deleted`, `destroyed`, `restored`. La création d'un webhook exige un
  `roleId`. Le fichier `twenty.webhook.ts` reconnaît aussi `upserted`, défini dans le code, jamais observé.

En local, le serveur Nuera OS se joint par `http://host.docker.internal:<port>/…` : Twenty refuse les
adresses privées sauf liste blanche (`OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS`, réglée par le script,
effective sous 15 s).

## Faits vérifiés sur v2.55.0

**Limites**

- **100 requêtes / 60 s par clé d'API, y compris en auto-hébergé** : 429 à la 102e requête en 1 s.
  Réponse : `Retry-After: 1`, `x-ratelimit-*`. Reprise progressive, environ 1,7 requête/s, et non une
  remise à zéro par minute. La plupart des réponses 2xx ne portent pas d'en-tête `x-ratelimit-*`.
- Budget partagé entre REST et GraphQL pour les enregistrements. L'API Metadata (REST et GraphQL) a
  répondu 200 alors que ce budget était épuisé.
- **Webhooks : 60 envois / 60 s par espace de travail, l'excédent est perdu** (80 événements simultanés :
  60 livraisons reçues, 20 jamais envoyées).
- Lecture : 60 enregistrements par défaut, **200 au maximum** (au-delà, plafonné sans erreur).
- Écriture par lot : la limite documentée de 60 **n'est pas appliquée** (`POST /rest/batch/*` a accepté
  101). L'adaptateur reste à 60 par lot, la documentation pouvant redevenir vraie.
- Fusion : 2 à 9 fiches.

**Doublons**

- Entreprise : `domainName.primaryLinkUrl` est unique. Normalisé : minuscules, sans protocole, `www.`,
  chemin ni paramètres. Domaines secondaires non concernés. Nom non concerné, plusieurs fiches sans
  domaine acceptées.
- Personne : `emails.primaryEmail` est unique, en minuscules. E-mails secondaires et téléphones non
  concernés, plusieurs fiches sans e-mail acceptées.
- Erreur : HTTP 400 `unique constraint <objet>.IDX_UNIQUE_… was violated`, traduite en
  `CrmDuplicateError` avec l'id de la fiche existante (une requête de plus, seulement dans ce cas).
- **Une fiche archivée garde son domaine ou son e-mail.** Il faut la restaurer, pas la recréer.
- Un `id` fourni à la création est accepté, et un rejeu est refusé sur `*_pkey`. L'adaptateur génère
  donc l'id côté client : une création se rejoue sans doublon après une coupure réseau.

**Suppression**

- **`DELETE` sans `soft_delete=true` supprime définitivement.** L'adaptateur passe toujours le paramètre.
- Archivage : `deletedAt = updatedAt`, donc visible par `updatedSince`. Lecture et 2e archivage : 404.
- Un `PATCH` sur une fiche archivée **réussit**, et une personne peut être liée à une entreprise archivée.
- Archiver une entreprise n'archive ni ses personnes, ni ses opportunités, ni ses liens. Archiver une note
  ou une tâche archive ses liens, et les restaurer les restaure.

**Fusion** (`PATCH /rest/{objet}/merge`)

- Le gagnant garde son id et ses valeurs ; les champs vides sont repris du perdant ; domaines, e-mails et
  téléphones du perdant passent en secondaires.
- Le perdant est **supprimé définitivement** (invisible même archivé), événement `<objet>.destroyed`.
- Personnes, opportunités et liens d'activité sont rattachés au gagnant, avec `updatedAt` mis à jour et
  événements `updated`. Aucun `company.updated` n'a été observé pour le gagnant lors d'un essai sans
  changement de valeur visible.

**Notes et tâches**

- Le lien se fait par `noteTargets` / `taskTargets` (`targetCompanyId`, `targetPersonId`,
  `targetOpportunityId`), un enregistrement par cible. Plusieurs cibles par activité : fonctionne.
- Pas de création imbriquée : deux requêtes, non atomiques. L'adaptateur purge la note si ses liens
  échouent. Twenty accepte un lien sans cible : l'adaptateur l'interdit.
- **Ajouter ou retirer un lien ne modifie pas le `updatedAt` de l'activité.** L'adaptateur le force pour
  ses propres écritures ; pour les modifications faites dans Twenty, réconcilier `listActivityLinks()`.
- Le corps s'écrit en Markdown (`bodyV2.markdown`). Écrit en BlockNote ou Tiptap par l'API, il est relu en
  Markdown.
- Statuts de tâche : `TODO` (défaut), `IN_PROGRESS`, `DONE`.

**Mises à jour partielles**

- `name` et `address` : fusion des sous-champs.
- `domainName` : les liens secondaires non transmis sont **effacés**.
- `emails` : transmettre `additionalEmails` seul **efface l'e-mail principal**.
- `phones` : effacer le numéro principal efface aussi les secondaires.
- D'où, dans le port, `domains`, `emails` et `phones` toujours remplacés en entier.
- Téléphones : format international obligatoire, `0612345678` refusé en 400.

**Réconciliation**

- `order_by=updatedAt,id` + `starting_after` : le curseur embarque `updatedAt` (microsecondes) et `id`.
- `updatedAt` est renvoyé à la milliseconde : relire avec `updatedSince` inclusif et une écriture
  idempotente.
- Archivés : `or(deletedAt[is]:NULL,deletedAt[is]:NOT_NULL)` (`includeDeleted`).

**Montant et date** : `amountMicros` = centimes × 10 000. `closeDate` est un horodatage : le port écrit
minuit UTC et relit les 10 premiers caractères.

## Limites connues

- **Webhooks à au plus une livraison** : une réponse non 2xx ou une coupure ne provoque aucun nouvel
  envoi (500 reçus : aucune relivraison observée en 12 s ; le code attrape l'erreur avant la file), et
  l'excédent au-delà de 60 / min est perdu. La réconciliation par curseur est donc obligatoire.
- **Suppressions définitives invisibles à la réconciliation** (perdant de fusion, purge dans Twenty) :
  seul l'événement `destroyed` les signale. Prévoir une comparaison périodique des ids.
- Débit : une réconciliation complète coûte une requête par page de 200, soit 20 000 enregistrements par
  minute au mieux ; une écriture de note coûte 2 à 5 requêtes. Un 429 persistant arrive jusqu'à
  l'appelant en `IntegrationUnavailableError("rate_limited")` après 3 nouvelles tentatives.
- Les noms de contraintes `IDX_UNIQUE_*` et le texte anglais des erreurs sont lus par l'adaptateur : à
  revérifier à chaque montée de version (`npm run test:live` le couvre).
- L'enveloppe de réponse de l'API Metadata change le 15/11/2026 d'après Twenty : le script accepte les deux
  formes, seule la forme actuelle a été testée.

## Non vérifié

- Limite de débit au-delà de cette instance : la production peut surcharger les variables
  `API_RATE_LIMITING_*`.
- Notes saisies dans l'interface Twenty : le passage en Markdown n'a été vérifié que par l'API.
- `host.docker.internal` sous Linux : vérifié sous Docker Desktop (Windows) uniquement.
- Mise à l'échelle : aucune mesure sur de gros volumes.
- Écritures simultanées pendant une réconciliation : le tri par `updatedAt` croissant devrait renvoyer une
  fiche modifiée plus loin, sans trou, mais ce n'est pas testé, et une transaction longue peut valider un
  `updatedAt` antérieur au curseur. Recommandation : repartir avec une marge de quelques minutes.
