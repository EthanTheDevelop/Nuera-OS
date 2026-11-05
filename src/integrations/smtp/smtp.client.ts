import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { ServiceUnavailableError } from "@/server/errors";

/**
 * Envoi SMTP (https://nodemailer.com/smtp). `secure: true` : TLS dès la connexion (port 465) ; sinon
 * STARTTLS exigé (`requireTLS`), pour qu'un lien de connexion ne parte jamais en clair.
 */
export const SMTP_SERVICE = "smtp" as const;

export interface SmtpConfig {
  host: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  from: string;
  /** Pour un serveur de test local sans TLS. Jamais renseigné depuis l'environnement. */
  allowPlaintext?: boolean;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text?: string | null;
  html?: string | null;
  replyTo?: string | null;
}

/** Port utilisé par les services : un serveur SMTP local le remplace dans les tests. */
export interface SmtpGateway {
  readonly isConfigured: boolean;
  send(mail: OutgoingEmail): Promise<{ messageId: string }>;
  /** Connexion et authentification, sans envoyer de message. */
  verify(): Promise<void>;
}

export function smtpNotConfigured(): ServiceUnavailableError {
  return new ServiceUnavailableError(
    SMTP_SERVICE,
    "not_configured",
    "Connexion requise : le serveur d'envoi d'e-mails n'est pas configuré.",
  );
}

export const unconfiguredSmtpGateway: SmtpGateway = {
  isConfigured: false,
  send: () => Promise.reject(smtpNotConfigured()),
  verify: () => Promise.reject(smtpNotConfigured()),
};

function unavailable(cause: unknown): ServiceUnavailableError {
  const code = (cause as { code?: string } | null)?.code;
  if (code === "EAUTH") {
    return new ServiceUnavailableError(
      SMTP_SERVICE,
      "unauthorized",
      "Connexion requise : le serveur d'envoi refuse les identifiants configurés.",
      { cause },
    );
  }
  return new ServiceUnavailableError(
    SMTP_SERVICE,
    "unreachable",
    "Le serveur d'envoi d'e-mails ne répond pas ou refuse le message.",
    { cause },
  );
}

export class SmtpClient implements SmtpGateway {
  readonly isConfigured = true;
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: SmtpConfig) {
    this.from = config.from;
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port ?? (config.secure ? 465 : 587),
      secure: config.secure ?? false,
      requireTLS: !config.secure && !config.allowPlaintext,
      ignoreTLS: config.allowPlaintext ?? false,
      auth: config.user ? { user: config.user, pass: config.password ?? "" } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      dnsTimeout: 10_000,
    });
  }

  async send(mail: OutgoingEmail): Promise<{ messageId: string }> {
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: mail.to,
        replyTo: mail.replyTo ?? undefined,
        subject: mail.subject,
        text: mail.text ?? undefined,
        html: mail.html ?? undefined,
      });
      if ((info.accepted ?? []).length === 0) {
        throw new Error("Message refusé par le serveur d'envoi.");
      }
      return { messageId: String(info.messageId) };
    } catch (cause) {
      throw unavailable(cause);
    }
  }

  async verify(): Promise<void> {
    try {
      await this.transport.verify();
    } catch (cause) {
      throw unavailable(cause);
    }
  }
}
