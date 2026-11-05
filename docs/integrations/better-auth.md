# better-auth

Points vérifiés sur la version installée.

- Le plugin admin expose `/api/auth/admin/*` en HTTP. Ces routes ne passent pas par les services : ni règle métier ni audit. Elles sont fermées par `disabledPaths` (`CLOSED_ADMIN_PATHS`, `src/server/auth/auth.ts`). L'API serveur (`auth.api.*`) reste disponible, car `disabledPaths` n'agit qu'à l'entrée HTTP.
- Contrôle d'une telle route sur la base partagée : corps vide, sans session, et lecture du code de réponse. Une charge réelle sur un serveur pas encore rechargé s'exécuterait.

## Règles voisines

- Lien interne : le contrôle refuse aussi `/\`, qu'un navigateur lit comme `//`, donc vers un autre domaine.
- Numéro de page lu dans l'URL : `z.coerce.number().int().min(1).catch(1)`. Une valeur illisible ouvre la première page, sans erreur.
- Tâche qui émet un e-mail client : vérifier SMTP d'abord. Sans ce contrôle, la clé de déduplication consomme la relance alors que rien n'est parti.
- Route avec `catch` qui passe par `getServiceContext` ou `requireInternalActor` : appeler `unstable_rethrow` en tête du `catch`, sinon la redirection d'enrôlement devient un 500.
