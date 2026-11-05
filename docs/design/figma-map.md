# Nuera OS · carte des écrans Figma

Source : fichier « Nuera Design » (`nlvRWAtD1x2fKf8gVgcM0g`), pages « Nuera OS » (`57:3`) et « Nuera OS · Prototype » (`59:3`). Relevé le 2026-11-04, en lecture seule. Tokens : voir `docs/design/tokens.md`.

## 0. Comment lire ce document

- **Toute donnée métier des maquettes est un exemple** : noms de clients et de contacts, montants, dates, heures, pourcentages, compteurs, domaines, références (`D-2026-014`), commits, sessions. Rien de cela ne doit finir en dur. Dans ce document, ces valeurs sont précédées de `ex.`. Les libellés fixes (titres de colonnes, boutons, états) sont cités tels quels.
- Ethan Ngo et Nezar Zakaria sont les vrais associés, mais leurs noms, initiales et capacités viennent eux aussi de la base.
- **Destinations des boutons** : les outils de lecture disent quels calques sont cliquables, pas où ils mènent. `[note]` = écrit dans une note Mouvement. Sans cette marque, la destination est **déduite** du libellé et reste à valider. Une « action sans écran » n'a aucune maquette de destination.
- **Routes** : suggestions, à partir de `src/app/(app)` et `src/app/(auth)/login` existants. `docs/architecture.md` laisse le découpage du portail client « à décider » ; `/espace/*` est une proposition.
- Les captures PNG sont dans le dossier temporaire de la session : à copier si elles doivent durer. Hauteur non précisée = cadre 1440 × 1120.

## 1. Inventaire et écarts avec la liste attendue

| Attendu                              | Trouvé                                                                                                                      | Écart        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 24 écrans agence (01 à 24)           | 24                                                                                                                          | Aucun        |
| 9 écrans client (C1 à C9)            | 9                                                                                                                           | Aucun        |
| Section « Composants de l'app »      | `57:13`                                                                                                                     | Aucun        |
| Notes bleues « Note · Mouvement »    | 15 instances : règles communes, 10 écrans (01, 02, 11, 16, 17, 18, 19, 21, C3, C7), 4 instants figés ; composant `137:6040` | Détail en §6 |
| Instants figés M1 à M4               | 4, avec titre `142:6908` et sous-titre `142:6909`                                                                           | Aucun        |
| Barre latérale 6 groupes, 17 entrées | 6 groupes, 17 entrées, 17 variantes                                                                                         | Aucun        |

En plus de la liste :

- Calques isolés sur la page : `91:4092` (Logo Nuera OS · encre, cadre libre au-dessus de la section) et `71:1746` (« Vector 6 », taille 0, à ignorer).
- Page `59:3` : prototype du tableau de bord `59:481` et section `59:4` « Tuiles vivantes » (6 tuiles × 3 tailles).
- Page `1:834` : composant `Button` (`7:117`), utilisé par tous les écrans agence.

Anomalies de maquette :

- **13** : la barre latérale `88:2544` est décalée d'environ 20 px vers le bas par rapport aux autres écrans, à partir du logo (recherche à y=92 au lieu de 80). Se fier à 01.
- **14** : aucune entrée de menu propre, la variante active est « Réglages ».
- **15** : le bouton « Se connecter » est déclaré 392 px de large mais rendu en largeur du contenu. Le PNG fait foi.
- **M2** : un graphique « Comparaison » reste dans les calques (`138:6547`) sous la courbe, sans être visible.

Écran prototype : `59:481`, `figma/P1-prototype-tableau-de-bord-vivant.png`.
Planches de composants : `figma/_components-app.png` et `figma/_components-tuiles-vivantes.png`.

## 2. Cadres communs

### 2.1 Barre latérale (`57:578`), 248 × 1120

Fond `--near-black`. Colonne : `padding 20 16 16`, gap 16. Haut en bas :

1. Logo Nuera OS · papier (`90:4084`), retrait gauche 8.
2. Recherche : fond `--surface-raised-dark`, rayon 8, `padding 8 12`. Icône `search` 16, « Rechercher… » Outfit 13, raccourci « ⌘K » mono 11, couleur `--accent-on-dark`.
3. Navigation, 6 groupes, gap 16. Libellé de groupe : mono 500, 10, capitales, opacité 60 %, retrait 12.
4. Espace flexible.
5. Bloc utilisateur (cliquable, ouvre l'écran 13) : fond `--surface-raised-dark`, rayon 12, `padding 8`. Deux avatars 36 se chevauchant (-10) `ex. EN`, `ex. NZ` ; « Ethan et Nezar » 13/600 blanc ; « Nuera Studio · 2 associés » 11, `--accent-on-dark`.

Entrée : `padding 8 12`, gap 12, rayon 8, icône 18. Inactive : Outfit 500 14 `--accent-on-dark`. Active : fond `--hairline-on-dark`, Outfit 600 14 `--paper`. Compteur à droite : pilule `--accent`, Outfit 600 11 blanc.

| Groupe         | Entrée            | Icône                  | Compteur | Variante active | Route                  |
| -------------- | ----------------- | ---------------------- | -------- | --------------- | ---------------------- |
| PILOTAGE       | Tableau de bord   | `icon/dashboard`       |          | `57:138`        | `/`                    |
|                | Reporting         | `icon/chart`           |          | `99:3397`       | `/reporting`           |
| COMMERCIAL     | Messages          | `icon/messages`        | `ex. 4`  | `57:226`        | `/messages`            |
|                | Clients           | `icon/clients`         |          | `57:402`        | `/clients`             |
|                | Pipeline          | `icon/pipeline`        |          | `57:314`        | `/pipeline`            |
|                | Devis             | `icon/devis`           |          | `87:1529`       | `/devis`               |
| PRODUCTION     | Projets           | `icon/projets`         |          | `87:1431`       | `/projets`             |
|                | Temps et capacité | `icon/clock`           |          | `99:4356`       | `/temps`               |
| SITES ET SUIVI | Sites et CMS      | `icon/sites`           |          | `87:1627`       | `/sites`               |
|                | Contrats          | `icon/contrat`         |          | `99:4735`       | `/contrats`            |
|                | Support           | `icon/support`         | `ex. 2`  | `87:1725`       | `/support`             |
| GESTION        | Finances          | `icon/wallet`          |          | `99:5114`       | `/finances`            |
|                | Équipe            | `icon/equipe`          |          | `99:5348`       | `/equipe`              |
|                | Documents         | `icon/book`            |          | `99:5582`       | `/documents`           |
| OUTILS         | Automatisations   | `icon/automatisations` |          | `87:1823`       | `/automatisations`     |
|                | Administration    | `icon/shield`          |          | `99:5961`       | `/administration`      |
|                | Réglages          | `icon/reglages`        |          | `57:490`        | `/reglages/connexions` |

### 2.2 En-tête agence

**Pas de composant ni de barre haute globale** : chaque écran pose son en-tête dans le contenu. Contenu : `x=248`, largeur 1192, marges 32, largeur utile 1128, en-tête à `y=28`.

- Gauche : titre Outfit 600 28 `--ink`, gap 4, sous-titre Outfit 400 14 `--muted`. Le sous-titre est un résumé calculé.
- Droite : 0 à 2 `Button`, gap 12 : Default puis Accent. L'action principale est toujours à droite, en Accent.
- Cloche de notifications : **seulement sur 01 et 06** (`58:249`, 36 × 36). La recherche et le profil sont dans la barre latérale.
- Filtres sous l'en-tête à `y=109` : champ de recherche optionnel (260 × 36, rayon 12) + badges. Filtre actif = badge Accent, inactif = badge Neutre.

### 2.3 Capsule client, « En-tête client » (`69:1289`), 1440 × 104

Variantes `Actif` : Mon projet `69:1231`, Messages `69:1260`, Documents `89:2725`, Mon site `89:2786`, Aucun `156:7070` (C8).

Capsule : marges 40, fond `--near-black`, pilule, `padding 8 16`, gap 12, ombre `0 12 32 rgba(20,23,48,.22)`. Gauche à droite :

1. Logo Nuera OS · papier réduit (82,7 × 16,8).
2. Séparateur 1 × 24 `--border-on-dark`.
3. **Avancement** (bouton vers « Mon projet ») : fond `--surface-raised-dark`, anneau 28 en 4 quarts (fait `success-on-dark`, en cours `warn-on-dark`, à venir neutre), nom de l'étape `ex. Maquettes` Outfit 500 14 blanc, chevron 14. Nom accessible, d'après Figma : « Avancement : étape 2 sur 4, maquettes, mise en ligne le 18 novembre ». Au survol, une bulle donne la date de mise en ligne.
4. Espace flexible.
5. **Onglets** : fond `--surface-raised-dark`, pilule, `padding 4`, gap 4. Onglet hauteur 40, `padding 0 16 0 14`, icône 18, gap 8. Inactif : Outfit 500 14 `--accent-on-dark`. Actif : fond `--paper`, Outfit 600 14 `--ink`, ombre `0 6 16 rgba(0,0,0,.25)`. Ordre : Mon projet (`icon/projets`), Messages (`icon/messages`, compteur `ex. 2`), Documents (`icon/devis`), Mon site (`icon/sites`).
6. Espace flexible.
7. **Prochaine action** (cliquable) : fond `--hairline-on-dark`, point 8 `warn-on-dark`, `ex. À vous : déposer les photos` Outfit 500 13 blanc, chevron.
8. **Profil** : avatar 36 `ex. CM` + chevron tourné de 90°. Ouvre le menu de C5.

Le contenu client est centré sur 1360 (marges 40), cartes à bordure et rayon 28, sans ombre.

## 3. Composants partagés

| Composant                 | Node                                                      | Variantes / props                                                                                                                                                                                                            | Écrans                                                              |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Badge                     | `57:124`                                                  | `ton` : Accent `57:112`, Succes `57:114`, Alerte `57:116`, Danger `57:118`, Neutre `57:120`, ChatGPT `57:122` ; `label`. `padding 4 8`, pilule, Outfit 500 12                                                                | 01-14, 16-24, C4-C7, M1-M4                                          |
| Avatar                    | `57:125`                                                  | `initiales` ; 36 par défaut, relevé aussi en 64, 56, 32, 26, 22. Fond `--accent-pale`                                                                                                                                        | 01-04, 06-09, 11, 13, 14, 17, 19, 22, 24, C1, C3-C5, C8, M1, M3, M4 |
| Poignée de taille         | `57:127`                                                  | 22 × 22, en bas à droite de la tuile                                                                                                                                                                                         | 01, 06, 13, M1                                                      |
| En-tête de tuile          | `57:130`                                                  | `icone`, `titre`. Hauteur 28, pastille 28 `--accent-pale` rayon 8, icône 16, Outfit 600 14. Sert aussi d'en-tête de carte                                                                                                    | 01, 04, 06, 13, 16-24, M1-M4                                        |
| Bouton · Retirer la tuile | `150:6910`                                                | Rond blanc 24, zone cliquable 32, moins rouge. Nom accessible : « Retirer la tuile <nom> »                                                                                                                                   | 06                                                                  |
| Barre latérale            | `57:578`                                                  | `Actif` : 17 valeurs (§2.1)                                                                                                                                                                                                  | 01-14, 16-24, M1-M4                                                 |
| En-tête client            | `69:1289`                                                 | `Actif` : 5 valeurs (§2.3)                                                                                                                                                                                                   | C3-C8                                                               |
| Bouton compact            | `168:6952`                                                | `style` : Principal `168:6940`, Secondaire `168:6944`, Discret `168:6948` ; `libelle`, `avecIcone`, `icone`. Hauteur 36, rayon 12, Outfit 500 14, icône 16, zone cliquable 44 en code. Une seule action Principale par carte | C2-C3, C5-C9                                                        |
| Button (Design System)    | `7:117`                                                   | `Variant` Default / Accent / On dark × `State` Rest / Hover / Pressed. Voir tokens §6                                                                                                                                        | Tout l'agence, C1                                                   |
| Note · Mouvement          | `137:6040`                                                | `repere`, `titre`, `texte`. **Annotation, à ne pas construire**                                                                                                                                                              | Page 57:3                                                           |
| Logos                     | `62:367`, `68:1214`, `90:4084`, `90:4098`                 |                                                                                                                                                                                                                              | Voir tokens §8                                                      |
| Tuile vivante             | `59:81`, `59:163`, `59:243`, `59:319`, `59:395`, `59:477` | `Taille` : Petite 168 × 168, Moyenne 360 × 168, Grande 360 × 360. Chiffre d'affaires, Pipeline, Charge du mois, Messages, MRR, État des sites                                                                                | Prototype `59:481`                                                  |

Icônes (`57:13`, 24 × 24, 38) : `dashboard, messages, pipeline, clients, projets, devis, sites, support, automatisations, reglages, search, bell, plus, sparkle, send, calendar, check, edit, minus, link, euro, server, clock, chevron, paperclip, chart, contrat, book, shield, equipe, wallet, flag, rocket, globe2, database, alert, download, micro`.

**Motifs répétés sans composant Figma, à créer en code** :

| Motif               | Référence              | Spécification                                                                                                                           |
| ------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Tuile               | `58:397`               | Fond `--bg`, rayon 28, `Shadow/Soft`, `padding 20`, gap 12, sans bordure                                                                |
| Tuile « Ajouter »   | `58:621`               | Bordure pointillée 1,5 `--border`, plus 18 dans un rond `--accent-pale`, Outfit 500 13 `--accent`                                       |
| Carte KPI           | `100:4558`             | Rayon 20, `Shadow/Soft`, `padding 24`, gap 4, libellé 12/500, chiffre 26/600, note 12. 264 × 119, 4 en ligne, gap 24                    |
| Carte d'information | `100:5107`             | En-tête de tuile + lignes libellé / valeur                                                                                              |
| Tableau             | `87:2049`              | Rayon et `Shadow/Soft`. En-tête 45, `padding 12 20`, gap 16, mono 500 11. Ligne 45 ou 66, filet bas `--border` ; la ligne est cliquable |
| Jauge               | `58:334`               | Hauteur 5 ou 8, rayon 2,5, rail `--surface-raised` (invisible), remplissage `--accent` ou statut                                        |
| Interrupteur        | `88:2439`              | 36 × 20, vecteur. Actif `--accent` (`chatgpt` dans 05), inactif gris                                                                    |
| Colonne Kanban      | `65:668`               | Bordure, rayon ≈ 20, point de statut, titre, compteur                                                                                   |
| Carte Kanban        | `65:689`               | Bordure `--border`, rayon 12, `padding 16`, gap 8                                                                                       |
| Frise d'étapes      | `66:843`, `100:4962`   | Cases : fait `success-pale`, en cours `--accent-pale`, à venir sans fond                                                                |
| Fenêtre             | `141:6795`, `141:7330` | Blanche, rayon ≈ 28, `Shadow/Float` (à confirmer), voile `--muted-on-dark` sur fond flouté                                              |
| Menu du profil      | `88:2784`, `89:2923`   | 300 de large, blanc, rayon ≈ 20, entrées 34 ou 39 de haut                                                                               |
| Champ               | `68:1278`, `141:7383`  | Bordure `--border`, rayon 12 ; focus 1,5 px sombre                                                                                      |

### Correspondance des statuts et des tons

| Ton                  | Libellés rencontrés                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Succes (vert)        | Client, Client · signé, Signé, Connecté, En ligne, Actif, Payée, Faite, Réussi, réussie, Activée, Récurrent, Dans les temps, Gratuit · support 30 j, validée 24 oct., valide · renouvelé auto, Production · opérationnel                          |
| Accent (bleu)        | Abonné, En cours, Envoyée, Reçue, Validée, Version 2, Étape 2 / 4, Partagé client, Associé · admin, Suivi par…, compétences, filtre actif                                                                                                         |
| Alerte (ambre)       | Devis envoyé, Relance J+3, Contenus attendus, Bloquée, Bloqué · contenus attendus, Préprod, À valider, À revoir, en attente, API à vérifier, À confirmer, À trancher, Gravité moyenne, à configurer (S3), charge élevée                           |
| Danger (rouge)       | En retard · 2 j, Gravité haute, Échec · annulé, 1 échec, échec · Indy injoignable, compteur Perdues                                                                                                                                               |
| Neutre               | Prospect, Brouillon, En attente, À faire, À démarrer, À venir, Interne, Client · portail, Lien e-mail, Gravité faible, Optionnel, Notre serveur, Externe, imposé, Votre fichier, origine (Réseau, Site, Mini-audit, Prescripteur), filtre inactif |
| ChatGPT (vert d'eau) | ChatGPT, Réponse prête · 3, Connecté · nezar@…, Connecté (menu profil)                                                                                                                                                                            |

Incohérences : « Préprod » est Alerte en 10 et Neutre en 04 ; « Gratuit » est Succes dans une carte de 11 et Neutre dans une autre ; « Connecté » est ChatGPT ou Succes selon l'objet.

## 4. Écrans agence

Tous, sauf 15 : barre latérale 248 + contenu 1192. Largeurs de colonnes en px ; `flex` = reste.

### 01 · Tableau de bord (`58:152`)

PNG : `figma/01-tableau-de-bord.png`
Route : `/`. Rôle : vue de l'agence, en tuiles redimensionnables.

En-tête (`58:242`) : `ex. Bonjour Nezar` ; `ex. Mardi 3 novembre 2026 · l'agence aujourd'hui` ; badge Neutre « Données d'exemple » (à retirer en production). Actions : cloche → panneau de notifications (sans écran) ; « Modifier le tableau » → 06 ; « + Nouvelle affaire » → formulaire (sans écran).

Grille (`58:261`) : 6 colonnes de 168, gap 24, largeur 1128. Taille 1×1 = 168 × 168, 2×1 = 360 × 168, 2×2 = 360 × 360, 4×2 = 744 × 360. Chaque tuile a une poignée de taille.

| Tuile                 | Node     | Taille | Icône      | Badge                         | Contenu                                                                                                                                                                                                                                              |
| --------------------- | -------- | ------ | ---------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chiffre d'affaires    | `58:264` | 4×2    | `euro`     | Succes `ex. +12 % vs octobre` | Chiffre 40/600 `ex. 11 700 € HT` ; `ex. Novembre 2026 · encaissé et à encaisser` ; légende Projets (`--accent`) / Récurrent (`--ink`) ; barres empilées sur 6 mois `ex. Juin à Nov.`, 3 repères. Mois courant en `--accent`, mois passés plus clairs |
| Pipeline              | `58:313` | 2×2    | `pipeline` | Accent `ex. 21 affaires`      | 7 lignes : étape, montant mono (ou « MRR »), nombre, jauge. Prospect, Appel fait, Devis envoyé, Signé, En cours, Livré, Abonné. Jauge verte pour Signé et Abonné, bleue sinon                                                                        |
| Charge du mois        | `58:377` | 2×1    | `clock`    | Alerte `ex. 78 %`             | `ex. 14 / 18` « journées vendues », jauge 8, `ex. Nezar 10 / 14 · Ethan 4 / 4`                                                                                                                                                                       |
| MRR                   | `58:397` | 1×1    | `euro`     |                               | `ex. 1 349 €`, `ex. 1 accompagnement + 1 hébergement`                                                                                                                                                                                                |
| Encaissé              | `58:413` | 1×1    | `check`    |                               | `ex. 7 020 €`, `ex. 2 340 € en attente` (`warn`)                                                                                                                                                                                                     |
| En retard             | `58:429` | 1×1    | `clock`    |                               | `ex. 1 projet`, `ex. Contenus attendus · Atelier Lune` (`danger`)                                                                                                                                                                                    |
| Frais 50/50           | `58:446` | 1×1    | `link`     |                               | `ex. 167 €`, `ex. par mois · 83 € chacun`                                                                                                                                                                                                            |
| Messages à traiter    | `58:465` | 2×2    | `messages` | ChatGPT « ChatGPT »           | 3 lignes : avatar, nom · activité, heure mono, extrait, sparkle « Réponse suggérée prête »                                                                                                                                                           |
| Prochains rendez-vous | `58:520` | 2×1    | `calendar` | Neutre « Cal.diy »            | 2 lignes : pastille date mono `ex. MAR 10:00`, personne, type · durée                                                                                                                                                                                |
| État des sites        | `58:548` | 2×1    | `server`   | Succes « Uptime Kuma »        | 3 lignes : point d'état, domaine, disponibilité mono                                                                                                                                                                                                 |
| Devis à signer        | `58:577` | 2×1    | `devis`    | Alerte `ex. 2`                | 2 lignes : client · offre, `ex. 7 800 € HT · DocuSeal`, badge `ex. Relance J+3` (Alerte) ou `ex. Envoyé hier` (Neutre)                                                                                                                               |
| Demandes              | `58:603` | 1×1    | `support`  |                               | `ex. 2`, `ex. 1 à valider · 1 en cours`                                                                                                                                                                                                              |
| Ajouter une tuile     | `58:621` | 1×1    | `plus`     |                               | Tuile pointillée → 06, galerie ouverte                                                                                                                                                                                                               |

Clic sur une tuile : vers l'écran du module (déduit). État mouvement : M1.

### 02 · Messages (`63:398`)

PNG : `figma/02-messages.png`
Route : `/messages/[conversationId]`. Rôle : boîte unique avec réponses préparées par ChatGPT. Structure : 3 colonnes 340 + 552 + 300, plein hauteur.

- **Conversations** (`63:497`) : titre « Messages », recherche « Chercher un client, un message… », filtres `Tous · ex. 4` (Accent), Clients, Prospects, `Réponse prête · ex. 3` (ChatGPT). Ligne : avatar, `ex. Claire · Atelier Lune`, heure mono, extrait, sparkle « Réponse suggérée » si prête (77 de haut, sinon 60). Ligne active : fond `--accent-pale`.
- **Fil** (`63:569`) : en-tête 103 avec avatar, `ex. Claire Martin`, `ex. Atelier Lune · fleuriste`, badge Accent `ex. Vitrine · étape 2 / 4`, bouton « Voir la fiche » → 04. Message de l'associé : bulle `--accent` à droite, signature mono. Message du client : bulle blanche à bordure à gauche.
- **Suggestion ChatGPT** (`63:591`) : fond `chatgpt-pale`, pointillés `chatgpt`, rayon 20. « Réponse proposée par ChatGPT », badges `ex. Ton : chaleureux` et « Votre compte ChatGPT », texte, ligne « Contexte lu : … », boutons « Utiliser la réponse » (Accent), « Reformuler », « Plus court ».
- **Saisie** (`63:620`, 88 de haut) : `icon/paperclip`, `ex. Écrire à Claire… (⌘J : demander une réponse à ChatGPT)`, bouton rond `icon/send`.
- **Panneau client** (`63:628`) : PROJET (Offre, Montant, Acompte 30 %, Mise en ligne, Associés), CONTENUS ATTENDUS (coche verte ou horloge ambre), PROCHAIN RENDEZ-VOUS.

Règle produit : jamais d'envoi sans relecture (voir 05 et 12). Saisir `@` ouvre la liste des associés [note].

### 03 · Pipeline (`65:542`)

PNG : `figma/03-pipeline.png`
Route : `/pipeline`. Rôle : Kanban des affaires, cartes glissables.

En-tête : « Pipeline », `ex. 21 affaires ouvertes · 85 800 € HT en jeu · glissez une carte pour changer d'étape`. Actions : « Filtrer » (panneau sans écran), « + Nouvelle affaire » (formulaire sans écran). Filtres : Tout (Accent), Ethan, Nezar, Origine : réseau, Origine : mini-audit, Origine : site.

Colonnes (`65:667`) : 5 colonnes de 206, gap 24, en défilement horizontal (1158 de large, dépasse de 30 px).

| Colonne      | Point      | Node     |
| ------------ | ---------- | -------- |
| Prospect     | `--accent` | `65:668` |
| Appel fait   | `--accent` | `65:741` |
| Devis envoyé | `warn`     | `65:782` |
| Signé        | `success`  | `65:823` |
| Abonné       | `success`  | `65:864` |

Carte (172 de large) : client 14/600 ; offre 12 ; montant mono 13 (`ex. 7 800 €` ou `ex. 1 300 €/mois`) ; avatar 26 ; badge d'origine ; horloge + délai `ex. 3 j`, `ex. Relance J+3` (`warn`), `ex. Acompte payé`. En Abonné, le badge est Succes « Récurrent ». Bas de colonne : « + Ajouter ». Clic sur une carte → 04.

### 04 · Fiche client (`66:704`)

PNG : `figma/04-fiche-client.png`
Route : `/clients/[id]`. Rôle : vue 360° d'un client. Structure : 768 + 20 + 340.

Fil d'Ariane mono `Clients / ex. Atelier Lune`. En-tête : avatar 64, nom, badges `ex. Client · signé` (Succes), `ex. Fleuriste · Rouen` et `ex. Origine : réseau` (Neutre), `ex. Suivi par Ethan et Nezar` (Accent). Actions : « Inviter dans son espace » → envoi de C1 ; « Écrire » → 02.

- **Projet · `ex. Site vitrine`** (`66:832`, badge Accent `ex. Étape 2 / 4`) : frise 4 cases (numéro, nom, état) : On se rencontre, On démarre le projet, Retours et ajustements, Livraison et suivi ; états fait / en cours / à venir. Puis Montant, Acompte, Solde, Mise en ligne.
- **Historique** (`66:873`) : date mono, événement, détail. Exemples : message, maquette validée, acompte encaissé, devis signé, rendez-vous.
- **Contact** (`66:915`) : Nom, E-mail, Téléphone (masqué `ex. 06 •• •• •• 12`), Espace client `ex. invitée · connectée hier`.
- **Documents** (`66:938`) : liste icône + nom `ex. Devis signé · PDF`.
- **Site** (`66:972`, badge Neutre `ex. Préprod`) : domaine, `ex. Payload · CMS du client · Coolify`, `ex. Hébergement 49 €/mois · à partir de la mise en ligne`. Clic → 19.

### 05 · Réglages · Connexions (`67:845`)

PNG : `figma/05-reglages-connexions.png`
Route : `/reglages/connexions`. Rôle : état des intégrations.

Sous-titre : « Les outils branchés à Nuera OS. Tout tourne sur notre serveur, sauf ce que la loi impose (facturation, paiement) et ChatGPT. » Onglets : Agence, Associés, **Connexions** (actif), Modèles de messages, Espace client. Seul Connexions est dessiné.

**Carte ChatGPT** (`67:959`, 1128 × 217, bordure `chatgpt`) : icône, « ChatGPT · rédaction des réponses », texte « Utilise votre propre compte ChatGPT (Plus ou Pro) : aucune clé d'API à payer à part. Connecté par « Sign in with ChatGPT ». », badge `ex. Connecté · nezar@…`, bouton « Déconnecter ». 3 interrupteurs : « Suggérer une réponse » (sur chaque nouveau message client, actif), « Lire le contexte du projet » (planning, contenus, devis, actif), « Envoyer sans relecture » (jamais : un associé valide toujours, **inactif**). Bas : badge Alerte « À confirmer avec Ethan » + « Secours si OpenAI ne nous ouvre pas l'accès : une clé d'API OpenAI payée à l'usage. Seul le message traité est envoyé. »

**OUTILS BRANCHÉS** (`67:998`) : 8 cartes 264 × 144, 4 par ligne, gap 24 : icône, nom, rôle, badge d'état, badge d'hébergement.

| Outil       | Rôle                             | État `ex.`              | Hébergement     |
| ----------- | -------------------------------- | ----------------------- | --------------- |
| Twenty      | CRM · contacts, affaires, tâches | Connecté                | Notre serveur   |
| Payload     | CMS des sites clients            | 4 sites                 | Notre serveur   |
| DocuSeal    | Signature des devis              | Connecté                | Notre serveur   |
| Indy        | Factures et comptabilité         | API à vérifier (Alerte) | Externe, imposé |
| Uptime Kuma | Surveillance des sites           | 3 / 3 en ligne          | Notre serveur   |
| n8n         | Automatisations entre outils     | Optionnel (Neutre)      | Notre serveur   |
| Cal.diy     | Prise de rendez-vous             | Connecté                | Notre serveur   |
| Coolify     | Mise en ligne et sauvegardes     | Connecté                | Notre serveur   |

Ces états doivent être réels : voir §7.

### 06 · Tableau de bord · mode édition (`67:1104`)

PNG : `figma/06-tableau-de-bord-edition.png`
Route : état de `/`. Rôle : réorganiser les tuiles.

Différences avec 01 : sous-titre « Mode édition · glissez pour déplacer, la poignée change la taille, le rond retire la tuile » ; tuiles à bordure 2 px `--accent`, poignée bleue ; rond « Retirer » 24 en haut à gauche de chaque tuile (12 instances, `150:6913` à `150:6946`).

**Galerie de tuiles** (`67:1564`, 360 × 1096, à `x=1068, y=12`, flottante, couvre la droite de la grille) : « Ajouter une tuile », « Glissez une tuile sur le tableau, ou cliquez pour l'ajouter à la fin. » Liste (310 × 46, plus + nom + taille) : Projets en retard 1×1, Temps passé / devis 2×1, Abonnements 2×1, Contenus manquants 2×1, Factures Indy 2×2, Automatisations n8n 2×1, Trésorerie 2×1, Rapport mensuel 2×2. Bas : « Annuler » → 01 sans enregistrer, « Terminé » → 01 enregistré.

Le contenu de ces 8 tuiles n'est pas dessiné. Les boutons de l'en-tête (`67:1115`, `67:1116`) sont cachés sous la galerie. Prévoir une persistance par utilisateur.

### 07 · Clients (`87:1921`)

PNG : `figma/07-clients.png`
Route : `/clients`. En-tête : « Clients », `ex. 12 clients · 4 prospects actifs · 3 abonnés`. Actions : « Importer », « + Nouveau client » (sans écran). Filtres : recherche + Tous, Clients, Prospects, Abonnés, Anciens.

Tableau (`87:2049`, lignes 66) : CLIENT `flex` (avatar 32, société, contact · activité), STATUT 140, PROJET 170, MONTANT 130, ORIGINE 120, ASSOCIÉ 80. Statuts : Client (Succes), Abonné (Accent), Devis envoyé (Alerte), Prospect (Neutre). Ligne → 04.

### 08 · Projets (`87:2215`)

PNG : `figma/08-projets.png`
Route : `/projets`. En-tête : « Projets », `ex. 4 projets · 1 en retard · charge 14 / 18 journées`. Actions : « Vue calendrier » (sans écran), « + Nouveau projet » (sans écran). Filtres : recherche + En cours (actif), À venir, Livrés, En retard.

Tableau (`87:2341`, lignes 66) : PROJET `flex` (avatar, client, offre · durée), ÉTAPE 170 `ex. 2 · On démarre`, AVANCEMENT 150 (jauge + `ex. 5 / 12 j`), MISE EN LIGNE 110, STATUT 170, ÉQUIPE 80. Statuts : Contenus attendus (Alerte), Dans les temps (Succes), En retard · `ex. 2 j` (Danger), En attente (Neutre). Ligne → 17.

Carte « Charge sur 6 semaines · `ex.` 18 journées par semaine à deux » (`87:2442`, 1128 × 226) : 6 barres `ex. S45 à S50` ; barre de surcharge en `warn` (S46).

### 09 · Devis (`87:2469`)

PNG : `figma/09-devis.png`
Route : `/devis/[id]`, liste + détail côte à côte. Structure : 668 + 20 + 440. En-tête : « Devis », `ex. 2 à signer · 3 signés ce mois · 35 750 € HT`. Action : « + Nouveau devis ». Filtres : recherche + Tous, Brouillons, Envoyés, Signés, Refusés.

Tableau (`87:2595`, lignes 66) : DEVIS 280 (avatar, référence, client · offre), MONTANT 90, STATUT 130, ENVOYÉ 80. Statuts : Signé (Succes), Relance J+3 (Alerte), Brouillon (Neutre).

**Éditeur** (`87:2665`, 440 × 584) : référence · client ; « Émis par Ethan Ngo et Nezar Zakaria, en co-traitance » ; badge `ex. Version 2` + `ex. v1 envoyée le 30 oct. · options modifiées` ; lignes prestation, durée ou période, prix ; Total HT, TVA 20 %, Acompte 30 % `ex. 2 925 € · 2 factures` ; bloc vert **Rentabilité estimée** `ex. 63 %` avec `ex. 15 j estimés · coût interne ≈ 3 600 € · périmètre : 5 pages + anglais, hors photos et rédaction` ; actions « Aperçu PDF », « Envoyer à signer » ; note « Signature DocuSeal · relance automatique à J+7 ».

Aucun champ de saisie n'est dessiné, malgré le nom « Éditeur ».

### 10 · Sites et CMS (`87:2699`)

PNG : `figma/10-sites-cms.png`
Route : `/sites`. En-tête : « Sites et CMS », `ex. 4 sites · 3 en ligne · 1 en préproduction`. Actions : « Ouvrir Coolify » (console externe), « + Nouveau site » (sans écran). Filtres : recherche + Tous, En ligne, Préprod, Hébergés par nous.

Grille 2 colonnes de cartes 552 × 319, gap 24. Carte : aperçu 504 × 120 `--accent-pale` avec domaine mono (pas de vraie capture) ; domaine ; `ex. Atelier Lune · Payload · 12 pages` ; badge En ligne (Succes) ou Préprod (Alerte) ; `icon/server` Disponibilité ; `icon/link` hébergement. Actions : « Ouvrir le CMS », « Voir le site ». Clic sur la carte → 19.

### 11 · Support (`88:2147`)

PNG : `figma/11-support.png`
Route : `/support`. En-tête : « Demandes et support », `ex. 2 ouvertes · 1 à valider · délai moyen de réponse 4 h`. Action : « + Nouvelle demande ».

Kanban 4 colonnes 264 × 983, gap 24, sans défilement : Reçue (point `--accent`), En cours (`warn`), À valider (`chatgpt`), Faite (`success`), avec compteur.

Carte (230) : client ; badge de gravité (Gravité faible Neutre, moyenne Alerte, haute Danger) + avatar 22 ; titre 14/600 ; origine ou état `ex. Mode « Modifier » · capture jointe`, `ex. Formulaire · page Carte`, `ex. Prêt dans le CMS`, `ex. Appliqué le 30 oct.` ; badge de facturation (`ex. Gratuit · support 30 j`, `ex. 1 journée · 650 €`, `ex. 0,5 journée · 325 €`). Colonne À valider : bouton « Appliquer ». Clic sur une carte → fenêtre de détail [note], **non dessinée**.

### 12 · Automatisations (`88:2315`)

PNG : `figma/12-automatisations.png`
Route : `/automatisations`. En-tête : « Automatisations », « Ce que Nuera OS fait toute seule · Twenty d'abord, n8n quand plusieurs outils sont en jeu ». Action : « + Nouvelle règle » (sans écran).

7 cartes 1128 × 88, gap 24 : pastille d'icône, « Quand » / « Alors » (mono), badge d'outil, compteur, interrupteur.

| Quand                                  | Alors                                                         | Outil       | Exécutions `ex.` | État    |
| -------------------------------------- | ------------------------------------------------------------- | ----------- | ---------------- | ------- |
| Un rendez-vous est pris sur Cal.diy    | Créer la fiche dans le CRM, prévenir les deux associés        | Twenty      | 14 fois ce mois  | Actif   |
| Un devis n'est pas signé après 7 jours | Relancer le client par e-mail                                 | DocuSeal    | 3 fois           | Actif   |
| Des contenus manquent à J+3 et J+7     | Relancer le client, alerter l'associé                         | Twenty      | 5 fois           | Actif   |
| Un devis est signé                     | Créer le projet, ouvrir l'espace client, envoyer l'invitation | n8n         | 3 fois           | Actif   |
| Un client écrit                        | Préparer une réponse avec ChatGPT (jamais envoyée seule)      | ChatGPT     | 41 fois          | Actif   |
| Un site ne répond plus                 | Alerte immédiate à Ethan et Nezar                             | Uptime Kuma | 0 fois           | Actif   |
| Une facture est payée sur Indy         | Débloquer la mise en ligne                                    | n8n         | à brancher       | Inactif |

### 13 · Menu du profil, ouvert (`88:2543`)

PNG : `figma/13-menu-profil.png`
Route : aucune, s'ouvre au-dessus de l'écran courant depuis le bloc utilisateur. Voile `--near-black` 25 %, clic = fermeture.

Menu (`88:2784`, 300 × 406, à `x=16, y=608`) : avatar, `ex. Nezar Zakaria`, `ex. nezar@nuera.studio · associé`, puis :

| Entrée                       | Icône      | Complément                   | Destination                       |
| ---------------------------- | ---------- | ---------------------------- | --------------------------------- |
| Mon profil                   | `clients`  |                              | 14                                |
| Personnaliser                | `edit`     |                              | 14, section Apparence             |
| Notifications                | `bell`     | badge Neutre `ex. 3`         | Panneau (sans écran)              |
| ChatGPT                      | `sparkle`  | badge ChatGPT `ex. Connecté` | 05                                |
| Réglages de l'agence         | `reglages` |                              | 05                                |
| Thème sombre                 |            | interrupteur inactif         | Bascule (thème non dessiné)       |
| Passer sur le compte d'Ethan | `clients`  |                              | Changement de compte (sans écran) |
| Se déconnecter (`danger`)    | `chevron`  |                              | 15                                |

### 14 · Personnaliser son profil (`88:2840`)

PNG : `figma/14-personnaliser-profil.png`
Route : `/profil`. Titre affiché « Mon profil », « Ce que vous voyez, et comment Nuera OS vous prévient ». Action : « Enregistrer ». Structure : 688 + 20 + 420.

- **Identité** (`88:2950`) : avatar, nom, `ex. Co-fondateur · business, international, technique`, « Changer la photo ».
- **Apparence** (`88:2962`) : 3 cartes de choix Clair (actif, bordure `--accent`), Sombre, Automatique ; « Couleur d'accent » 5 pastilles (bleu `--accent`, `--ink`, `chatgpt`, `warn`, `danger`) ; listes Langue `ex. Français`, Page d'accueil `ex. Tableau de bord`, Densité `ex. Confortable`.
- **Me prévenir quand…** (`88:3000`) : interrupteurs Un client écrit, Un devis est signé, Un paiement arrive, Un site tombe, Résumé chaque matin.
- **Comptes connectés** (`88:3022`) : ChatGPT `ex. compte Plus · Nezar`, Google Agenda (pour Cal.diy), Figma (commentaires des maquettes), avec « Déconnecter » ou « Connecter ».
- **Sessions ouvertes** (`88:3048`) : appareil · navigateur · ville, dernière activité, « Se déconnecter partout ».

### 15 · Connexion de l'équipe (`88:3060`)

PNG : `figma/15-connexion-equipe.png`
Route : `/login` (existe déjà). Fond `--near-black` plein écran, sans barre latérale.

Carte blanche `88:3061` (440 × 475, rayon ≈ 20, centrée) : logo papier dans un cartouche sombre 200 × 52 ; « Espace de l'agence » ; « Réservé à Ethan et Nezar. » ; champs E-mail, Mot de passe ; bouton Accent « Se connecter » → `/` ; note « Double authentification demandée à chaque nouvel appareil. »

Non dessinés : écran du second facteur, mot de passe oublié, erreur d'identifiants.

### 16 · Reporting (`100:4397`)

PNG : `figma/16-reporting.png`
Route : `/reporting`. En-tête : « Reporting », `ex. Novembre 2026 comparé à octobre` + « données d'exemple » (à retirer). Actions : « Ce mois ▾ » (sélecteur), « Exporter ». Structure : KPI puis 748 + 20 + 360.

**4 cartes KPI qui sont des onglets** [note] (trait actif 3 px `--text` en bas, `142:6898`) : Chiffre d'affaires, Revenus récurrents → M2 [note], Marge estimée, Conversion.

- **Comparaison des périodes** (`100:4578`) : barres 2026 vs 2025 sur 6 mois ; segment Mois · Trimestre · Année ; légende `ex. 2026`, `ex. 2025 · même période`. Graphique selon la carte active : barres comparées, courbe avec aire, courbe en escalier, barres gagnées / perdues [note].
- **Tableau** (`100:4627`, lignes 45) : ACTIVITÉ 204, CA 110, JOURNÉES 100, MARGE 90, PART 140 (jauge + %). Lignes : Sites vitrines, Landing pages, Reprises, Audits, Accompagnement, Hébergement.
- **Performance des ventes** (`100:4724`) : Opportunités gagnées (badge Succes), Perdues (badge Danger), Délai moyen de signature ; « Raisons de perte » en jauges `danger` : Budget, Délai, A choisi un template.
- **Prévision du chiffre d'affaires** (`100:4761`) : Certain · contrats signés ; Probable · devis envoyés × probabilité ; Hypothétique · pipeline ; note « Le certain et l'hypothétique ne sont jamais additionnés. »

### 17 · Projet · Atelier Lune (`100:4782`)

PNG : `figma/17-projet-detail.png`
Route : `/projets/[id]`. En-tête : `ex. Atelier Lune · Site vitrine`, `ex. Projet P-2026-007 · 7 800 € HT · Ethan et Nezar · mise en ligne prévue le 18 nov.` Actions : « Ouvrir l'espace client » → C3 vu par l'agence ; « Ajouter une tâche » (sans écran). Badges : `ex. En cours` (Accent), `ex. Bloqué · contenus attendus` (Alerte), `ex. Offre D-2026-014 acceptée` (Neutre, → 09).

- **Jalons** (`100:4951`, pleine largeur, `ex. 5 étapes`) : Cadrage, Design, Développement, Recette, Mise en ligne, avec date · état. Case verte fait, bleue en cours, sans fond à venir.
- Structure dessous : 748 + 20 + 360.
- **Tâches** (`100:4980`, lignes 45) : TÂCHE 184, RESPONSABLE 110 (avatar + prénom), ÉCHÉANCE 100, DÉPEND DE 120, STATUT 130. Statuts : Bloquée (Alerte), En cours (Accent), Faite (Succes), À faire (Neutre). Ligne « Intégrer la page Galerie » → M4 [note].
- **Recette et passation** (`100:5067`) : checklist, coche verte ou horloge.
- **Prévu et réalisé** (`100:5107`) : Journées vendues, Journées passées, Prévu à date, jauge, note d'écart `warn`.
- **Blocage** (`100:5133`, badge Alerte `ex. 2 jours`) : titre, conséquence, décision.
- **Validation client** (`100:5147`) : Direction artistique, Maquette accueil, Maquette galerie, avec badge `ex. validée 24 oct.` ou `ex. en attente`.

### 18 · Temps et capacité (`100:5170`)

PNG : `figma/18-temps-capacite.png`
Route : `/temps`. En-tête : « Temps et capacité », `ex. Semaine 45 · 18 journées disponibles par semaine à deux`. Actions : « Saisir du temps » (sans écran), « Simuler un projet » (→ carte Simuler). Structure : KPI puis 728 + 20 + 380.

KPI : Temps saisi cette semaine, Charge du mois, Prévu / réel, Non facturable.

- **Feuille de temps** (`100:5349`, lignes 45) : PROJET 162, LUN à VEN 70 chacun, TOTAL 80. Les cellules se saisissent [note].
- **Capacité sur 6 semaines** (`100:5442`, badge Neutre « prévu / disponible ») : 6 barres avec `ex. S45 · 90 %`. Couleur : `warn` près du plein, `danger` au-dessus de 100 %, `--accent` sinon. La note dit « orange » au-dessus de 100 %.
- **Simuler un nouveau projet** (`100:5480`) : Projet, Charge estimée, Début possible, Mise en ligne réaliste (badge), note « À annoncer au prospect : la date tient compte des projets déjà signés. » Champs recalculés [note].
- **Temps par catégorie** (`100:5507`) : Production, Corrections, Support, Prospection, Administratif, en jauges.
- **Productivité par prestation** (`100:5538`) : `ex. Vitrine · vendu 12 j` + badge `ex. réel 12,8 j`. Alerte si dépassé, Succes si sous le vendu, Neutre si à peine au-dessus.

### 19 · Site · kine-rive-gauche.fr (`100:5562`)

PNG : `figma/19-site-detail.png`
Route : `/sites/[id]`. En-tête : domaine, `ex. Kiné Rive Gauche · site vitrine · Payload · hébergé par Nuera (NUERA-PROD-01)`. Actions : « Ouvrir dans Coolify » (externe), « Déployer ». Badges : `ex. Production · opérationnel` (Succes), `ex. Staging · kine.staging.nuera.studio`, `ex. Dépôt GitHub · main` (Neutre). Structure : KPI puis 728 + 20 + 380.

KPI : Disponibilité 30 jours, Dernier déploiement, Dernière sauvegarde, Domaine · expiration.

- **Disponibilité · 30 jours** (`100:5750`) : lien « Détails » → M3 [note], badge « Uptime Kuma », 30 barres (`success`, `warn` si lent), ligne d'incident.
- **Déploiements** (`100:5795`, lignes 45) : DÉPLOIEMENT 270 (`ex. feat: … (a3f9c12)`), DÉCLENCHÉ PAR 140 (avatar + prénom, ou « automatique »), DURÉE 110, RÉSULTAT 120. Réussi (Succes), Échec · annulé (Danger).
- **Relations techniques** (`100:5855`) : Client, Projet, Serveur, CMS, Contrat, tous liens.
- **Domaine et HTTPS** (`100:5882`) : Registrar, Renouvellement, Certificat HTTPS (badge).
- **Sauvegardes** (`100:5904`) : lignes datées (badge réussie), Stockage hors serveur (badge Alerte `ex. à configurer (S3)`), « Procédure de restauration » → 23.

« Déployer » change d'état et insère une ligne [note]. **La confirmation exigée pour la production n'est pas dessinée** (voir §8).

### 20 · Contrats et abonnements (`100:5932`)

PNG : `figma/20-contrats-abonnements.png`
Route : `/contrats`. En-tête : « Contrats et abonnements », `ex. 3 contrats actifs · 1 398 € par mois · 1 renouvellement dans 30 jours`. Action : « + Nouveau contrat » (sans écran).

KPI : Revenus récurrents, Contrats actifs, À renouveler (30 j), Forfaits consommés.

Tableau (`100:6105`, 1128, lignes 45) : CONTRAT 358, TYPE 170, PRIX 120, PÉRIODICITÉ 110, PROCHAINE ÉCHÉANCE 130, ÉTAT 120. États : À revoir (Alerte), Actif (Succes), À démarrer (Neutre). Dessous : 728 + 20 + 380.

- **Consommation des forfaits** (`100:6177`) : libellé, `ex. 1,5 / 2 j` mono, jauge (`warn` si proche du quota).
- **Journal de maintenance** (`100:6201`) : date mono, intervention · client.
- **Renouvellements et révisions** (`100:6222`) : objet + badge (Alerte ou Neutre) ; note « Sortie sans frais possible au bilan de 6 mois si les résultats ne suivent pas. »

### 21 · Finances et rentabilité (`101:5299`)

PNG : `figma/21-finances-rentabilite.png`
Route : `/finances`. En-tête : « Finances et rentabilité », « Les factures officielles restent dans Indy · Nuera OS lit leurs références et leurs états ». Actions : « Ouvrir Indy » (externe), « Exporter ». Structure : KPI puis 728 + 20 + 380.

KPI : Encaissé ce mois, À encaisser, En retard, Marge réelle moyenne.

- **Factures** (`101:5478`, lignes 45) : FACTURE INDY 134, CLIENT · PROJET 150, ÉMISE PAR 110, MONTANT 110, ÉTAT 120. Payée (Succes), Envoyée (Accent). **Co-traitance : 2 factures par échéance, une par associé.**
- **Rentabilité par projet** (`101:5550`) : PROJET 154, PRIX 110, COÛT ESTIMÉ 110, COÛT RÉEL 110, MARGE RÉELLE 140 (jauge + %). `ex. en cours` et `—` si non calculable.
- **Échéancier** (`101:5605`), **Coûts récurrents** (`101:5626`, dont `ex. 3 VPS OVH` « à chiffrer » et la note « Un abonnement est déficitaire si ses coûts dépassent son prix : aucun aujourd'hui. »), **Rentabilité client** (`101:5649`, jauges sans chiffre).

### 22 · Équipe (`101:5672`)

PNG : `figma/22-equipe.png`
Route : `/equipe`. En-tête : « Équipe », « Deux associés · qui fait quoi, et qui est disponible ». Action : « Affecter une mission » (sans écran).

- 2 cartes 552 × 214 : avatar 56, nom, fonction, 4 badges de compétence (Accent), Disponibilité, jauge (`warn` si pleine), `ex. Ce mois : 4 / 4 j vendues`.
- **Missions** (`101:5873`, lignes 45) : MISSION 464, PROJET 160, INTERVENANT 140, ÉCHÉANCE 120, LIVRABLE 140.
- **Sous-traitants** (`101:5932`, badge Alerte « À trancher ») : « Ce module est prévu par la spécification de Nuera OS (module 12), mais la décision du 21/10/2026 est de ne pas sous-traiter : au-delà de notre capacité, on décale ou on refuse. Le module reste masqué tant que la règle ne change pas. »

### 23 · Documents et connaissances (`101:5945`)

PNG : `figma/23-documents-connaissances.png`
Route : `/documents`. En-tête : « Documents et connaissances », « Documents clients et projets, modèles, procédures · recherche par client, projet ou contrat ». Actions : « Nouveau modèle », « + Ajouter un document » (sans écran). Recherche pleine largeur. Structure : 728 + 20 + 380.

- **Documents** (`101:6112`, lignes 45) : DOCUMENT 154, LIÉ À 150, VERSION 90, PARTAGE 120, MODIFIÉ 110. Partage : Interne (Neutre), Partagé client (Accent).
- **Modèles** (`101:6185`), **Checklists** (`101:6216`) : 2 cartes de liste.
- **Base de connaissances** (`101:6243`) : titre + type `ex. Procédure interne · Nezar`.
- **Historique · `ex. Brief Atelier Lune`** (`101:6267`) : versions, date · auteur.

### 24 · Administration et sécurité (`101:6288`)

PNG : `figma/24-administration-securite.png`
Route : `/administration`. En-tête : « Administration et sécurité », « Comptes, rôles, journal des actions sensibles, connexions et export des données ». Actions : « Exporter les données », « + Inviter un utilisateur » (sans écran). Structure : 728 + 20 + 380.

- **Utilisateurs** (`101:6450`, lignes 49) : UTILISATEUR 210, RÔLE 150 (Associé · admin Accent, Client · portail Neutre), DOUBLE AUTH. 130 (Activée Succes, Lien e-mail Neutre), DERNIÈRE CONNEXION 150.
- **Permissions** (`101:6502`, lignes 45, coche verte) : PERMISSION 370, ASSOCIÉ, CLIENT, LECTURE 90 chacun.

| Permission                    | Associé | Client | Lecture |
| ----------------------------- | ------- | ------ | ------- |
| Voir les finances             | oui     |        |         |
| Déclencher un déploiement     | oui     |        |         |
| Voir ses projets et documents | oui     | oui    | oui     |
| Ouvrir une demande            | oui     | oui    |         |
| Modifier les rôles            | oui     |        |         |

- **Actions sensibles** (`101:6580`) : ACTION SENSIBLE 376, AUTEUR 130, DATE 150.
- **Connexions externes** (`101:6619`) : Coolify · API, Indy, Uptime Kuma, Signature électronique, ChatGPT, avec badge d'état.
- **Automatisations · exécutions** (`101:6653`, badge Danger `ex. 1 échec`) : dernières exécutions, « Relancer sans doublon ».
- **Réversibilité** (`101:6680`) : « Toutes les données métier de Nuera OS s'exportent en un clic (CSV et JSON). », « Exporter maintenant ».

## 5. Écrans client

### C1 · E-mail d'invitation (`68:1215`, 1000 × 1120)

PNG : `figma/C1-email-invitation.png`
Pas de route : modèle d'e-mail. Le haut du cadre (objet, De, À) n'est qu'une présentation.

Objet : « Votre espace projet Nuera est prêt ». De : `Nuera Studio <bonjour@nuera.studio>`. Corps 600 de large (`68:1220`), bordure, rayon ≈ 20 : bandeau `--near-black` + logo papier ; « Bonjour `ex. Claire`, » ; texte d'accueil ; bouton Accent « Accéder à mon espace » → C3, connexion directe ; « Pas de mot de passe à retenir : ce bouton vous connecte directement. Il reste valable 24 heures ; ensuite, demandez un nouveau lien depuis la page de connexion. » ; avatars, « Ethan et Nezar », « Nuera Studio · les deux mêmes personnes, du début à la fin » ; pied « Vous recevez ce message parce qu'un projet est en cours avec Nuera Studio. app.nuera.studio ». Lien expiré → C9.

### C2 · Connexion (`68:1252`)

PNG : `figma/C2-connexion.png`
Route : `/espace/connexion`. Structure : 620 + 820.

- Gauche, `--near-black` : logo papier ; « Votre projet, au même endroit. » ; texte ; 3 puces.
- Droite, bloc 400 centré : « Connexion à votre espace » ; texte ; champ « Adresse e-mail » (focus, bordure `--accent`) ; Bouton compact Principal « Recevoir mon lien de connexion » ; **état succès dessiné** (`68:1290`, fond `success-pale`) « Lien envoyé à `ex. …`. Pensez à regarder vos indésirables. » ; « Un souci ? Écrivez-nous : bonjour@nuera.studio ».

Non dessinés : erreur de format, adresse inconnue. Ne pas révéler si une adresse existe.

### C3 · Mon projet (`69:1290`, 1440 × 1286)

PNG : `figma/C3-mon-projet.png`
Route : `/espace`. Capsule : Mon projet.

- **En-tête** (`155:6966`) : `ex. Bonjour Claire` 44/700 ; chapô écrit selon l'étape ; à droite « Mise en ligne prévue », `ex. 18 novembre` 36/700, point `success` `ex. Dans 15 jours · dans les temps`.
- **Le chemin de votre site** (`155:6976`, 1360 × 217, `ex. Étape 2 sur 4`) : rail avec 4 étapes (On se rencontre, On démarre le projet, Retours et ajustements, Livraison et suivi). Fait : rond vert à coche. En cours : anneau `en-cours`. À venir : rond vide. Marqueur « Nous en sommes là » sur le rail.
- Structure : 856 + 24 + 480.
- **À vous de jouer** (`155:7005`) : texte « S'ils arrivent plus tard, la mise en ligne recule d'autant, et nous vous le disons tout de suite. » ; lignes de contenus attendus avec point, nom, échéance : « Déposer les photos » (Principal), « Compléter » (Secondaire).
- **Prochain rendez-vous** (`155:7064`) : pastille date, heure, objet · durée · canal ; « Ajouter à mon agenda » (Secondaire), « Déplacer » (Discret).
- **Maquette à valider** (`155:7027`, 480 × 486) : titre, version · réception, aperçu navigateur, « Je valide » (Principal), « J'ai des retours » (Secondaire), `ex. 2 tours de retours inclus par étape · il vous en reste 2`.
- **Paiements** (`155:7076`) : montant réglé sur total, jauge `success`, explication du solde en deux factures.
- **Vos interlocuteurs** (`155:7084`) : avatars, « Les deux associés qui font votre site », « Écrire un message » → C4.

### C4 · Messages (`69:1456`)

PNG : `figma/C4-messages.png`
Route : `/espace/messages`. Capsule : Messages. Structure : 1016 + 24 + 320.

- **Conversation** (`69:1487`) : avatars, « Ethan et Nezar », « Réponse en général dans la journée ouvrée » ; séparateurs de jour (badge Neutre) ; messages reçus à gauche (avatar, bulle à bordure, pièce jointe, signature), envoyés à droite (bulle `--accent`, « Vous · heure »).
- **Saisie** (`69:1529`) : trombone, « Écrire à Ethan et Nezar… », micro, calendrier, envoi rond. Aide : « Joindre un fichier, ou le glisser ici », « Dicter votre message », « Proposer un rendez-vous », « Entrée pour envoyer · Maj + Entrée pour aller à la ligne ».
- **Fichiers partagés** (`69:1537`) : liste, puis grande zone pointillée « Déposer des photos ».

### C5 · Menu du profil (`89:2847`, 1440 × 1286)

PNG : `figma/C5-menu-profil.png`
Route : aucune, au-dessus de C3. Menu `89:2923`, 300 × 285, à `x=1100, y=96`.

Avatar, nom, e-mail ; Mon profil → C8 ; Notifications par e-mail (badge Succes `ex. Activées`) → C8 ; Mon site en ligne → site public ; Écrire à Ethan et Nezar → C4 ; Se déconnecter (`danger`) → C2.

### C6 · Documents (`89:2959`, 1440 × 764)

PNG : `figma/C6-documents.png`
Route : `/espace/documents`. Titre « Vos documents », « Tout ce que nous avons échangé, au même endroit ». Action : « Tout télécharger » (Secondaire). Filtres : Tous, Devis et contrats, Factures, Maquettes, Vos fichiers.

Grille 4 colonnes de cartes 322 × 203, gap 24 : icône, titre, détail, badge. Clic → téléchargement (déduit).

| Type `ex.`                         | Icône             | Badge                  |
| ---------------------------------- | ----------------- | ---------------------- |
| Devis signé                        | `devis`           | Signé (Succes)         |
| Facture d'acompte, une par associé | `euro`            | Payée (Succes)         |
| Maquette validée                   | `edit`            | Validée (Accent)       |
| Maquette à valider                 | `edit`            | À valider (Alerte)     |
| Cession des droits d'auteur        | `devis`           | À venir (Neutre)       |
| Fichier du client                  | `link` ou `devis` | Votre fichier (Neutre) |

### C7 · Mon site (`89:3099`, 1440 × 745)

PNG : `figma/C7-mon-site.png`
Route : `/espace/mon-site`. Titre « Mon site », `ex. atelier-lune.fr · en préproduction · mise en ligne le 18 novembre`. Action : « Voir mon site » (Principal). Structure : 856 + 24 + 480.

- **Modifier mon site** (`89:3160`) : « Cliquez sur un texte ou une photo de votre site, proposez le changement, et nous l'appliquons. Le design reste protégé. » Illustration (`89:3163`) : élément à contour pointillé bleu, bulle « Votre nouvelle version », « Envoyer la demande » (Principal), « Annuler » (Discret). Puis « Ouvrir le mode Modifier » (Secondaire).
- **Mes demandes** (`89:3185`) : titre, date, badge Reçue (Accent) ou Faite (Succes) ; note `ex. 30 jours de support inclus après la mise en ligne`.
- **Hébergement et maintenance** (`89:3200`, calque nommé « Mon abonnement ») : `ex. 49 € HT par mois · à partir de la mise en ligne` ; « Votre domaine reste à votre nom, votre site et son code vous appartiennent. »

Une demande envoyée crée une carte « Reçue » dans 11. Le mode Modifier sur le vrai site n'est décrit que par la note.

### C8 · Mon profil (`89:3204`, 1440 × 811)

PNG : `figma/C8-mon-profil.png`
Route : `/espace/profil`. Capsule : Aucun. Titre « Mon profil », « Vos informations et la façon dont nous vous prévenons ». Action : « Enregistrer » (Principal). Structure : 856 + 24 + 480.

- **Mes informations** (`89:3265`) : avatar 64, « Changer la photo » ; champs Nom, Entreprise, E-mail de connexion, Téléphone.
- **M'écrire quand…** (`89:3290`) : Ethan ou Nezar m'écrit, Une maquette est à valider, Une facture est disponible, Un rappel pour mes contenus, Le rapport mensuel est prêt.
- **Connexion** (`89:3312`) : « Sans mot de passe : un lien par e-mail, valable 24 h. » ; appareils, dernière connexion ; « Se déconnecter » (Discret).

### C9 · Lien expiré (`89:3326`)

PNG : `figma/C9-lien-expire.png`
Route : `/espace/lien-expire`. Fond blanc, sans capsule. Carte centrée `89:3327`, 480 × 423, bordure : logo encre, horloge `warn`, « Ce lien a expiré », « Pour votre sécurité, un lien de connexion n'est valable que 24 heures. Demandez-en un nouveau : il arrive en quelques secondes. », « Recevoir un nouveau lien » (Principal), « Vous avez été déconnectée ? Même chemin : un nouveau lien suffit. » Le texte est genré : à neutraliser.

## 6. Mouvement

Sous-titre de la section (`142:6909`) : « Chaque écran M montre un instant d'une animation décrite dans les notes bleues. Ce sont des copies des écrans d'origine : modifier l'original ne les met pas à jour. »

### Instants figés

| Écran                                                           | Node       | PNG                                         |
| --------------------------------------------------------------- | ---------- | ------------------------------------------- |
| M1 · 01 Tableau de bord · arrivée, instant 0,9 s                | `138:6073` | `figma/M1-tableau-de-bord-arrivee.png`      |
| M2 · 16 Reporting · onglet Revenus récurrents, survol d'octobre | `138:6515` | `figma/M2-reporting-revenus-recurrents.png` |
| M3 · 19 Site · fenêtre Santé du site ouverte                    | `141:6485` | `figma/M3-site-sante-fenetre.png`           |
| M4 · 17 Projet · tâche ouverte, commentaire avec mention        | `141:6999` | `figma/M4-projet-tache-commentaire.png`     |

Ces cadres contiennent aussi les **seuls dessins** de ces éléments :

- **M2, courbe** (`138:6877`) : échelle `ex. 1 500 / 750 / 0`, aire, ligne de survol pointillée, point survolé 12, info-bulle `138:6902` : mois mono, montant, écart en `success`. Titre de carte « Revenus récurrents · par mois ».
- **M3, fenêtre « Santé du site »** (`141:6795`, 560 × 696) : en-tête « Santé du site » + lien « Fermer » ; domaine · 30 derniers jours ; 4 mesures Disponibilité, Temps de réponse moyen, Erreurs serveur, Sauvegardes, avec valeur mono, jauge à segments, commentaire ; « Ouvrir dans Uptime Kuma ».
- **M4, fenêtre « Tâche »** (`141:7330`, 640 × 779) : titre + « Fermer » ; projet ; champs Responsable, Échéance, Statut, Dépend de ; onglets Description, **Commentaires · `ex. 2`**, Historique (trait actif) ; fil avec avatar, auteur · date, réponse en retrait, mention bleue, pièce jointe ; champ focus ; liste de suggestions `141:7386` avec aide « Entrée pour choisir · Échap pour fermer » ; pied « Associés » + avatars, « Annuler », « Enregistrer ».

### Notes, texte intégral

Spécification citée par la note : `sources/etudes/2026-11-03-motion-nuera-os.md` (dépôt du business plan, **absente de ce dépôt**).

**Règles communes · `137:6044` · « Comment bouge Nuera OS »**
Rien n'apparaît d'un coup : le cadre, puis les titres, puis les données.
Entrée type : opacité de 0 à 1, flou de 6 px à 0, glissement de 6 px vers le haut, en 350 ms.
Réaction à un clic ou un survol : 150 ms au plus. Élément : 200 à 400 ms. Graphique ou compteur : 500 à 800 ms. Page entière : 2 s au plus.
Cascade : 25 ms entre deux barres, 30 ms entre deux entrées de menu, 60 ms entre deux cartes.
Entrée en forte décélération, sortie deux fois plus courte. Aucun rebond.
Fenêtre de détail : fond flouté sous un voile clair, jamais noir.
Ne bouge jamais : le texte qu'on lit, la barre latérale une fois arrivée, une page déjà vue dans la session.
Réglage « réduire les animations » du système : tout devient un fondu de 150 ms.
Les notes bleues au-dessus des écrans décrivent leur mouvement. Les écrans M1 à M4, sous l'espace client, en montrent un instant figé.
Spécification complète : sources/etudes/2026-11-03-motion-nuera-os.md (dépôt du business plan).

**01 · `137:6048` · « Le tableau de bord se construit en 2 secondes »** (2.1 arrivée, 2.2 chiffres, 2.3 graphiques, 2.5 survol)
0 à 250 ms · la page précédente floute et s'efface.
250 à 600 ms · barre latérale et en-tête arrivent, les entrées du menu en cascade.
600 à 1 200 ms · les tuiles arrivent vides, ligne par ligne, en passant du flou au net.
1 000 à 2 000 ms · les chiffres comptent depuis 0 (11 700 €, 1 349 €, 7 020 €), les barres du chiffre d'affaires montent une à une, la jauge de charge se remplit.
Survol d'une barre : les autres pâlissent, une info-bulle donne le mois, le montant et l'écart.
Poignée de taille : la tuile s'agrandit, ses voisines glissent à leur nouvelle place en 300 ms.
Instant figé à 0,9 s : écran M1.

**02 · `137:6052` · « Les messages arrivent, la réponse ChatGPT s'écrit »** (2.7)
Message envoyé : il entre en bas du fil (fondu et glissement de 8 px, 250 ms), le champ se vide.
Message reçu : même entrée ; dans la liste de gauche, la conversation remonte en haut et la pastille du compteur roule (4 à 5).
Réponse proposée par ChatGPT : le cadre apparaît en fondu, le texte s'écrit mot à mot, puis « Envoyer » s'active.
Taper @ dans le champ ouvre la liste Ethan / Nezar ; le nom choisi devient une mention en couleur.
Clic sur une conversation : le fil change par fondu croisé (200 ms), le panneau projet à droite ne bouge pas.

**11 · `137:6056` · « Une demande s'ouvre au-dessus de la liste »** (2.6, 2.7)
Clic sur une demande : sa fiche s'ouvre en fenêtre au-dessus de la liste floutée, comme la tâche de l'écran M4.
Changer l'état (Reçue, En cours, À valider, Faite) : la pastille change de couleur en 150 ms, la carte glisse vers sa colonne en 300 ms.
« Appliqué » : une coche se dessine, puis la date apparaît en fondu.
Commentaires et mentions : même mécanique que M4.

**16 · `137:6060` · « Les 4 cartes du haut changent le graphique »** (2.2, 2.3, 2.4, 2.5)
Les 4 cartes sont des onglets. Un clic fait glisser le trait foncé sous la carte choisie (250 ms) et remplace le graphique.
Chaque mesure a son graphique : barres comparées pour le chiffre d'affaires, courbe avec aire pour les revenus récurrents, courbe en escalier pour la marge, barres gagnées / perdues pour la conversion.
L'ancien graphique s'efface vers le bas (200 ms), le nouveau se dessine de gauche à droite (500 à 800 ms), l'échelle change en fondu.
Survol : une ligne verticale s'aimante au mois le plus proche, l'info-bulle glisse d'un mois à l'autre et son nombre roule.
Tableau : les barres de part se remplissent à l'arrivée.
Prototype : cliquer sur « Revenus récurrents » ouvre l'écran M2.

**17 · `137:6064` · « Une tâche s'ouvre en fenêtre, on la commente »** (2.3, 2.6, 2.7)
Jalons : quand une étape passe à « fait », sa couleur se remplit de gauche à droite (400 ms), puis l'étape suivante s'éclaire.
Clic sur une tâche : le fond floute, la fenêtre passe de 90 % à 100 % de sa taille, son contenu arrive rangée par rangée.
Commentaire : au clic, le contour du champ fonce ; @ ouvre la liste des associés ; « Enregistrer » ajoute le commentaire en bas du fil avec « à l'instant ».
Prévu et réalisé : la barre se remplit à l'arrivée.
Prototype : cliquer sur « Intégrer la page Galerie » ouvre l'écran M4.

**18 · `137:6068` · « La charge se lit en mouvement »** (2.2, 2.3)
Arrivée : 31 h, 78 %, +6 % et 22 % comptent depuis 0.
Les barres des semaines S45 à S50 montent l'une après l'autre ; une semaine au-dessus de 100 % (S46) passe à l'orange en fin de course, jamais avant.
Saisie d'heures dans le tableau : le total de la ligne et celui de la semaine roulent vers leur nouvelle valeur.
« Début possible » d'un projet estimé : la date se recalcule en fondu croisé quand on change la charge estimée.

**19 · `137:6072` · « La santé du site s'ouvre dans une fenêtre »** (2.3, 2.6)
Arrivée : les 30 barres de disponibilité se remplissent de gauche à droite (25 ms d'écart) ; le jour lent prend sa couleur orange en dernier.
« Détails » : la fenêtre « Santé du site » s'ouvre au-dessus de l'écran flouté, ses jauges se remplissent l'une après l'autre.
« Déployer » : le bouton passe en état « en cours », une ligne entre en haut du tableau avec un badge qui pulse doucement, puis devient « Réussi ».
Prototype : « Détails » ouvre l'écran M3.

**21 · `137:6076` · « Les montants comptent, chaque facture reste rattachée à son associé »** (2.2, 2.5)
Arrivée : 7 020 €, 2 340 €, 0 € et 61 % comptent depuis 0 ; les unités arrivent à la fin.
Les lignes de factures entrent en cascade (60 ms) ; les deux factures d'une même échéance (Ethan, Nezar) arrivent ensemble.
Survol d'une ligne de projet : l'écart entre coût estimé et coût réel se dessine en barre, verte ou orange.
Nouvel état lu dans Indy (payée) : la pastille change de couleur en 150 ms, le total « Encaissé » roule.

**C3 · `137:6080` · « Le client voit son projet avancer, sans effets »** (côté client, version sobre)
Pas de flou d'arrivée ni de chiffres qui comptent côté client : un fondu de 250 ms suffit.
Les 4 étapes se remplissent jusqu'à l'étape en cours (600 ms), puis « On démarre le projet » reçoit un léger halo.
Contenu déposé (photos, horaires) : la ligne passe à « reçu » avec une coche qui se dessine.
Nouveau document ou message de Nuera : il entre en fondu et glissement de 8 px.

**C7 · `137:6084` · « Cliquer sur son site pour proposer un changement »** (mode « Modifier »)
Survol d'un texte ou d'une photo du site : un contour bleu se dessine autour de l'élément (150 ms).
Clic : une bulle s'ouvre depuis l'élément, avec la version actuelle et le champ de la nouvelle version.
« Envoyer » : la bulle se replie vers « Mes demandes », où la demande entre en haut de la liste avec « envoyée aujourd'hui ».

**M1 · `142:6910` · « Le tableau de bord en train d'arriver »** (0,9 s après l'ouverture)
Première ligne : en place. Le chiffre d'affaires compte (7 340 € sur 11 700 €), les barres montent de gauche à droite : juin est presque arrivé, novembre commence à peine.
Deuxième ligne : encore floue et transparente, elle remonte de 6 px en devenant nette ; ses chiffres comptent aussi.
Lignes suivantes : seuls les contours et les titres des tuiles sont là ; leur contenu arrive dans les 600 ms qui suivent.
À 2 s, l'écran est celui de 01.

**M2 · `142:6914` · « Revenus récurrents, survol d'octobre »**
Le trait foncé a glissé de « Chiffre d'affaires » à « Revenus récurrents ». Les barres comparées sont parties vers le bas ; la courbe s'est tracée de juin à novembre, puis l'aire s'est remplie.
La souris est sur octobre : la ligne pointillée s'y est aimantée, le point grossit, « Oct. » passe en gras, l'info-bulle donne le montant et l'écart.
En glissant vers novembre, l'info-bulle suit et son montant roule.
Prototype : cliquer sur « Chiffre d'affaires » revient à l'écran 16.

**M3 · `142:6918` · « Santé du site, depuis « Détails » »**
L'écran 19 est passé sous un flou de 6 px et un voile clair. La fenêtre est arrivée de 90 % à 100 % de sa taille en 300 ms.
Ses quatre jauges se sont remplies l'une après l'autre, segment par segment, de gauche à droite.
Chiffres d'exemple, à brancher sur Uptime Kuma et sur les sauvegardes de Coolify.
Prototype : « Fermer » revient à l'écran 19 (fermeture en 200 ms, sans cascade).

**M4 · `142:6922` · « Commenter une tâche et mentionner un associé »**
La fiche de la tâche est ouverte au-dessus de l'écran 17 flouté, onglet « Commentaires » actif.
Le champ a le focus (contour foncé). Nezar a tapé « @Eth » : la liste ne garde que les associés qui correspondent, Ethan est présélectionné ; Entrée insère la mention en bleu.
« Enregistrer » ajoute le commentaire en bas du fil avec « à l'instant », puis vide le champ.
Prototype : « Fermer » ou « Annuler » revient à l'écran 17.

Les montants, noms et dates cités dans ces notes sont des exemples, comme dans les maquettes.

### Prototype des tuiles (`59:481`)

Cliquer sur la poignée fait passer une tuile de petite à moyenne puis grande ; les autres se replacent (écart décidé pour le produit : la poignée n'existe qu'en édition et se tire, un clic ne change rien). Plus une tuile est grande, plus elle montre de lignes : voir `_components-tuiles-vivantes.png`.

Écart avec 01 : le prototype n'a que 3 tailles et 6 tuiles ; 01 a 4 formats (dont 4×2) et 13 tuiles. Le comportement de la poignée pour 4×2 n'est pas défini. Le titre diffère aussi (« Messages » contre « Messages à traiter »). Seul le contenu détaillé de ces 6 tuiles existe par taille.

## 7. Règles à reprendre des maquettes

- **Associés** : tout le produit suppose deux associés (avatars couplés, 2 factures par échéance). Prévoir un modèle qui ne le fige pas.
- **Co-traitance** : acompte et solde se facturent en 2 factures, une par associé, chez Indy. Nuera OS lit les références et les états, ne facture pas.
- **ChatGPT** : suggestion seulement, l'envoi passe toujours par un associé. Le compte utilisé est celui de l'associé.
- **Connexion client** : lien par e-mail valable 24 h, sans mot de passe. Équipe : mot de passe et double authentification à chaque nouvel appareil.
- **Retard client** : « la date recule d'autant », et le client est prévenu.
- **Prévision** : certain et hypothétique ne s'additionnent jamais.
- **Sous-traitants** : module masqué par défaut (22).
- **Marquage « données d'exemple »** : badge de 01 et 06, sous-titre de 16, en-tête de M3. Annotations de maquette, à ne pas livrer.

## 8. Manques

### États non dessinés, sur tous les écrans

Chargement (hors M1), liste vide, erreur, permission refusée, 404, confirmation de suppression ou d'action sensible, connecteur indisponible ou donnée périmée. Le cadrage (`NUERA_OS_PROMPT_ALL_IN_ONE_CLAUDE_CODE_READY.md` §2, §6) les exige tous, en particulier « connexion requise / données indisponibles ». Seuls états dessinés : succès en C2, lien expiré en C9, focus en C2 et M4, ouvertures en 13, C5, M3, M4, mode édition en 06.

Également absents :

- **Responsive** : tous les écrans sont à 1440. Aucun cadre tablette ou téléphone, alors que le Design System cadre le téléphone à 390.
- **Thème sombre** : interrupteur en 13 et choix en 14, aucun écran sombre.
- **Survol et focus** : seuls `Button` a Hover et Pressed.
- **Accent personnalisable** de 14 : les conséquences sur les tons ne sont pas définies.

### Destinations sans écran

Recherche globale ⌘K ; panneau de notifications ; formulaires de création : affaire, client, import, projet, devis, site, demande, règle, contrat, mission, document, modèle, utilisateur, tâche ; panneau « Filtrer » de 03 ; « Vue calendrier » de 08 ; fenêtre de détail d'une demande (11, annoncée par la note) ; saisie du temps ; aperçu PDF ; 4 onglets de Réglages (Agence, Associés, Modèles de messages, Espace client) ; onglets Description et Historique de M4 ; contenu des 8 tuiles de la galerie ; second facteur, mot de passe oublié ; changement de compte ; dépôt de photos, formulaire « Compléter », « J'ai des retours », « Déplacer » un rendez-vous, mode Modifier réel en portail.

### Périmètre fonctionnel sans maquette (cadrage §4)

| Domaine      | Manque                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Dashboard | Filtre de période et de contexte, bloc « priorités du jour »                                                                                                                        |
| 02 CRM       | Contacts multiples, tags, notes, déduplication. La fiche 04 ne montre ni opportunités, ni devis, ni contrats, ni tickets, ni finances                                               |
| 03 Ventes    | Vue liste, qualification, tâches et rappels, saisie d'un motif de perte                                                                                                             |
| 04 Devis     | Catalogue de prestations et formules, exclusions, validité, avenants, édition réelle                                                                                                |
| 05 Projets   | Sous-tâches, livrables, demandes de changement hors périmètre                                                                                                                       |
| 06 Temps     | Saisie par tâche ou ticket, alerte de consommation à 80 %                                                                                                                           |
| 07 Sites     | Registre dense pour plusieurs centaines de sites (uniquement des cartes, sans pagination), environnements de développement, incidents, confirmation avant déploiement en production |
| 08 Contrats  | Fiche de contrat, couvert / non couvert / hors forfait, transformation en travaux                                                                                                   |
| 09 Support   | Canal, catégorie, SLA, temps passé, escalade, fiche de ticket                                                                                                                       |
| 10 Finances  | Impayés et relances, rentabilité par site et par contrat, sous-traitance                                                                                                            |
| 11 Portail   | Création d'une demande hors mode Modifier, couverture de maintenance détaillée, plusieurs projets ou sites pour un client (aucun sélecteur)                                         |
| 12 Équipe    | Sous-traitants masqués (voir ci-dessous), tarifs et coûts, permissions par intervenant                                                                                              |
| 13 Documents | Aperçu, téléchargement sécurisé, classement                                                                                                                                         |
| 14 Admin     | Centre de notifications, détail des exécutions et reprises, paramètres métier, filtres du journal d'audit                                                                           |

### Contradictions à trancher

1. **Étapes du pipeline**. Cadrage §4.03 : Nouveau → Qualifié → Devis envoyé → Négociation → Gagné / Perdu. Écran 03 : Prospect, Appel fait, Devis envoyé, Signé, Abonné. Tuile de 01 : 7 étapes, avec En cours et Livré.
2. **Reporting**. Cadrage §4.01 : « intégré ici, sans module analytique redondant ». Figma : entrée de menu et écran 16 séparés.
3. **Sous-traitants**. Cadrage §4.12 et §5 les incluent. Écran 22 : masqués, décision du 21/10/2026.
4. **Parcours support**. Cadrage §4.09 : réception → qualification → prise en charge → résolution → clôture. Écran 11 : Reçue, En cours, À valider, Faite.
5. **Capacité**. 18 journées « par semaine à deux » en 08 et 18, alors que 22 donne 4 + 14 = 18 journées **par mois**, et que 01 parle de « Charge du mois ».
6. **Seuil de surcharge**. En 08, S46 est `warn`. En 18, S45 (90 %) est `warn` et S46 (105 %) `danger`. La note dit « orange » au-dessus de 100 %.
7. **Durée de réaction**. Note Mouvement : 150 ms au plus. Token `--dur-fast` : 180 ms.
8. **Services absents du cadrage**. Les écrans utilisent ChatGPT, Cal.diy et Uptime Kuma (05), Google Agenda et Figma (14). Le cadrage §6 ne les nomme pas et demande de ne pas ajouter de service tiers sans nécessité ; il dit seulement « monitoring » pour la surveillance.
9. **Couleur d'accent**. L'accent personnalisable de 14 entre en conflit avec la règle du Design System « Jamais d'accent choisi à la main ».
10. **Bouton de la suggestion**. La note de 02 dit que « Envoyer » s'active une fois le texte écrit. L'écran montre « Utiliser la réponse », « Reformuler », « Plus court ».

### Incohérences des données d'exemple

Sans impact sur le code, mais à ne pas prendre pour des règles métier :

- MRR : `1 349 €` et 2 contrats en 01 et 16, `1 398 €` et 3 contrats en 20.
- Pipeline : 21 affaires annoncées, 12 cartes en 03.
- Clients : 12 annoncés, 8 lignes en 07.
- Devis : `D-2026-014` Signé en 09, mais encore « à signer » avec `Relance J+3` en 01. `D-2026-017` : `Relance J+3` en 09, `Envoyé hier` en 01.
- Sites : `atelier-lune.fr` à `99,98 %` en 01, en préproduction sans disponibilité en 10.
- Mise en ligne : 18 nov. partout, 20 nov. dans la décision de 17 et le message de C4.
- Dates : « jeudi 20 nov. » et « lundi 10 nov. » ne correspondent pas au calendrier 2026 (20 nov. = vendredi, 10 nov. = mardi).
