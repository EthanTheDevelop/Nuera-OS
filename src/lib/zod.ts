/**
 * Point d'entrée unique de Zod dans l'application.
 * Active la locale française pour les messages par défaut ; les schémas métier
 * définissent en plus des messages explicites sur les champs importants.
 */
import * as z from "zod";

z.config(z.locales.fr());

export { z };
