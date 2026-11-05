"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/feedback";
import { getAuthClient } from "@/lib/auth-client";
import { AuthCard } from "../auth-card";

type Step = "credentials" | "totp" | "backup" | "forgot" | "forgot-sent";

interface AuthError {
  status?: number;
  code?: string;
}

/** Message volontairement générique : ne révèle pas si l'adresse existe. */
function signInErrorMessage(error: AuthError): string {
  if (error.status === 429)
    return "Trop de tentatives. Patientez quelques instants avant de réessayer.";
  if (error.code === "BANNED_USER") return "Ce compte est désactivé. Contactez un associé.";
  if (error.status === 400 || error.status === 401) return "E-mail ou mot de passe incorrect.";
  return "Connexion impossible pour le moment. Réessayez dans quelques instants.";
}

function secondFactorErrorMessage(error: AuthError): string {
  if (error.status === 429 || error.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") {
    return "Trop de tentatives. Patientez quelques instants avant de réessayer.";
  }
  if (error.code === "ACCOUNT_TEMPORARILY_LOCKED") {
    return "Trop d’essais incorrects : le compte est bloqué un moment. Réessayez plus tard.";
  }
  if (error.code === "INVALID_TWO_FACTOR_COOKIE") {
    return "Votre connexion a expiré. Reprenez depuis l’e-mail et le mot de passe.";
  }
  if (error.code === "INVALID_BACKUP_CODE") return "Ce code de secours n’est pas valable.";
  return "Ce code n’est pas valable. Vérifiez-le et réessayez.";
}

function LinkButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hit-44 w-fit text-sm font-medium text-accent underline-offset-4 hover:underline"
    >
      {children}
    </button>
  );
}

/** Écran 15 et ses états non dessinés : erreur, second facteur, mot de passe oublié. */
export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function goTo(next: Step) {
    setError(null);
    setStep(next);
  }

  function done() {
    router.replace(redirectTo);
    router.refresh();
  }

  function onSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const address = String(form.get("email") ?? "");
    setEmail(address);
    setError(null);
    startTransition(async () => {
      const { data, error: signInError } = await getAuthClient().signIn.email({
        email: address,
        password: String(form.get("password") ?? ""),
      });
      if (signInError) {
        setError(signInErrorMessage(signInError));
        return;
      }
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        setStep("totp");
        return;
      }
      done();
    });
  }

  function onSecondFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s/g, "");
    const trustDevice = form.get("trustDevice") === "on";
    setError(null);
    startTransition(async () => {
      const client = getAuthClient();
      const { error: factorError } =
        step === "totp"
          ? await client.twoFactor.verifyTotp({ code, trustDevice })
          : await client.twoFactor.verifyBackupCode({ code, trustDevice });
      if (factorError) {
        setError(secondFactorErrorMessage(factorError));
        return;
      }
      done();
    });
  }

  function onForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const address = String(form.get("email") ?? "");
    setEmail(address);
    setError(null);
    startTransition(async () => {
      const { error: resetError } = await getAuthClient().requestPasswordReset({
        email: address,
        redirectTo: "/login/reinitialiser",
      });
      if (resetError?.code === "RESET_PASSWORD_DISABLED") {
        setError(
          "L’envoi d’e-mails n’est pas encore en service. Demandez à un associé de réinitialiser votre mot de passe.",
        );
        return;
      }
      if (resetError?.status === 429) {
        setError("Trop de demandes. Patientez quelques instants avant de réessayer.");
        return;
      }
      // Réponse identique que l'adresse existe ou non.
      setStep("forgot-sent");
    });
  }

  if (step === "totp" || step === "backup") {
    const isTotp = step === "totp";
    return (
      <AuthCard
        title="Double authentification"
        description={
          isTotp
            ? "Saisissez le code à 6 chiffres de votre application d’authentification."
            : "Saisissez un de vos codes de secours. Il ne servira qu’une fois."
        }
      >
        <form
          key={step}
          method="post"
          onSubmit={onSecondFactor}
          className="flex flex-col gap-4"
          noValidate
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field id="code" label={isTotp ? "Code à 6 chiffres" : "Code de secours"}>
            <Input
              id="code"
              name="code"
              autoComplete="one-time-code"
              inputMode={isTotp ? "numeric" : "text"}
              maxLength={isTotp ? 6 : 32}
              autoFocus
              required
              className="rounded-sm font-mono tracking-[0.2em]"
            />
          </Field>
          <Checkbox
            name="trustDevice"
            defaultChecked
            label="Faire confiance à cet appareil pendant 30 jours"
            className="py-1"
          />
          <Button type="submit" variant="accent" loading={pending} className="self-start">
            Vérifier
          </Button>
        </form>
        <div className="flex flex-col gap-1">
          <LinkButton onClick={() => goTo(isTotp ? "backup" : "totp")}>
            {isTotp ? "Utiliser un code de secours" : "Utiliser l’application d’authentification"}
          </LinkButton>
          <LinkButton onClick={() => goTo("credentials")}>Revenir à la connexion</LinkButton>
        </div>
      </AuthCard>
    );
  }

  if (step === "forgot") {
    return (
      <AuthCard
        title="Mot de passe oublié"
        description="Indiquez votre e-mail : nous vous enverrons un lien pour en choisir un nouveau."
      >
        <form method="post" onSubmit={onForgot} className="flex flex-col gap-4" noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field id="forgot-email" label="E-mail">
            <Input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={email}
              autoFocus
              required
              className="rounded-sm"
            />
          </Field>
          <Button type="submit" variant="accent" loading={pending} className="self-start">
            Recevoir le lien
          </Button>
        </form>
        <LinkButton onClick={() => goTo("credentials")}>Revenir à la connexion</LinkButton>
      </AuthCard>
    );
  }

  if (step === "forgot-sent") {
    return (
      <AuthCard title="Vérifiez vos e-mails">
        <Alert tone="success">
          Si un compte existe pour {email}, un lien vient de partir. Il reste valable une heure.
        </Alert>
        <LinkButton onClick={() => goTo("credentials")}>Revenir à la connexion</LinkButton>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Espace de l’agence" description="Réservé à l’équipe de Nuera Studio.">
      <form method="post" onSubmit={onSignIn} className="flex flex-col gap-5" noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="email" label="E-mail">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            defaultValue={email}
            required
            aria-invalid={error ? true : undefined}
            className="rounded-sm"
          />
        </Field>
        <Field id="password" label="Mot de passe">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={error ? true : undefined}
            className="rounded-sm"
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" variant="accent" loading={pending}>
            Se connecter
          </Button>
          <LinkButton onClick={() => goTo("forgot")}>Mot de passe oublié ?</LinkButton>
        </div>
      </form>
      <p className="text-xs leading-[1.25] text-muted">
        Double authentification demandée à chaque nouvel appareil.
      </p>
    </AuthCard>
  );
}
