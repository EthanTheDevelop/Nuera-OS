# Lot Contrats et abonnements

## Fait

- Services, repository, actions, règles, machine d'états : `src/modules/contracts/*`.
- Écrans : `/contrats` (20, groupe `(liste)`), `/contrats/[id]` (fiche), `/contrats/formules`, chargements, introuvable.
- Fiche : forfait de la période, couverture par catégorie, demandes du contrat, périmètre, journal, historique, abonnement, devis d'origine, renouvellement, tarif, suspension, résiliation (services à arrêter, domaines, transferts), sites, signature, documents, marge.
- Tests : `tests/integration/contracts/` (règles, service, signature contre un faux DocuSeal, `contract.audit.test.ts`).
- Audit : parcours complet au navigateur à 1440 et 390 px, cinq rôles, thème sombre, mouvement réduit ; courses vérifiées sur le vrai PostgreSQL.

## Décisions

- 404 réel : `[id]/layout.tsx` vérifie le contrat au-dessus de `loading.tsx`.
- `useModalForm` notifie depuis l'action : une transition peut retirer le bouton du formulaire dans le même rendu.
- SQL brut : colonnes qualifiées en toutes lettres dans une sélection sans jointure, Drizzle y retire le nom de table.
- Signature : DocuSeal si configuré, sinon saisie manuelle. Retour par « Vérifier la signature ».
- Filtres et sélecteur de type ajoutés au-dessus du tableau, non dessinés : nécessaires à plusieurs centaines de lignes.
- Rattachement d'un site : `contract_sites` ou `sites.contract_id`, lus ensemble partout. Le second se retire depuis la fiche du site.
- Rejeu : une intervention identique renvoie la ligne existante. Hors forfait : une seule transaction, sous le verrou du contrat.
- Renouvellement jamais après la fin. Réalisation jamais avant le début.

## Reste

- « bilan 6 mois » de la maquette : aucun champ en base, non affiché.
- Envoi DocuSeal réel non exercé au navigateur (non configuré en local), testé contre le faux.
- Liste de résiliation : un site couvert aussi par un autre contrat en cours y figure sans mention.

## Demandes aux autres lots

- Automatisations : planifier `runContractDeadlines(db)` chaque jour ; surveiller `failed` dans son résultat.
- Sites : appeler `activateContractsForSite(tx, { siteId, actorId })` à la mise en ligne.
- Devis : le webhook DocuSeal ignore les demandes `contract:<id>`. Lien possible vers `/contrats?nouveau=1&client=<id>&devis=<id>`.
- Portail : `listContractsForPortal(ctx)`. Pilotage : `getRecurringRevenue`, `getContractsSummary`. Client 360° : `listContractsForCompany`. Site : `listContractsForSite`.
- Socle : `tests/integration/contract-stubs.test.ts` attend encore des squelettes qui lèvent.
