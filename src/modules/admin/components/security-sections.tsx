"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { encode } from "uqr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { getAuthClient } from "@/lib/auth-client";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/server/auth/password-policy";

/** QR code dessiné localement : le secret ne quitte jamais l'application. */
function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 2 });
  const path = data
    .flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className="bg-white size-44 shrink-0 rounded-sm"
      shapeRendering="crispEdges"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

function secretOf(totpUri: string): string {
  try {
    return new URL(totpUri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

type Enrolment = { totpUri: string; backupCodes: string[] };

/**
 * Double authentification, par le plugin de better-auth via son API HTTP : limitation de débit
 * comprise. L'activation est effective à la vérification du premier code.
 */
export function TwoFactorSection({
  enabled,
  required,
  showRequiredNotice,
}: {
  enabled: boolean;
  required: boolean;
  showRequiredNotice: boolean;
}) {
  const uid = useId();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [savedCodes, setSavedCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function begin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const { data, error: failed } = await getAuthClient().twoFactor.enable({ password });
      if (failed || !data || !("totpURI" in data)) {
        setError("Mot de passe incorrect, ou trop de tentatives. Réessayez.");
        return;
      }
      setPassword("");
      setEnrolment({ totpUri: data.totpURI, backupCodes: data.backupCodes });
    });
  }

  function verify(event: FormEvent) {
    event.preventDefault();
    if (!enrolment) return;
    setError(null);
    start(async () => {
      const { error: failed } = await getAuthClient().twoFactor.verifyTotp({ code });
      if (failed) {
        setError("Ce code n'est pas valable. Vérifiez l'heure de votre téléphone, puis réessayez.");
        return;
      }
      setSavedCodes(enrolment.backupCodes);
      setEnrolment(null);
      setCode("");
      toast({ message: "Double authentification activée.", tone: "success" });
    });
  }

  function disable(event: FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const { error: failed } = await getAuthClient().twoFactor.disable({ password });
      if (failed) {
        setError("Mot de passe incorrect, ou trop de tentatives. Réessayez.");
        return;
      }
      setPassword("");
      toast({ message: "Double authentification désactivée.", tone: "success" });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Double authentification</h3>
        {enabled ? (
          <Badge tone="success">Activée</Badge>
        ) : (
          <Badge tone={required ? "warn" : "neutral"}>{required ? "Exigée" : "Facultative"}</Badge>
        )}
      </div>

      {showRequiredNotice && !enabled ? (
        <Alert tone="warn">
          L&apos;agence exige la double authentification pour l&apos;équipe. Activez-la ici pour
          retrouver l&apos;accès aux autres pages : une application d&apos;authentification sur
          votre téléphone suffit.
        </Alert>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {savedCodes ? (
        <div className="flex flex-col gap-3">
          <Alert tone="success">
            C&apos;est activé. Gardez ces codes de secours en lieu sûr : chacun remplace une fois
            votre téléphone, et ils ne s&apos;afficheront plus.
          </Alert>
          <ul className="grid grid-cols-2 gap-1 font-mono text-xs text-text">
            {savedCodes.map((backup) => (
              <li key={backup}>{backup}</li>
            ))}
          </ul>
          <div>
            <Button
              onClick={() => {
                setSavedCodes(null);
                router.refresh();
              }}
            >
              J&apos;ai noté mes codes
            </Button>
          </div>
        </div>
      ) : enrolment ? (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <p className="text-sm text-text">
            Scannez ce code avec votre application d&apos;authentification, puis saisissez le code
            qu&apos;elle affiche.
          </p>
          <div className="flex flex-wrap items-start gap-4">
            <QrCode
              value={enrolment.totpUri}
              label="Code à scanner pour la double authentification"
            />
            <div className="flex min-w-0 flex-1 basis-48 flex-col gap-3">
              <div>
                <p className="text-xs text-muted">Ou saisissez cette clé :</p>
                <p className="font-mono text-xs break-all text-text">
                  {secretOf(enrolment.totpUri)}
                </p>
              </div>
              <Field id={`${uid}-code`} label="Code à 6 chiffres">
                <Input
                  id={`${uid}-code`}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                />
              </Field>
              <div>
                <Button type="submit" variant="accent" loading={pending}>
                  Activer
                </Button>
              </div>
            </div>
          </div>
        </form>
      ) : enabled ? (
        required ? (
          <p className="text-sm text-muted">
            Activée sur ce compte. L&apos;agence l&apos;exige : elle ne se désactive pas ici.
          </p>
        ) : (
          <form onSubmit={disable} className="flex flex-wrap items-end gap-3">
            <Field
              id={`${uid}-off`}
              label="Votre mot de passe, pour la désactiver"
              className="flex-1 basis-56"
            >
              <Input
                id={`${uid}-off`}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Button type="submit" loading={pending}>
              Désactiver
            </Button>
          </form>
        )
      ) : (
        <form onSubmit={begin} className="flex flex-wrap items-end gap-3">
          <Field
            id={`${uid}-on`}
            label="Votre mot de passe, pour commencer"
            className="flex-1 basis-56"
          >
            <Input
              id={`${uid}-on`}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Button type="submit" variant="accent" loading={pending}>
            Activer
          </Button>
        </form>
      )}
    </div>
  );
}

export function PasswordSection() {
  const uid = useId();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("Les deux mots de passe sont différents.");
      return;
    }
    start(async () => {
      const { error: failed } = await getAuthClient().changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (failed) {
        setError("Mot de passe actuel incorrect, ou nouveau mot de passe trop court.");
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      toast({
        message: "Mot de passe modifié. Vos autres sessions sont fermées.",
        tone: "success",
      });
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-border pt-5">
      <h3 className="text-sm font-semibold text-ink">Mot de passe</h3>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field id={`${uid}-current`} label="Mot de passe actuel">
        <Input
          id={`${uid}-current`}
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id={`${uid}-new`}
          label="Nouveau mot de passe"
          hint={`${PASSWORD_MIN_LENGTH} caractères minimum.`}
        >
          <Input
            id={`${uid}-new`}
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={PASSWORD_MAX_LENGTH}
            required
          />
        </Field>
        <Field id={`${uid}-confirm`} label="Confirmation">
          <Input
            id={`${uid}-confirm`}
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
      </div>
      <div>
        <Button type="submit" loading={pending}>
          Changer le mot de passe
        </Button>
      </div>
    </form>
  );
}
