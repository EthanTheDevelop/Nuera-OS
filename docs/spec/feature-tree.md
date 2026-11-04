# Nuera OS — Feature Tree fonctionnel, niveau 3

Cahier des charges fonctionnel, version 1.0 du 03/11/2026, fourni par Nezar.
Mise en forme en tableaux ; le contenu est celui du document d'origine.
Maquettes : Figma « Nuera Design », pages « Nuera OS » et « Nuera OS · Prototype ».

> **Points en tension avec les décisions du projet** (voir `sources/decisions.md`) :
>
> - Module 12 « Sous-traitants » : décision du 21/10/2026 = **pas de sous-traitance**.
> - « Développement de sites e-commerce » dans les prestations : la grille de
>   `pricing.ts` n'a pas d'offre e-commerce et le site refuse les catalogues de
>   plusieurs milliers de produits.
> - Module 04 : « devis officiels » chez Indy, alors que le parcours prévoit un
>   devis à deux noms signé par DocuSeal. À trancher : qui produit le PDF du devis.

## 1. Contexte et objectif

Nuera Studio crée, développe, héberge et maintient des sites web (vitrines,
landing pages, e-commerce, solutions sur mesure, hébergement, maintenance,
accompagnement). **Nuera OS** est son logiciel interne : le centre de pilotage
opérationnel de l'agence.

Il doit répondre à huit questions :

1. Quels prospects dois-je contacter ou relancer ?
2. Quels projets sont en cours et où en sont-ils ?
3. Quels projets sont rentables ?
4. Quels sites clients sont hébergés et dans quel état ?
5. Quels contrats et abonnements dois-je renouveler ?
6. Quels clients nécessitent une intervention ?
7. Quelles tâches dois-je réaliser en priorité ?
8. Quelle est la situation globale de mon agence ?

Il centralise sans reproduire les outils spécialisés : **Coolify** (serveurs et
déploiements), **Indy** (devis officiels, facturation, comptabilité), **Payload
CMS** (contenu des sites qui en ont besoin), supervision, signature,
automatisation.

Niveaux : N1 module métier · N2 grande fonctionnalité · N3 fonctionnalité précise
(ce qu'elle fait, son utilité). 14 modules.

## 01 — Dashboard & pilotage

Le cockpit : actions urgentes, avancement, performance commerciale, situation
financière, problèmes techniques, échéances.

| N3                                | Ce qu'elle fait                                                               | Utilité                                                  |
| --------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| **01.01 Tableau de bord général** |                                                                               |                                                          |
| 01.01.01 Vue d'ensemble           | Clients actifs, prospects, projets en cours, contrats actifs, tickets ouverts | Comprendre la situation en quelques secondes             |
| 01.01.02 Actions prioritaires     | Relances, validations, tâches, interventions à venir                          | Savoir sur quoi travailler en priorité                   |
| 01.01.03 Alertes importantes      | Retards, incidents, impayés connus, échéances contractuelles                  | Détecter les problèmes avant qu'ils deviennent critiques |
| **01.02 Pilotage commercial**     |                                                                               |                                                          |
| 01.02.01 Pipeline global          | Opportunités par étape et montant prévisionnel                                | Mesurer les ventes potentielles                          |
| 01.02.02 Performance des ventes   | Gagnées, perdues, taux de conversion                                          | Comprendre l'efficacité commerciale                      |
| 01.02.03 Prévision du CA          | Revenus futurs, le certain distingué de l'hypothétique                        | Anticiper l'activité                                     |
| **01.03 Pilotage opérationnel**   |                                                                               |                                                          |
| 01.03.01 Avancement des projets   | Projets, étapes, prochaines échéances                                         | Repérer les projets à reprendre en main                  |
| 01.03.02 Projets à risque         | Retards, blocages, dépassements de charge                                     | Éviter problèmes de livraison et pertes                  |
| 01.03.03 Charge de travail        | Tâches et projets par période                                                 | Anticiper la surcharge                                   |
| **01.04 Reporting & performance** |                                                                               |                                                          |
| 01.04.01 Indicateurs financiers   | Facturé connu, récurrent, marges estimées                                     | Contrôler la performance économique                      |
| 01.04.02 Comparaison des périodes | Mois, trimestre, année                                                        | Vérifier la progression                                  |
| 01.04.03 Analyse par activité     | Vitrines, e-commerce, maintenance…                                            | Repérer les offres les plus rentables                    |

## 02 — CRM & relation client

Un dossier unique par client, avec tout son historique.

| N3                               | Ce qu'elle fait                                             | Utilité                                     |
| -------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| **02.01 Entreprises**            |                                                             |                                             |
| 02.01.01 Création                | Nom, coordonnées, site, activité, infos administratives     | Base client fiable                          |
| 02.01.02 Qualification           | Prospect, client actif, ancien client, partenaire           | Adapter les actions                         |
| 02.01.03 Fiche centralisée       | Contacts, opportunités, projets, contrats, sites, documents | Tout le contexte au même endroit            |
| **02.02 Contacts**               |                                                             |                                             |
| 02.02.01 Annuaire                | Personnes, coordonnées, fonctions                           | Trouver le bon interlocuteur                |
| 02.02.02 Rôles                   | Décideur, signataire, technique, facturation                | Adresser chaque demande à la bonne personne |
| 02.02.03 Historique relationnel  | Informations importantes des échanges                       | Relation personnalisée                      |
| **02.03 Interactions**           |                                                             |                                             |
| 02.03.01 Historique des échanges | Appels, réunions, notes, communications                     | Mémoire de la relation                      |
| 02.03.02 Notes commerciales      | Besoins, objections, préférences                            | Préparer les échanges                       |
| 02.03.03 Prochaines actions      | Action, date, responsable                                   | Éviter les oublis                           |
| **02.04 Qualité des données**    |                                                             |                                             |
| 02.04.01 Doublons                | Détection des fiches en double                              | Pas de dossiers dispersés                   |
| 02.04.02 Fusion                  | Regroupe en gardant relations et historiques                | Information centralisée                     |
| 02.04.03 Archivage               | Archive sans perdre l'historique                            | CRM propre                                  |

## 03 — Prospection & ventes

De la première demande à la signature.

| N3                                | Ce qu'elle fait                                                            | Utilité                            |
| --------------------------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| **03.01 Prospects**               |                                                                            |                                    |
| 03.01.01 Enregistrement des leads | Site, recommandations, e-mails, contacts directs                           | Ne perdre aucune opportunité       |
| 03.01.02 Qualification            | Besoin, budget, délai, intérêt                                             | Repérer les vrais prospects        |
| 03.01.03 Origine                  | Canal d'acquisition                                                        | Savoir ce qui rapporte des clients |
| **03.02 Pipeline**                |                                                                            |                                    |
| 03.02.01 Étapes                   | Nouveau, qualification, découverte, proposition, négociation, gagné, perdu | Visualiser les ventes              |
| 03.02.02 Montant                  | Montant estimé par affaire                                                 | Potentiel financier                |
| 03.02.03 Probabilité et échéance  | Probabilité, date prévisionnelle                                           | Prévisions réalistes               |
| **03.03 Suivi**                   |                                                                            |                                    |
| 03.03.01 Relances                 | Rappels planifiés                                                          | Meilleures conversions             |
| 03.03.02 Rendez-vous              | Réunions liées à l'opportunité                                             | Garder le contexte                 |
| 03.03.03 Opportunités inactives   | Affaires sans activité depuis X jours                                      | Ne pas garder des affaires mortes  |
| **03.04 Conversion**              |                                                                            |                                    |
| 03.04.01 Conversion en client     | Statut mis à jour à la signature                                           | Continuité du suivi                |
| 03.04.02 Transformation en projet | Projet créé depuis l'opportunité                                           | Pas de ressaisie                   |
| 03.04.03 Ventes perdues           | Raisons des refus                                                          | Améliorer prix et offres           |

## 04 — Offres, devis & signatures

Maîtriser le périmètre vendu et son passage en production, sans remplacer Indy.

| N3                                | Ce qu'elle fait                                      | Utilité                            |
| --------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| **04.01 Catalogue**               |                                                      |                                    |
| 04.01.01 Prestations types        | Vitrines, landing pages, e-commerce, sur mesure      | Offres plus rapides                |
| 04.01.02 Services récurrents      | Hébergement, maintenance, accompagnement             | Proposer l'après-livraison         |
| 04.01.03 Options                  | Options liées aux prestations                        | Personnaliser, augmenter la valeur |
| **04.02 Construction**            |                                                      |                                    |
| 04.02.01 Chiffrage                | Montants, prestations, quantités                     | Cadrer le projet                   |
| 04.02.02 Rentabilité estimée      | Prix comparé au temps et aux coûts                   | Ne pas signer à perte              |
| 04.02.03 Périmètre                | Livrables, fonctionnalités, exclusions, conditions   | Éviter les malentendus             |
| **04.03 Validation**              |                                                      |                                    |
| 04.03.01 Suivi des propositions   | Préparation, envoyée, négociation, acceptée, refusée | Suivre chaque offre                |
| 04.03.02 Signature                | Documents signés liés à l'opportunité                | Accord vérifiable                  |
| 04.03.03 Conditions de démarrage  | Accord, acompte, disponibilité                       | Ne pas démarrer trop tôt           |
| **04.04 Évolutions**              |                                                      |                                    |
| 04.04.01 Versions                 | Versions successives d'une offre                     | Savoir laquelle est acceptée       |
| 04.04.02 Demandes supplémentaires | Hors périmètre initial                               | Pas de travail gratuit             |
| 04.04.03 Avenants                 | Prix, délai, périmètre modifiés                      | Protéger la rentabilité            |

## 05 — Projets & production

| N3                            | Ce qu'elle fait                                               | Utilité                  |
| ----------------------------- | ------------------------------------------------------------- | ------------------------ |
| **05.01 Projets**             |                                                               |                          |
| 05.01.01 Création             | Projet lié à l'entreprise et à l'offre acceptée               | Lien vente-production    |
| 05.01.02 Fiche projet         | Objectifs, budget, délais, intervenants, livrables, documents | Espace de travail unique |
| 05.01.03 Statuts              | Préparation, en cours, bloqué, en validation, livré, clôturé  | État du portefeuille     |
| **05.02 Planification**       |                                                               |                          |
| 05.02.01 Jalons               | Cadrage, design, développement, recette, mise en ligne        | Structurer la production |
| 05.02.02 Échéances            | Dates des étapes et livrables                                 | Tenir les délais         |
| 05.02.03 Dépendances          | Tâches dépendant d'autres tâches ou validations               | Comprendre les blocages  |
| **05.03 Tâches**              |                                                               |                          |
| 05.03.01 Création             | Actions concrètes                                             | Travail mesurable        |
| 05.03.02 Attribution          | Un responsable par tâche                                      | Responsabilités claires  |
| 05.03.03 Avancement           | Statut, échéance, progression                                 | Voir le reste à faire    |
| **05.04 Suivi de production** |                                                               |                          |
| 05.04.01 Avancement global    | Fait et reste à faire                                         | État réel                |
| 05.04.02 Blocages             | Problèmes, conséquences, décisions                            | Pas de retard silencieux |
| 05.04.03 Prévu / réalisé      | Planning et charge comparés au réel                           | Détecter les dérives     |
| **05.05 Livraison**           |                                                               |                          |
| 05.05.01 Recette              | Vérification des livrables                                    | Qualité                  |
| 05.05.02 Validation client    | Retours et décisions conservés                                | Pas de contestation      |
| 05.05.03 Clôture et passation | Mise en ligne, accès, documents, contrat de maintenance       | Finir proprement         |

## 06 — Temps & capacité

| N3                                   | Ce qu'elle fait                                              | Utilité                 |
| ------------------------------------ | ------------------------------------------------------------ | ----------------------- |
| 06.01.01 Saisie du temps             | Temps par projet et tâche                                    | Coût réel               |
| 06.01.02 Catégories                  | Production, corrections, support, prospection, administratif | Ce qui consomme le plus |
| 06.01.03 Historique                  | Durées des interventions                                     | Meilleures estimations  |
| 06.02.01 Estimation par tâche        | Temps prévu                                                  | Charge d'un projet      |
| 06.02.02 Planning de capacité        | Prévu comparé à la disponibilité                             | Éviter la surcharge     |
| 06.02.03 Simulation                  | Impact d'un nouveau contrat sur le planning                  | Délais réalistes        |
| 06.03.01 Prévu / réel                | Estimations comparées au consommé                            | Erreurs de chiffrage    |
| 06.03.02 Dépassements                | Projets ou tâches hors enveloppe                             | Protéger les marges     |
| 06.03.03 Productivité par prestation | Durées réelles par type de projet                            | Organisation et tarifs  |

## 07 — Sites & infrastructure

S'interface avec Coolify, sans le remplacer.

| N3                                 | Ce qu'elle fait                                          | Utilité                        |
| ---------------------------------- | -------------------------------------------------------- | ------------------------------ |
| 07.01.01 Fiche site                | Nom, URL, client, projet, type                           | Inventaire                     |
| 07.01.02 Environnements            | Production, staging, développement                       | Pas de confusion               |
| 07.01.03 Relations techniques      | Domaine, hébergement, dépôt, CMS                         | Dépendances d'un site          |
| 07.02.01 Ressources Coolify        | Site lié au projet, à l'app et à l'environnement Coolify | Correspondance fiable          |
| 07.02.02 Statuts des apps          | Opérationnel, arrêté, erreur, indisponible               | Surveiller sans ouvrir Coolify |
| 07.02.03 Déploiements              | Derniers déploiements                                    | Repérer un échec               |
| 07.02.04 Accès direct              | Ouvre la ressource dans Coolify                          | Accès immédiat                 |
| 07.03.01 Déclencher un déploiement | Par les fonctions officielles, personnes autorisées      | Opérations courantes           |
| 07.03.02 Suivi                     | Résultat et évolution                                    | Mise en production vérifiée    |
| 07.03.03 Historique                | Opérations et résultats                                  | Origine d'un incident          |
| 07.04.01 Domaines                  | Domaine, client, registrar                               | Ne rien perdre                 |
| 07.04.02 Renouvellements           | Dates d'expiration                                       | Pas de domaine expiré          |
| 07.04.03 HTTPS                     | Problèmes de certificats                                 | Anticiper                      |
| 07.05.01 Disponibilité             | Supervision                                              | Détecter les pannes            |
| 07.05.02 Sauvegardes               | Dernières sauvegardes et réussite                        | Données protégées              |
| 07.05.03 Restauration              | Procédures                                               | Intervenir vite                |
| 07.05.04 Incidents                 | Liés au site                                             | Repérer les apps fragiles      |

## 08 — Contrats, maintenance & abonnements

| N3                                 | Ce qu'elle fait                                   | Utilité                           |
| ---------------------------------- | ------------------------------------------------- | --------------------------------- |
| 08.01.01 Dossier contractuel       | Contrat lié au client, aux prestations, aux sites | Retrouver les engagements         |
| 08.01.02 Périmètre                 | Inclus, exclusions, conditions                    | Pas d'intervention gratuite       |
| 08.01.03 Documents                 | Contrats et versions acceptées                    | Sécurité                          |
| 08.02.01 Abonnements               | Prix, périodicité, début, état                    | Revenus récurrents                |
| 08.02.02 Échéances                 | Prochaines échéances                              | Anticiper                         |
| 08.02.03 Historique                | Changements de prix et de contrat                 | Évolution                         |
| 08.03.01 Planification             | Opérations prévues au contrat                     | Service régulier                  |
| 08.03.02 Journal                   | Interventions et résultats                        | Preuve du travail                 |
| 08.03.03 Forfaits                  | Heures ou interventions consommées                | Rentabilité de la maintenance     |
| 08.04.01 Alertes de renouvellement | Avant les dates importantes                       | Rien de manqué                    |
| 08.04.02 Révision des tarifs       | Contrats à réévaluer                              | Marges                            |
| 08.04.03 Résiliation               | Fin, services à arrêter, transferts               | Pas de coûts pour un client parti |

## 09 — Support & incidents

| N3                                    | Ce qu'elle fait                                     | Utilité                   |
| ------------------------------------- | --------------------------------------------------- | ------------------------- |
| 09.01.01 Tickets                      | Demande liée au client et au site                   | Centraliser               |
| 09.01.02 Catégories                   | Incident, anomalie, assistance, question, évolution | Traitement adapté         |
| 09.01.03 Pièces jointes               | Captures, documents                                 | Diagnostic                |
| 09.02.01 Gravité                      | Impact sur le service                               | Prioriser                 |
| 09.02.02 Attribution                  | Un responsable                                      | Suivi garanti             |
| 09.02.03 Délais                       | Échéances convenues                                 | Engagements tenus         |
| 09.03.01 Statuts                      | Nouveau, en cours, en attente, résolu, fermé        | Avancement                |
| 09.03.02 Historique                   | Diagnostic, actions, résultats                      | Reprise, analyse          |
| 09.03.03 Validation                   | Vérifications avant clôture                         | Pas de fermeture trop tôt |
| 09.04.01 Vérification du contrat      | Inclus ou non dans la maintenance                   | Inclus / facturable       |
| 09.04.02 Transformation en prestation | Opportunité ou devis hors périmètre                 | Pas de travail gratuit    |
| 09.04.03 Analyse                      | Clients et sites les plus demandeurs                | Ajuster les contrats      |

## 10 — Finances & rentabilité

Ne remplace pas Indy pour la facturation légale et la comptabilité.

| N3                               | Ce qu'elle fait                                   | Utilité                  |
| -------------------------------- | ------------------------------------------------- | ------------------------ |
| 10.01.01 Références des factures | Factures officielles liées aux clients et projets | Retrouver vite           |
| 10.01.02 États                   | Paiements connus et fiables                       | Reste à encaisser        |
| 10.01.03 Échéanciers             | Acomptes et paiements prévus                      | Entrées d'argent         |
| 10.02.01 Coût du travail         | Coût interne par le temps                         | Coût réel                |
| 10.02.02 Dépenses externes       | Achats et sous-traitance par projet               | Marges justes            |
| 10.02.03 Coûts récurrents        | Hébergement et services par contrat               | Abonnements déficitaires |
| 10.03.01 Marge prévisionnelle    | Prix contre coûts estimés                         | Décider                  |
| 10.03.02 Marge réelle            | Revenu contre coûts constatés                     | Bénéfice réel            |
| 10.03.03 Rentabilité client      | Projets et contrats d'un client                   | Comptes rentables        |
| 10.04.01 Revenus récurrents      | Montants des contrats actifs                      | Stabilité                |
| 10.04.02 Revenus futurs          | Certain distingué du prévisionnel                 | Périodes creuses         |
| 10.04.03 Retards de paiement     | Factures en retard                                | Relances                 |

## 11 — Portail client

| N3                                | Ce qu'elle fait                          | Utilité                               |
| --------------------------------- | ---------------------------------------- | ------------------------------------- |
| 11.01.01 Accès sécurisé           | Interlocuteurs autorisés de l'entreprise | Pas d'exposition des données internes |
| 11.01.02 Vue des services         | Projets, sites, contrats                 | Vision claire                         |
| 11.01.03 Contacts                 | Interlocuteurs Nuera                     | Relation simple                       |
| 11.02.01 Avancement               | Grandes étapes                           | Moins de demandes de suivi            |
| 11.02.02 Documents à fournir      | Contenus attendus                        | Moins de retards                      |
| 11.02.03 Validation des livrables | Validation ou retour sur une version     | Production plus rapide                |
| 11.03.01 Demandes                 | Ouvrir un ticket                         | Processus structuré                   |
| 11.03.02 Suivi                    | État et réponses                         | Transparence                          |
| 11.03.03 Historique               | Demandes précédentes                     | Ne pas répéter                        |
| 11.04.01 Documents partagés       | Documents autorisés                      | Livrables                             |
| 11.04.02 Contrats souscrits       | Prestations actives et périmètre         | Clarté                                |
| 11.04.03 Documents financiers     | Factures mises à disposition             | Démarches simples                     |

## 12 — Équipe & sous-traitants

| N3                                 | Ce qu'elle fait                         | Utilité                   |
| ---------------------------------- | --------------------------------------- | ------------------------- |
| 12.01.01 Fiches collaborateurs     | Infos professionnelles, responsabilités | Qui mobiliser             |
| 12.01.02 Compétences               | Compétences par intervenant             | Bonne attribution         |
| 12.01.03 Disponibilités            | Capacités                               | Anticiper                 |
| 12.02.01 Annuaire des prestataires | Prestataires et spécialités             | Trouver le bon partenaire |
| 12.02.02 Conditions                | Tarifs, conditions                      | Coût juste                |
| 12.02.03 Historique                | Missions et livrables                   | Choisir sur résultats     |
| 12.03.01 Affectation               | Mission, projet, intervenant            | Responsabilités           |
| 12.03.02 Livrables                 | Attendus et reçus                       | Qualité                   |
| 12.03.03 Coûts                     | Prévu contre engagé                     | Marge                     |

## 13 — Documents & connaissances

| N3                                | Ce qu'elle fait                                | Utilité                   |
| --------------------------------- | ---------------------------------------------- | ------------------------- |
| 13.01.01 Documents clients        | Liés aux entreprises                           | Pas de fichiers dispersés |
| 13.01.02 Documents projets        | Briefs, spécifications, validations, livrables | Contexte                  |
| 13.01.03 Recherche contextuelle   | Depuis client, projet, contrat                 | Accès rapide              |
| 13.02.01 Modèles de briefs        | Structures par prestation                      | Cadrage                   |
| 13.02.02 Checklists               | Production, recette, livraison                 | Moins d'oublis            |
| 13.02.03 Modèles de communication | Messages récurrents                            | Gain de temps             |
| 13.03.01 Documentation interne    | Procédures                                     | Méthodes standard         |
| 13.03.02 Documentation technique  | Procédures sites et services                   | Interventions futures     |
| 13.03.03 Problèmes fréquents      | Résolutions                                    | Diagnostic plus court     |
| 13.04.01 Versions                 | Version de référence                           | Pas de contradiction      |
| 13.04.02 Historique               | Modifications                                  | Traçabilité               |
| 13.04.03 Permissions              | Interne ou partageable                         | Protection                |

## 14 — Automatisations & administration

| N3                                  | Ce qu'elle fait                         | Utilité                      |
| ----------------------------------- | --------------------------------------- | ---------------------------- |
| 14.01.01 Relances automatiques      | Rappels prospects                       | Pas d'oubli                  |
| 14.01.02 Conversion après signature | Dossier de production préparé           | Vente → projet fluide        |
| 14.01.03 Notifications commerciales | Décisions en attente                    | Réactivité                   |
| 14.02.01 Tâches initiales           | Tâches et jalons types par prestation   | Démarrage standard           |
| 14.02.02 Alertes de retard          | Échéances dépassées                     | Délais                       |
| 14.02.03 Relances de validation     | Validation client en retard             | Moins de blocages            |
| 14.03.01 Alertes de disponibilité   | Incidents de supervision                | Pannes traitées vite         |
| 14.03.02 Suivi des déploiements     | Résultats Coolify                       | État centralisé              |
| 14.03.03 Alertes de sauvegarde      | Échecs ou absences                      | Moins de risque              |
| 14.04.01 Rappels contractuels       | Avant échéances                         | Renouvellements              |
| 14.04.02 Suivi des factures         | Références et états rapprochés          | Pas de double saisie         |
| 14.04.03 Notifications internes     | Événements à traiter                    | Moins d'oublis               |
| 14.05.01 Catalogue                  | Scénarios actifs, déclencheur, objectif | Savoir ce qui est automatisé |
| 14.05.02 Historique d'exécution     | Succès et échecs                        | Comprendre les pannes        |
| 14.05.03 Gestion des erreurs        | Relance sans doublon                    | Fiabilité                    |
| 14.05.04 Activation / suspension    | Désactiver un scénario                  | Garder le contrôle           |
| 14.06.01 Utilisateurs               | Comptes internes                        | Accès                        |
| 14.06.02 Rôles et permissions       | Actions et infos par rôle               | Pas d'accès indu             |
| 14.06.03 Journal sensible           | Auteur et date des opérations           | Traçabilité                  |
| 14.06.04 Connexions externes        | État des intégrations                   | Sécurité des échanges        |
| 14.06.05 Export                     | Récupérer les données                   | Réversibilité                |

## Principes

1. **Une information, un dossier de référence** : opportunités, projets, sites,
   contrats et factures reliés à l'entreprise, sans doublon.
2. **Pilotage centralisé, outils spécialisés** : factures chez Indy, opérations
   techniques chez Coolify, contenu dans le CMS, signature et supervision par
   des outils dédiés.
3. **Des fonctionnalités utiles** : chacune sert à décider, agir, contrôler,
   anticiper ou transmettre ; sinon elle n'est pas développée.
4. **Évolutive** : plus de clients, de sites, de collaborateurs, de contrats,
   sans perdre la simplicité au début.

**La réussite de Nuera OS se mesure à sa capacité à rendre l'agence plus
organisée, plus rentable et plus facile à piloter, pas au nombre de
fonctionnalités.**
