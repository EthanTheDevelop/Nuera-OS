import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

/** Points d'entrée HTTP de better-auth (`/api/auth/*`) : connexion, déconnexion, session. */
export const { GET, POST } = toNextJsHandler((request) => getAuth().handler(request));
