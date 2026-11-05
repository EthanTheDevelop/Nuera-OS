import "server-only";
import { getEnv } from "@/server/config/env";
import { SmtpClient, unconfiguredSmtpGateway, type SmtpGateway } from "./smtp.client";

export * from "./smtp.client";

let cached: SmtpGateway | undefined;

/** Passerelle de l'application. Sans hôte ni expéditeur, `isConfigured` vaut `false`. */
export function getSmtpGateway(): SmtpGateway {
  if (cached) return cached;
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = getEnv();
  cached =
    SMTP_HOST && SMTP_FROM
      ? new SmtpClient({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_SECURE,
          user: SMTP_USER,
          password: SMTP_PASSWORD,
          from: SMTP_FROM,
        })
      : unconfiguredSmtpGateway;
  return cached;
}
