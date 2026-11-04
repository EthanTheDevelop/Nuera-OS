# Lot Messages et rendez-vous

**Fait**

- `comment.service.ts` réel (mentions validées, notification via `notify`), consommé par Projets et Support.
- Boîte : conversations liées client/projet/contact, filtres, non-lus, recherche, pièce jointe via documents, mentions, relecture toutes les 15 s, archivage et rétablissement (filtre « Archivées »).
- Panneau droit via services (`getProjectDetail`, `getQuoteDetail` pour l'acompte, `getNextAppointment`).
- Suggestions (A9, A10) : adaptateur OpenAI, `reply_suggestions`, réglage associé dans `app_settings`, ConnectionRequired.
- Portail : `listPortalConversation`, `sendPortalMessage`, `markPortalRead`, `getPortalUnreadCount`, `listAppointmentsForPortal`.
- Pilotage : `getMessagesToHandle`, `getUnreadCount`, `listUpcomingAppointments`, `listConversationsForCompany`, `listAppointmentsForCompany`, `listAppointmentsForOpportunity`.
- Rendez-vous : `/messages/rendez-vous` (filtres `?affaire=` et `?client=`), création, édition, transitions, webhook Cal signé et idempotent.
- Tests : `tests/integration/messaging` (156), dont `audit-regressions.test.ts` et `mention-notify.test.ts`.

**Reste** : aucun développement. Non vérifié en navigateur : une génération OpenAI complète (le serveur partagé n'a pas de clé) et le webhook Cal réel ; tous deux sont couverts par les tests d'intégration.

**Décisions**

- Non-lus au niveau de l'équipe (`conversations.unread_internal`), pas par personne.
- `conversation-panel.ts` lit projets et contenus sans acteur : `prepareReplySuggestion` n'a pas de `ServiceContext`.
- Le champ de saisie est verrouillé pendant l'envoi : ce qui serait saisi serait effacé avec le texte parti.
- Périmètre prestataire des commentaires aligné sur `task.service` et `ticket.service` : être rattaché au projet n'ouvre que le projet et ses livrables.
- Une mention ne vise que qui peut lire l'objet : un prestataire n'est pas mentionnable dans un message.
- Formulaires sans `action` : React les réinitialiserait après une erreur (client et cases perdus).

**Demandes aux autres lots**

- Automatisations : `notify` est encore un squelette qui lève une erreur, aucune mention ne notifie personne. Appeler `prepareReplySuggestion` sur `message.received`.
- Coque : brancher `getUnreadCount` sur la pastille Messages de la barre latérale.
- Socle interface : `Modal` laisse remonter `cancel` dans l'arbre React (Échap ferme aussi le parent) ; contourné dans le fil.
- CRM, Administration : `/clients/[id]` et `/reglages/connexions` n'existent pas encore, nos liens y mènent.
