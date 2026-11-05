# Guide d'administration de Nuera OS

Pour les associés de Nuera Studio, qui administrent l'outil au quotidien. L'installation technique est dans [deployment-coolify.md](deployment-coolify.md).

## 1. Premier accès

1. Le premier compte se crée dans le terminal du conteneur (Coolify → application → Terminal) :
   ```sh
   node cli/user-create.mjs --email prenom.nom@nuera.studio --name "Prénom Nom" --role admin
   ```
2. Se connecter sur `/login`, avec l'e-mail et le mot de passe de ce compte.
3. En production, l'application renvoie vers **Mon profil** (`/profil`) tant que la double authentification n'est pas activée. L'activer et ranger les codes de secours dans le gestionnaire de mots de passe.
4. Inviter ensuite le reste de l'équipe (section 2).

## 2. Comptes et rôles

Tout se passe dans **Administration** (`/administration`).

| Rôle          | Accès                                                                        |
| ------------- | ---------------------------------------------------------------------------- |
| Associé       | Tout : finances, coûts, déploiements, comptes, exports                       |
| Collaborateur | Le travail courant, sans finances ni administration                          |
| Prestataire   | Seulement les projets, tâches et demandes qui lui sont confiés, et son temps |
| Lecture       | Consultation, sans modification                                              |
| Client        | Uniquement son espace (`/espace`), jamais l'application interne              |

- **Inviter** : « Inviter un utilisateur ». Sans SMTP, aucun e-mail ne part : l'écran propose un lien à usage unique à copier.
- **Désactiver** un compte ferme aussi ses sessions. Le dernier associé ne peut pas être retiré.
- **Journal** (`/administration/journal`) : les actions sensibles, avec filtres.
- **Exporter les données** : réservé aux associés, et l'export est journalisé.

La double authentification de l'équipe se règle aussi ici. Elle est exigée par défaut en production.

## 3. Le travail au quotidien

| Besoin                                         | Écran                 |
| ---------------------------------------------- | --------------------- |
| Vue d'ensemble, tuiles à réorganiser           | Tableau de bord (`/`) |
| Chiffres par période, export CSV               | Reporting             |
| Conversations, réponses suggérées, rendez-vous | Messages              |
| Clients, contacts, import CSV, doublons        | Clients               |
| Affaires en cours                              | Pipeline              |
| Offres, catalogue, versions, signature         | Devis                 |
| Tâches, jalons, livrables, mise en ligne       | Projets               |
| Saisie du temps, charge                        | Temps et capacité     |
| Environnements, domaines, sauvegardes, santé   | Sites et CMS          |
| Maintenance, forfaits, renouvellements         | Contrats              |
| Demandes et incidents                          | Support               |
| Factures, échéancier, marges, import Indy      | Finances              |
| Membres, prestataires, missions                | Équipe                |
| Fichiers, base de connaissances, modèles       | Documents             |

⌘K ou Ctrl K lance la recherche globale. Elle ne montre que ce que le rôle peut voir.

Le chemin normal : un client, une affaire, un devis. Quand le devis est accepté, l'affaire passe à gagnée et le projet se crée tout seul. À la mise en ligne, le site devient actif et son contrat de maintenance démarre.

Nuera OS n'émet aucune facture légale : les factures restent dans Indy, et leurs références arrivent par import CSV ou par saisie.

## 4. Donner accès à un client

1. Fiche client → « Inviter dans son espace », en choisissant le contact.
2. Le client reçoit un lien de connexion par e-mail. Sans SMTP, copier le lien à usage unique et le lui transmettre.
3. « Ouvrir l'espace client » sur un projet montre ce que voit le client, en lecture seule.
4. Le retrait de l'accès, depuis la fiche client, prend effet immédiatement.

Un client voit son projet, ses livrables à valider, ses messages, ses documents partagés, son site et ses demandes. Il ne voit ni coûts, ni marges, ni messages internes, ni les autres clients.

## 5. Connexions

**Réglages → Connexions** (`/reglages/connexions`) montre l'état réel de chaque service, daté. « Connexion requise » veut dire que le service n'est pas configuré : l'écran concerné le signale, et rien n'est simulé.

| Service              | Sert à                                | Sans lui                                             |
| -------------------- | ------------------------------------- | ---------------------------------------------------- |
| **Twenty**           | Clients, contacts, affaires           | **Création et modification des clients impossibles** |
| SMTP                 | E-mails                               | Liens à copier à la main, aucune relance par e-mail  |
| DocuSeal             | Signature des devis                   | Acceptation enregistrée à la main, avec sa référence |
| Coolify, Uptime Kuma | État des déploiements et surveillance | Saisie manuelle, états indiqués comme indisponibles  |
| OpenAI               | Réponses suggérées                    | Pas de suggestion ; l'envoi reste toujours humain    |
| Indy                 | Factures                              | Import CSV : aucune API vérifiée                     |

Les valeurs se règlent dans les variables d'environnement de l'application sur Coolify, jamais dans le code. La liste est dans [deployment-coolify.md](deployment-coolify.md).

Les documents exigent `STORAGE_DIR` et un volume persistant, sinon les dépôts de fichiers échouent.

## 6. Automatisations

**Automatisations** liste les règles (relances, alertes de budget, pannes, impayés), avec leur interrupteur et leurs dernières exécutions. « Relancer sans doublon » rejoue un échec sans répéter ce qui a déjà réussi.

Les règles ne tournent que si les tâches planifiées sont en place : `JOBS_SECRET` et les tâches Coolify décrites dans [ops/jobs.md](ops/jobs.md). Sans elles, rien ne se déclenche tout seul : ni alerte, ni relance, ni synchronisation.

## 7. Sauvegardes

Procédure et commandes : [ops/sauvegarde-restauration.md](ops/sauvegarde-restauration.md). À mettre en place avant d'utiliser de vraies données : une copie hors du serveur de la base et du volume de documents, puis une restauration d'essai.

## 8. En cas de problème

| Symptôme                                  | À regarder                                                     |
| ----------------------------------------- | -------------------------------------------------------------- |
| Le site ne répond plus                    | `/api/health` et les journaux de l'application dans Coolify    |
| « Connexion requise »                     | Réglages → Connexions, puis les variables sur Coolify          |
| Connexion refusée après plusieurs essais  | Limite anti-abus : attendre quelques minutes                   |
| Plus d'accès à la double authentification | Codes de secours, sinon un autre associé                       |
| Alerte ou relance absente                 | Administration → Exécutions, et les tâches planifiées          |
| Donnée CRM en retard                      | Twenty reste la référence ; la réconciliation rattrape l'écart |
