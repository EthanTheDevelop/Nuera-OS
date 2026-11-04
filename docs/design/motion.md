# Nuera OS — le mouvement de l'interface

Étude du 03/11/2026, tirée de trois vidéos de référence envoyées par Nezar
(TikTok @uxerflow, maquettes de dashboards « Autumn », « Pivora » et une app
de gestion de projet). **Elles servent d'inspiration pour le mouvement, pas de
modèle à copier** : on reprend les principes, avec le design system de Nuera
OS (Figma « Nuera Design »), jamais leurs écrans, leurs noms ni leur charte.

Analyse faite image par image (1 à 4 images par seconde) : les durées
ci-dessous sont **mesurées à ± 100 ms**, et les courbes d'accélération sont
**déduites**, à régler à l'œil sur le vrai écran.

> Les zooms de caméra et les fondus d'une vidéo à l'autre sont du montage,
> pas de l'interface. Ils ne se reproduisent pas.

---

## 1. Le principe en une phrase

**Rien n'apparaît d'un coup, et rien ne bouge sans raison.** La page se
construit du cadre vers les données ; les données « poussent » depuis leur
point zéro (barres depuis la ligne de base, courbes de gauche à droite,
chiffres depuis 0) ; chaque clic produit une réponse visible sur l'élément
cliqué, en moins de 300 ms, puis le contenu suit.

Trois couches, toujours dans cet ordre :

1. **le cadre** : barre latérale, en-tête, contours des cartes ;
2. **le contenu fixe** : titres de cartes, libellés, axes ;
3. **la donnée** : chiffres, barres, courbes, avatars, badges.

---

## 2. Les sept effets

### 2.1 Arrivée sur une page : construction en cascade

Vue dans les trois vidéos.

| Temps            | Ce qui se passe                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0 → 250 ms       | L'ancienne page **floute et s'efface** (flou 0 → ~8 px, opacité 1 → 0). Fond neutre un instant                                       |
| 250 → 600 ms     | **Barre latérale** et **en-tête** apparaissent (fondu + léger glissement de 4–8 px) ; les entrées de menu en cascade, ~30 ms d'écart |
| 600 → 1 200 ms   | **Cartes en squelette** : contours et titres seulement, de haut en bas et de gauche à droite, ~60 ms d'écart par carte               |
| 1 000 → 2 000 ms | **Données** : chiffres qui comptent, barres qui montent, courbes qui se tracent (§ 2.2–2.4)                                          |
| ~2 000 ms        | Tout est en place. Plus rien ne bouge tant qu'on ne touche à rien                                                                    |

Chaque bloc entre par **opacité 0 → 1, flou 6 px → 0 et translation Y 6 px
→ 0**, en ~350 ms. Le flou qui se dissipe est la signature des trois vidéos :
c'est lui qui donne l'impression de « mise au point » plutôt que de
« clignotement ».

### 2.2 Chiffres qui comptent

Vu dans « Pivora » (`12g → 129`, `$1.4 → $1.4K`).

- Les KPI partent de 0 et montent jusqu'à leur valeur en **~600–800 ms**,
  avec une décélération forte à la fin.
- Chaque chiffre **roule** à sa place (comme un compteur mécanique), au lieu
  que tout le nombre change en bloc. Les unités (`K`, `%`, `€`) arrivent à la
  fin.
- Le badge d'évolution (`↑ 2 %`, `↓ 4 %`) apparaît **après** le chiffre, en
  fondu.
- Dans une info-bulle qui suit la souris, le nombre **roule d'une valeur à
  l'autre** au lieu d'être remplacé (`18 202 → 14 678`).

### 2.3 Graphiques qui poussent

- **Barres** : elles montent depuis la ligne de base, **de gauche à droite,
  ~25 ms d'écart** par barre, ~500 ms chacune, légère décélération.
- **Matrice de points** (« Autumn », colonnes de petits carrés) : les
  colonnes se remplissent de bas en haut, en balayage de gauche à droite sur
  ~1,2 s. Les cases vides (gris clair) sont là dès le départ : seule la
  couleur arrive.
- **Courbes** : la ligne **se trace de gauche à droite** (~800 ms), puis
  l'aire dessous apparaît en fondu (dégradé de la couleur vers transparent).
  En escalier, la ligne arrive d'abord en pointillé, puis se pleinit.
- **Barres de progression et jauges** (fenêtre « System health ») : elles se
  remplissent de gauche à droite en ~600 ms. Les barres hachurées (petits
  segments verticaux) se remplissent segment par segment, en balayage.
- **Barre segmentée** (78 % : rouge / jaune / vert) : chaque segment s'étire
  l'un après l'autre.

### 2.4 Changer de mesure : le graphique se transforme

Vu dans « Autumn » : sous le graphique, quatre onglets KPI (`320`, `97,6 %`,
`2,4 %`, `18,4`). Un clic sur un onglet :

1. le **trait noir sous l'onglet actif glisse** vers le nouvel onglet
   (~250 ms) ; l'icône de l'onglet passe en noir ;
2. l'ancien graphique **s'efface vers le bas** (~200 ms) ;
3. le nouveau **se dessine** selon son type : matrice de points → courbe
   avec aire → escalier en pointillé puis plein. **Chaque mesure a son type de
   graphique**, et l'animation d'entrée suit ce type (§ 2.3) ;
4. l'axe des Y change d'échelle en fondu.

Le cadre de la carte ne bouge pas : seul le contenu change.

### 2.5 Survol d'un graphique : l'info-bulle qui suit

Vu dans les trois vidéos.

- Une **ligne verticale** (pointillée chez « Pivora », pleine chez
  « Autumn ») suit la souris et **s'aimante** au point de donnée le plus
  proche.
- La barre survolée prend la couleur pleine (dégradé violet chez « Pivora »),
  **les autres pâlissent**.
- Un point marque la valeur sur la courbe.
- L'info-bulle (période, valeur, évolution) **glisse** d'un point à l'autre
  au lieu de disparaître et réapparaître. Son contenu passe de l'ancienne à la
  nouvelle valeur par un court flou croisé (~150 ms), et le nombre roule
  (§ 2.2).
- Le libellé du mois survolé sur l'axe X passe en gras, ou dans une pastille.

### 2.6 Ouvrir un détail : la fenêtre qui se déplie

Vu dans « Autumn » (bouton « Details » de « System health ») et dans l'app
projet (clic sur une tâche).

| Temps          | Ce qui se passe                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0 ms           | Clic : le bouton réagit (assombri, enfoncé)                                                                            |
| 0 → 300 ms     | Le fond **floute et s'assombrit** (flou d'arrière-plan ~6–10 px, voile clair ou chaud, pas noir)                       |
| 100 → 400 ms   | La fenêtre **s'ouvre** : un rectangle vide part à ~90 % de sa taille et monte à 100 % ; fondu, légère montée           |
| 300 → 700 ms   | Le contenu arrive **en cascade**, rangée par rangée (~60 ms d'écart), avec le même « flou qui se dissipe » qu'au § 2.1 |
| 500 → 1 300 ms | Les jauges de la fenêtre se remplissent (§ 2.3), l'une après l'autre                                                   |

Fermeture : l'inverse, en deux fois plus court (~200 ms), sans cascade.

### 2.7 Commenter et mentionner

Vu dans l'app projet (onglet « Comment » d'une tâche).

- Champ « Ajouter un commentaire » : au focus, le **contour passe en foncé**
  et le texte d'aide disparaît (~150 ms).
- Taper `@` ouvre la liste des membres ; une fois choisi, le nom devient une
  **mention en couleur** (`@kiaralaras`, en bleu) dans le champ.
- Enregistrer : le nouveau commentaire **apparaît en bas du fil** (fondu +
  glissement de 8 px), avec « maintenant » comme date ; le champ se vide.
- Pièces jointes dans le fil : une carte compacte, avec l'icône du type de
  fichier, le nom et la taille.

---

## 3. Les règles communes (le « réglage » des trois vidéos)

| Réglage                             | Valeur                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------- |
| Réaction à un clic ou un survol     | **≤ 150 ms**                                                                |
| Transition d'un élément             | **200–400 ms**                                                              |
| Graphique ou compteur               | **500–800 ms**                                                              |
| Construction complète d'une page    | **≤ 2 s**                                                                   |
| Cascade (écart entre deux éléments) | 25 ms (barres), 30 ms (menu), 60 ms (cartes, rangées)                       |
| Courbe d'entrée                     | décélération forte, de type `cubic-bezier(0.22, 1, 0.36, 1)`                |
| Courbe de sortie                    | accélération, de type `cubic-bezier(0.4, 0, 1, 1)`, en deux fois plus court |
| Entrée type                         | opacité 0 → 1 · flou 6 px → 0 · translation Y 6 px → 0                      |
| Fond derrière une fenêtre           | flou d'arrière-plan + voile clair, jamais un noir à 50 %                    |
| Ressort                             | aucun rebond visible : on règle les ressorts très amortis                   |

**Ce qui ne bouge jamais** : le texte qu'on est en train de lire, la barre
latérale une fois arrivée, la position de la souris (aucun élément ne fuit
sous le curseur), et une page déjà chargée qu'on revisite dans la session
(on ne rejoue pas la cascade : seules les données changées s'animent).

**Accessibilité** : avec `prefers-reduced-motion`, tout passe en fondu court
(~150 ms) : pas de flou, de translation, de compteur qui roule ni de tracé
progressif. C'est obligatoire, pas une option : c'est la promesse « UX et
accessibilité » de Nuera Studio.

**Performance** : n'animer que `opacity`, `transform` et `filter`, jamais
`width`, `height` ou `top`. Les barres montent par `scaleY` depuis leur base,
et les jauges se remplissent par `scaleX`. Le flou coûte cher : on le limite
aux entrées et à l'arrière-plan des fenêtres, jamais à un défilement.

---

## 4. Où ça va dans Nuera OS

| Écran (Figma « Nuera OS »)     | Effets                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 01 Tableau de bord (tuiles)    | 2.1 à l'arrivée, 2.2 sur les KPI, 2.3 dans les tuiles, 2.6 quand une tuile s'agrandit                                     |
| 16 Reporting                   | **2.4 en entier** : onglets KPI sous le graphique principal, un type de graphique par mesure ; 2.5 au survol              |
| 21 Finances                    | 2.2 (CA, trésorerie, MRR), 2.3 (barres mensuelles), 2.5 (info-bulle avec la part de chaque associé)                       |
| 18 Temps et capacité           | 2.3 sur les jauges de charge ; frise du jour avec un trait « maintenant », comme l'« activity map » de la troisième vidéo |
| 19 Site (Coolify)              | 2.6 : « Détails » ouvre la santé du site (disponibilité, temps de réponse, erreurs) en jauges hachurées                   |
| 11 Support, 17 Projet          | 2.6 (fiche de la demande ou de la tâche en fenêtre), 2.7 (fil de commentaires, mentions `@Ethan` / `@Nezar`)              |
| 02 Messages                    | 2.7 (envoi, mention), arrivée d'un message en fondu et glissement                                                         |
| Portail client (C3 mon projet) | 2.1 et 2.3 seulement, plus sobres : la progression en 4 étapes qui se remplit. Pas de compteur qui roule côté client      |

---

## 5. Comment le construire (pour Ethan)

Dans le Next.js de Nuera OS, sans rien de payant :

- **Motion** (ex-Framer Motion, MIT) pour tout le reste :
  - cascades : `variants` avec `staggerChildren` ;
  - entrée floue : `initial={{opacity:0, filter:'blur(6px)', y:6}}` ;
  - fenêtres : `AnimatePresence` ;
  - trait sous l'onglet actif : `layoutId`, qui le fait glisser tout seul ;
  - tracé de courbe : `pathLength` 0 → 1 sur le `<path>` SVG.
- **NumberFlow** (`@number-flow/react`, MIT) pour les chiffres qui roulent
  (§ 2.2), formats `fr-FR` et `€` compris.
- **Graphiques** : SVG maison ou **visx** (MIT), animés par Motion. Recharts
  anime aussi, mais moins finement (pas de cascade par barre).
- Un fichier de **jetons de mouvement** (durées, courbes, écarts de
  cascade), comme les jetons de couleur : aucune durée écrite en dur dans un
  composant.

Dans Figma (maquettes) : le prototype peut montrer 2.4, 2.5 et 2.6 en
**Smart Animate** entre deux variantes. Les cascades et les compteurs ne se
prototypent pas : ils se décrivent (ce fichier) et se règlent en code.

---

## 6. À décider

- Le flou d'entrée sur **toutes** les pages, ou seulement à la première
  ouverture de la session ? (Recommandation : la première fois seulement, sinon
  l'outil paraît lent au dixième passage.)
- Le côté client garde-t-il le même mouvement, ou une version plus sobre ?
  (Recommandation : plus sobre, cf. § 4.)
