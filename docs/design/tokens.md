# Nuera OS · tokens de design

Source : fichier Figma « Nuera Design » (`nlvRWAtD1x2fKf8gVgcM0g`), page « Design System » (`1:834`) et page « Nuera OS » (`57:3`). Relevé le 2026-11-04, en lecture seule.

Limites de la lecture :

- Les outils Figma en lecture ne donnent ni la liste des collections de variables ni leurs modes. `search_design_system` renvoie vide (fichier non publié en bibliothèque). Les valeurs ci-dessous viennent de `get_variable_defs` sur 11 nœuds et du code généré. Une variable posée sur aucun de ces nœuds a pu échapper au relevé.
- Le rattachement à la collection « App · statuts » est **déduit, pas lu** : ce sont les seules variables renvoyées sans syntaxe CSS (`success` au lieu de `var(--success)`). Le code généré les écrit tout de même `var(--success, …)`.
- Les noms Figma `space/N` et `radius/x` sont lus sur les cartouches de la page Design System.

Règles du système (nœud `5:4`) : aucune valeur en dur ; on écrit des rôles (`text`, `accent`, `muted`, `border`), pas des teintes ; l'accent bascule seul sur fond sombre.

## 1. Couleurs

### Teintes de marque (`5:26`)

| Figma / CSS         | Valeur    | Usage indiqué                                                                    |
| ------------------- | --------- | -------------------------------------------------------------------------------- |
| `--ink`             | `#233353` | Fonds sombres, texte sur clair                                                   |
| `--paper`           | `#FFFFFF` | Fond, texte sur sombre                                                           |
| `--accent-on-light` | `#4368B1` | Accent sur clair                                                                 |
| `--accent-on-dark`  | `#A6B9DD` | Accent sur sombre                                                                |
| `--accent-pale`     | `#DEE5F2` | Aplats, fonds de badge                                                           |
| `--near-black`      | `#141830` | Contour et ombre des boutons ; fond de la barre latérale et de la capsule client |
| `--muted-on-light`  | `#645E78` | Texte secondaire sur clair                                                       |
| `--border-on-light` | `#D9DADE` | Bordures sur clair                                                               |

### Rôles (mode clair, valeurs relevées)

| CSS                | Valeur    | Remarque                                                                                 |
| ------------------ | --------- | ---------------------------------------------------------------------------------------- |
| `--text`           | `#233353` | Texte principal                                                                          |
| `--accent`         | `#4368B1` | Liens, boutons, jauges. Devient `#A6B9DD` en contexte sombre                             |
| `--muted`          | `#645E78` | Texte secondaire                                                                         |
| `--border`         | `#D9DADE` | Bordures et filets                                                                       |
| `--bg`             | `#FFFFFF` | Fond de page et de tuile                                                                 |
| `--surface-raised` | `#FFFFFF` | Fond du badge Neutre et rail des jauges : blanc sur blanc, donc invisibles sur une carte |
| `--btn-edge`       | `#141830` | Socle et contour du bouton                                                               |

### Variantes sur fond sombre

| CSS                     | Valeur      | Équivalent                                                             |
| ----------------------- | ----------- | ---------------------------------------------------------------------- |
| `--surface-raised-dark` | `#FFFFFF0D` | Blanc 5 % : recherche, utilisateur, pastilles de la capsule            |
| `--hairline-on-dark`    | `#FFFFFF1A` | Blanc 10 % : entrée de menu active, « Prochaine action »               |
| `--border-on-dark`      | `#FFFFFF24` | Blanc 14 % : séparateur de la capsule                                  |
| `--muted-on-dark`       | `#FFFFFF9E` | Blanc 62 % : **réutilisé comme voile clair des fenêtres** (`141:6794`) |

### Collection « App · statuts » (rattachement déduit)

| Variable          | Valeur    | Usage                                                           |
| ----------------- | --------- | --------------------------------------------------------------- |
| `success`         | `#2F6F4F` | Texte badge Succes, jauges, disponibilité                       |
| `success-pale`    | `#E4F1EA` | Fond badge Succes                                               |
| `success-on-dark` | `#5FC48B` | Anneau d'avancement de la capsule client                        |
| `warn`            | `#8A6516` | Texte badge Alerte, barre de charge élevée                      |
| `warn-pale`       | `#FBF1DC` | Fond badge Alerte                                               |
| `warn-on-dark`    | `#F2C14E` | Point « À vous » de la capsule client                           |
| `danger`          | `#B4451F` | Texte badge Danger, « Se déconnecter », raisons de perte        |
| `danger-pale`     | `#F8E6DE` | Fond badge Danger                                               |
| `chatgpt`         | `#10A37F` | Tout ce qui vient de ChatGPT, interrupteurs de la carte ChatGPT |
| `chatgpt-pale`    | `#E3F5EF` | Fond badge ChatGPT et cadre de suggestion                       |
| `en-cours`        | `#E0A10F` | Étape en cours de la frise client (C3)                          |

Aucun `danger-on-dark` n'a été trouvé.

### Teintes de badge (`57:124`)

| Ton     | Fond               | Texte      | Node     |
| ------- | ------------------ | ---------- | -------- |
| Accent  | `--accent-pale`    | `--accent` | `57:112` |
| Succes  | `success-pale`     | `success`  | `57:114` |
| Alerte  | `warn-pale`        | `warn`     | `57:116` |
| Danger  | `danger-pale`      | `danger`   | `57:118` |
| Neutre  | `--surface-raised` | `--muted`  | `57:120` |
| ChatGPT | `chatgpt-pale`     | `chatgpt`  | `57:122` |

### Valeurs en dur repérées

- Mention dans un commentaire : `#4368b1` en dur (`141:7384`) au lieu de `--accent`.
- Ombre de la capsule client : `rgba(20,23,48,.22)` (`75:1371`), teinte qui n'est pas `--near-black`.
- Ombre de l'onglet actif client : `rgba(0,0,0,.25)` (`75:1392`).
- Vignettes de la maquette dans C3 (`155:7046`) : teintes pastel d'illustration, à ne pas transformer en tokens.

### Contrastes indiqués (`5:128`)

`#4368b1` sur `--ink` : 2,31, sous le 3,0 de WCAG 1.4.11, d'où `#a6b9dd` sur sombre (6,35). `#645e78` : 6,10 sur papier, 4,86 sur `--accent-pale`.

Le site vitrine pose un grain sur le papier (bruit fractal, opacité 0,22). Il n'apparaît pas sur les écrans Nuera OS.

## 2. Typographie

### Polices

| Famille            | Rôle                                                        | Graisses                                                    | Web et licence                                                                                                                                                    | Dans Nuera OS                               |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Outfit**         | Tout le texte                                               | Système : 300 à 900. Relevé dans l'app : 400, 500, 600, 700 | **Libre et gratuite.** Google Fonts (OFL), URL de `fonts.googleapis.com` vérifiée (HTTP 200). `next/font/google` l'auto-héberge                                   | Oui, partout                                |
| **JetBrains Mono** | Libellés techniques, montants compacts, en-têtes de tableau | Relevé : 400, 500, 700                                      | **Libre et gratuite.** Google Fonts (OFL), vérifiée (HTTP 200)                                                                                                    | Oui                                         |
| **Pinyon Script**  | Un ou deux mots dans un titre du site                       | 400                                                         | **Libre et gratuite.** Google Fonts (OFL), vérifiée (HTTP 200). « En cours de choix » selon Figma                                                                 | **Non** : aucun style relevé sur les écrans |
| **Gesty Ratio**    | Titres du site vitrine                                      | 400                                                         | **Non libre.** « Licence démo, à régulariser avant la mise en ligne. » Absente de Google Fonts (HTTP 400) et absente du fichier Figma, où Outfit Bold la remplace | **Non** : ne pas l'embarquer                |

Conséquence : **Nuera OS se construit avec Outfit et JetBrains Mono seules, toutes deux utilisables sur le web sans coût.** Vérification sur les nœuds `58:152`, `69:1290`, `68:1252`, `101:6288`, `141:6999`, `57:13` et les composants relevés, pas sur chaque calque.

### Styles Figma

Tailles Figma = bureau. La plage va du téléphone (390 px) à l'ordinateur (1440 px) ; la collection « Type » porte les deux modes (non lisible ici). L'interlettrage Figma est en % du corps.

| Style            | CSS           | Famille, graisse              | Taille | Plage    | Interligne | Interlettrage |
| ---------------- | ------------- | ----------------------------- | ------ | -------- | ---------- | ------------- |
| Display/Hero     | `--text-6xl`  | Outfit 700                    | 104    | 38 → 104 | 1,06       | -4 %          |
| Display/H1       | `--text-5xl`  | Outfit 700                    | 80     | 44 → 80  | 1,06       | -3 %          |
| Display/H2       | `--text-4xl`  | Outfit 700                    | 56     | 36 → 56  | 1,06       | -3 %          |
| Display/H3       | `--text-3xl`  | Outfit 700                    | 44     | 30 → 44  | 1,06       | -2 %          |
| Display/H4       | `--text-2xl`  | Outfit 700                    | 32     | 24 → 32  | 1,06       | -2 %          |
| Text/XL          | `--text-xl`   | Outfit 400                    | 24     | 20 → 24  | 1,25       | 0             |
| Text/Lead        | `--text-lg`   | Outfit 400                    | 20     | 17 → 20  | 1,25       | 0             |
| Text/Body        | `--text-base` | Outfit 400                    | 16     | fixe     | 1,6        | 0             |
| Text/UI          | `--text-ui`   | Outfit 700                    | 15     | fixe     | 1,25       | 0             |
| Text/Label       | `--text-sm`   | Outfit 400                    | 14     | fixe     | 1,25       | 0             |
| Text/Caption     | `--text-xs`   | Outfit 400                    | 12     | fixe     | 1,6        | 0             |
| Mono/Eyebrow     | `--text-xs`   | JetBrains Mono 400, capitales | 12     | fixe     | 1,25       | +20 %         |
| Script/Accent H2 | n/a           | Pinyon Script 400             | 63     | n/a      | 1,06       | +1,5 %        |

### Tailles réellement posées dans l'app (hors styles)

Les écrans utilisent surtout des tailles littérales, qui ne correspondent à aucun style. À déclarer en tokens côté code.

| Élément                                              | Police                                                          | Taille       |
| ---------------------------------------------------- | --------------------------------------------------------------- | ------------ |
| Titre de page, agence (`87:2023`)                    | Outfit 600, `--ink`                                             | 28           |
| Sous-titre de page (`87:2024`)                       | Outfit 400, `--muted`                                           | 14           |
| Grand chiffre de tuile 4×2 (`58:279`)                | Outfit 600, `--ink`                                             | 40           |
| Chiffre de tuile et carte KPI (`58:411`, `100:4560`) | Outfit 600, `--ink`                                             | 26           |
| Libellé / note de carte KPI (`100:4559`, `100:4561`) | Outfit 500 / 400                                                | 12           |
| Titre de tuile (`57:137`)                            | Outfit 600, `--ink`                                             | 14           |
| Badge (`57:113`)                                     | Outfit 500                                                      | 12           |
| Avatar (`57:126`)                                    | Outfit 600, `--ink`                                             | 13           |
| En-tête de colonne de tableau (`87:2051`)            | JetBrains Mono 500, `--muted`                                   | 11           |
| Ligne de tableau, principal / secondaire / cellule   | Outfit 600 / 400 / 400                                          | 14 / 12 / 13 |
| Montant compact (`58:332`) / compteur (`58:333`)     | JetBrains Mono 400 / 500                                        | 11 / 13      |
| Entrée de menu inactive / active                     | Outfit 500 / 600                                                | 14           |
| Libellé de groupe de menu                            | JetBrains Mono 500, capitales, opacité 60 %, `--accent-on-dark` | 10           |
| Raccourci ⌘K                                         | JetBrains Mono 500                                              | 11           |
| Compteur de menu                                     | Outfit 600, blanc sur `--accent`                                | 11           |
| Titre client (`155:6968`)                            | Outfit 700, -0,66 px                                            | 44           |
| Chapô client (`155:6969`)                            | Outfit 400, interligne 1,45                                     | 19           |
| Date de mise en ligne client (`155:6972`)            | Outfit 700, -0,36 px                                            | 36           |
| Titre de carte client (`155:7007`)                   | Outfit 600                                                      | 20           |
| Texte de carte client (`155:7008`)                   | Outfit 400, interligne 1,45                                     | 15           |
| Titre d'action client (`155:7012`) / détail          | Outfit 600 / 400                                                | 17 / 14      |
| Bouton compact (`168:6943`)                          | Outfit 500                                                      | 14           |
| Logo « OS »                                          | JetBrains Mono 700, +0,96 px                                    | 12           |

Règles (`6:98`) : interligne 1,06 pour le titrage, 1,25 pour les sous-titres, 1,6 pour le corps.

## 3. Espacement

Base 4 px. Variables Figma `space/N`, code syntax `--space-N`.

| Figma     | CSS         | px  |     | Figma      | CSS          | px  |
| --------- | ----------- | --- | --- | ---------- | ------------ | --- |
| `space/1` | `--space-1` | 4   |     | `space/8`  | `--space-8`  | 32  |
| `space/2` | `--space-2` | 8   |     | `space/10` | `--space-10` | 40  |
| `space/3` | `--space-3` | 12  |     | `space/12` | `--space-12` | 48  |
| `space/4` | `--space-4` | 16  |     | `space/16` | `--space-16` | 64  |
| `space/5` | `--space-5` | 20  |     | `space/20` | `--space-20` | 80  |
| `space/6` | `--space-6` | 24  |     | `space/24` | `--space-24` | 96  |
| `space/7` | `--space-7` | 28  |     | `space/32` | `--space-32` | 128 |

Mise en page (site, `6:165`) : `--section-y` 88 → 152, `--gutter` 20 → 40, `--wrap-w` 1200, `--wrap-narrow-w` 760, `--wrap-wide-w` 1320, `--wrap-vast-w` 1560, `--tap-min` 44, `--header-capsule-h` 64.

Grille constatée dans l'app (valeurs littérales) : maquette 1440 ; barre latérale 248 ; contenu 1192, marges 32, largeur utile 1128 ; grille de tuiles 6 colonnes de 168, gouttière 24 ; capsule client marges 40, hauteur totale 104.

## 4. Rayons

| Figma         | CSS             | px  | Usage indiqué         | Usage relevé dans l'app                              |
| ------------- | --------------- | --- | --------------------- | ---------------------------------------------------- |
| `radius/sm`   | `--radius-sm`   | 8   | Champs, petits badges | Entrée de menu, pastille d'icône, recherche latérale |
| `radius/md`   | `--radius-md`   | 12  | Boutons               | Boutons, carte Kanban, champs, bloc utilisateur      |
| `radius/lg`   | `--radius-lg`   | 20  | Cartes, capsule       | Carte KPI, suggestion ChatGPT, note                  |
| `radius/xl`   | `--radius-xl`   | 28  | Grands blocs          | Tuiles, cartes client                                |
| `radius/full` | `--radius-full` | 999 | Pilules               | Badges, avatars, capsule client                      |

Rayons hors tokens : jauge 2,5 ; onglet actif de carte KPI 2.

## 5. Ombres et effets

| Figma          | CSS              | Valeur                                               |
| -------------- | ---------------- | ---------------------------------------------------- |
| `Shadow/Soft`  | `--shadow-soft`  | `0 14px 34px -22px rgba(20,24,48,.28)` (`#14183047`) |
| `Shadow/Float` | `--shadow-float` | `0 24px 50px -18px rgba(20,24,48,.55)` (`#1418308C`) |

- Tuile et carte agence : `Shadow/Soft`, sans bordure. Carte client : bordure 1 px `--border-on-light`, sans ombre.
- Tuile en mode édition : bordure 2 px `--accent` (`67:1220`).
- Voile de fenêtre : `--muted-on-dark` (blanc 62 %) sur écran flouté de 6 px d'après la note M3 (`141:6794`).
- Voile de menu profil : `--near-black` à 25 % d'opacité (`88:2783`). Il diffère du voile de fenêtre, et il est lui-même cliquable.
- Champ avec focus : bordure 1,5 px `--text` (`141:7383`).

## 6. Bouton (`7:117`)

Socle `--btn-edge`, `padding-bottom 3 px`, rayon 12. Face : bordure 1,5 px `--btn-edge`, `padding 13px 26px`, rayon 12, Outfit 700 15, interligne 1,25. Hauteur totale 54.

| Variante | Face       | Texte        | États Figma                                  |
| -------- | ---------- | ------------ | -------------------------------------------- |
| Default  | `--paper`  | `--btn-edge` | Rest `7:81`, Hover `7:85`, Pressed `7:89`    |
| Accent   | `--accent` | `--paper`    | Rest `7:93`, Hover `7:97`, Pressed `7:101`   |
| On dark  | non relevé | non relevé   | Rest `7:105`, Hover `7:109`, Pressed `7:113` |

La face se lève de 0,22 em, monte à 0,38 em au survol et descend à 0,04 em au clic. Le composant décrit aussi un « burst » hérité du site.

## 7. Mouvement (`7:35`)

| Token             | Valeur                           | Usage                               |
| ----------------- | -------------------------------- | ----------------------------------- |
| `--ease-out`      | `cubic-bezier(0.22, 1, 0.36, 1)` | Entrées                             |
| `--ease-in-out`   | `cubic-bezier(0.65, 0, 0.35, 1)` | Aller-retours                       |
| `--ease-emphasis` | `cubic-bezier(0.32, 0.72, 0, 1)` | Morphings d'interface               |
| `--ease-steady`   | `cubic-bezier(0.4, 0, 0.2, 1)`   | Progressions régulières             |
| `--dur-instant`   | 60 ms                            | Retour au clic                      |
| `--dur-fast`      | 180 ms                           | Survols                             |
| `--dur-base`      | 350 ms                           | Transitions d'état                  |
| `--dur-reveal`    | 750 ms                           | Révélations au scroll               |
| `--dur-slow`      | 900 ms                           | Remplissage de la capsule du header |

Les notes propres à Nuera OS fixent d'autres durées (voir `figma-map.md`) : réaction au plus 150 ms, alors que `--dur-fast` vaut 180 ms. Écart à trancher.

## 8. Logos

| Élément                                         | Node                               | Page          | Taille                                                                         |
| ----------------------------------------------- | ---------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| Logo Nuera OS · papier (sur sombre)             | `90:4084`                          | Nuera OS      | 168 × 27,6                                                                     |
| Logo Nuera OS · encre (sur clair), composant    | `90:4098`                          | Nuera OS      | 168 × 27,6                                                                     |
| Logo Nuera OS · encre, cadre libre hors section | `91:4092`                          | Nuera OS      | 168 × 27,6                                                                     |
| Logo Nuera · papier                             | `62:367`                           | Nuera OS      | 136 × 27,6                                                                     |
| Logo Nuera · encre                              | `68:1214`                          | Nuera OS      | 136 × 27,6                                                                     |
| Pastille « OS » papier / encre                  | `90:4096` / `91:4094`              | Nuera OS      | fond `--accent-on-dark` texte `--near-black` / fond `--accent` texte `--paper` |
| Logotypes du site (encre, papier, accent)       | `29:37`, `29:50`, `29:63`          | Design System | 298 × 60                                                                       |
| Monogramme N                                    | `29:66`                            | Design System | 120 × 106                                                                      |
| Icône du site 128 / 64 / 32 / 16                | `29:71`, `29:74`, `29:77`, `29:80` | Design System | n/a                                                                            |

Figma précise (`29:21`) : **« Le logo définitif n'est pas encore choisi : ces fichiers seront remplacés le jour venu. »** Prévoir un remplacement simple.

### Fichiers exportés dans `public/brand/`

| Fichier                            | Source    | Usage                                      |
| ---------------------------------- | --------- | ------------------------------------------ |
| `public/brand/nuera-os-papier.svg` | `90:4084` | Barre latérale, C1, C2, 15, capsule client |
| `public/brand/nuera-os-encre.svg`  | `91:4092` | C9                                         |
| `public/brand/nuera-papier.svg`    | `62:367`  | Logo seul sur sombre                       |
| `public/brand/nuera-encre.svg`     | `68:1214` | Logo seul sur clair                        |

Export SVG de Figma, retouché sur un seul point : l'export ajoutait un fond `#1E1E1E` et le fond de la section « Composants de l'app », retirés. Les tracés sont intacts et le « OS » est vectorisé (aucune police requise). Contrôle par rendu sur fond clair et sombre : conforme aux maquettes. Dimensions racine : 168 × 28 et 136 × 28.

Le N et le u se chevauchent via un masque (`mask-type: luminance`), avec identifiants `mask0_57_3` et `clip0_57_3` identiques dans les 4 fichiers. Pour éviter une collision, utiliser `<img>` ou renommer ces identifiants si les SVG sont insérés en ligne, plusieurs fois, dans une même page.

Icônes : 38 composants `icon/*` dans la section `57:13` (liste dans `figma-map.md`), non exportés ici.
