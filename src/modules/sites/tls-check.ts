import "server-only";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { checkServerIdentity, connect as tlsConnect, type PeerCertificate } from "node:tls";
import type { TlsStatus } from "@/lib/domain-enums";
import { EXPIRY_WARNING_DAYS, parisDay } from "./site.health";

/**
 * Contrôle réel d'un certificat : poignée de main TLS depuis le serveur.
 *
 * Défense contre le SSRF, car le nom vient d'une saisie : le nom est résolu ici, chaque adresse
 * résolue est contrôlée, puis on se connecte **à l'adresse contrôlée** (le SNI porte le nom). Une
 * réponse DNS changeante entre le contrôle et la connexion ne peut donc pas viser le réseau interne.
 * Délai global borné. Seul le port 443 est visé. Aucune donnée n'est envoyée après la poignée.
 */
const PRIVATE_RANGES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, "ipv6");
}

/** Vrai pour toute adresse hors de l'Internet public, y compris IPv4 encapsulée en IPv6. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return PRIVATE_RANGES.check(mapped[1], "ipv4");
  const family = isIP(address);
  if (family === 4) return PRIVATE_RANGES.check(address, "ipv4");
  if (family === 6) return PRIVATE_RANGES.check(address, "ipv6");
  return true; // Ce qui n'est pas une adresse lisible est refusé.
}

export type TlsFailureReason =
  "invalid_host" | "private_address" | "dns" | "timeout" | "connection" | "no_certificate";

export interface TlsCheckResult {
  status: TlsStatus;
  /** `AAAA-MM-JJ`, `null` si aucun certificat n'a pu être lu. */
  expiresOn: string | null;
  /** Rempli si le contrôle n'a pas abouti ou si le certificat est refusé. */
  reason: TlsFailureReason | "untrusted" | "hostname_mismatch" | null;
}

const FAILURE_MESSAGES: Record<NonNullable<TlsCheckResult["reason"]>, string> = {
  invalid_host: "Ce nom de domaine n'est pas contrôlable.",
  private_address: "Ce domaine pointe vers une adresse privée : contrôle refusé.",
  dns: "Ce domaine ne se résout pas.",
  timeout: "Le serveur n'a pas répondu à temps.",
  connection: "Connexion au port 443 impossible.",
  no_certificate: "Le serveur n'a présenté aucun certificat.",
  untrusted: "Le certificat n'est pas reconnu par une autorité de confiance.",
  hostname_mismatch: "Le certificat ne correspond pas à ce domaine.",
};

export function tlsFailureMessage(reason: TlsCheckResult["reason"]): string | null {
  return reason ? FAILURE_MESSAGES[reason] : null;
}

const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i;
const DAY_MS = 86_400_000;

export interface TlsCheckOptions {
  now?: Date;
  port?: number;
  timeoutMs?: number;
  /** Résolution DNS, à remplacer en test. */
  lookup?: (host: string) => Promise<{ address: string; family: number }[]>;
  /**
   * Autorise les adresses privées : réservé aux tests, sur un serveur local. Aucun appelant de
   * `src/` ne le passe.
   */
  allowPrivateAddresses?: boolean;
}

function failure(reason: NonNullable<TlsCheckResult["reason"]>): TlsCheckResult {
  return { status: "error", expiresOn: null, reason };
}

/** État d'un certificat lu, en date du `now` donné. */
export function classifyCertificate(
  validTo: Date,
  authorizationError: string | null,
  hostnameMismatch: boolean,
  now: Date,
): TlsCheckResult {
  const expiresOn = parisDay(validTo);
  if (validTo.getTime() <= now.getTime()) return { status: "expired", expiresOn, reason: null };
  if (hostnameMismatch) return { status: "error", expiresOn, reason: "hostname_mismatch" };
  if (authorizationError) return { status: "error", expiresOn, reason: "untrusted" };
  const expiring = validTo.getTime() - now.getTime() < EXPIRY_WARNING_DAYS * DAY_MS;
  return { status: expiring ? "expiring" : "valid", expiresOn, reason: null };
}

export async function checkTlsCertificate(
  host: string,
  options: TlsCheckOptions = {},
): Promise<TlsCheckResult> {
  const {
    now = new Date(),
    port = 443,
    timeoutMs = 5000,
    lookup = (name: string) => dnsLookup(name, { all: true }),
    allowPrivateAddresses = false,
  } = options;

  if (!HOSTNAME.test(host) || isIP(host)) return failure("invalid_host");

  let addresses: { address: string; family: number }[];
  try {
    addresses = await withTimeout(lookup(host), timeoutMs);
  } catch {
    return failure("dns");
  }
  if (addresses.length === 0) return failure("dns");

  // Une seule adresse privée suffit à refuser : un domaine mixte reste une cible interne.
  if (!allowPrivateAddresses && addresses.some(({ address }) => isPrivateAddress(address))) {
    return failure("private_address");
  }
  const address = addresses[0]?.address;
  if (!address) return failure("dns");

  return new Promise<TlsCheckResult>((resolve) => {
    const socket = tlsConnect({
      host: address,
      port,
      servername: host,
      // Un certificat expiré doit rester lisible : la validité est jugée ci-dessous.
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    });

    let settled = false;
    const settle = (result: TlsCheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => settle(failure("timeout")), timeoutMs);

    socket.once("secureConnect", () => {
      const certificate: PeerCertificate = socket.getPeerCertificate();
      if (!certificate?.valid_to) return settle(failure("no_certificate"));
      const validTo = new Date(certificate.valid_to);
      if (Number.isNaN(validTo.getTime())) return settle(failure("no_certificate"));
      const mismatch = checkServerIdentity(host, certificate) !== undefined;
      const authorizationError = socket.authorized
        ? null
        : String(socket.authorizationError ?? "unauthorized");
      settle(classifyCertificate(validTo, authorizationError, mismatch, now));
    });
    socket.once("error", () => settle(failure("connection")));
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Délai dépassé")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("Échec de la résolution"));
      },
    );
  });
}
