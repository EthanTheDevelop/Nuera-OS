function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const SUBJECT = "Votre espace projet Nuera est prêt";

/**
 * E-mail d'invitation (écran C1). Styles en ligne et tableaux : c'est un e-mail, pas une page. Tout
 * ce qui vient de la base est échappé. Le contenu porte un lien de connexion valide : il ne se
 * journalise pas et ne s'affiche jamais à l'écran.
 */
export function buildInvitationEmail(input: {
  firstName: string;
  projectName: string | null;
  interlocutors: string;
  url: string;
  host: string;
}): { subject: string; text: string; html: string } {
  const greeting = input.firstName ? `Bonjour ${input.firstName},` : "Bonjour,";
  const intro = input.projectName
    ? `Votre projet ${input.projectName} a désormais son espace de suivi.`
    : "Votre projet a désormais son espace de suivi.";
  const body = `${intro} Vous y voyez où en est le projet, ce que nous attendons de vous, les maquettes à valider, vos documents, et vous nous écrivez directement.`;
  const notice =
    "Pas de mot de passe à retenir : ce bouton vous connecte directement. Il reste valable 24 heures ; ensuite, demandez un nouveau lien depuis la page de connexion.";
  const footer = `Vous recevez ce message parce qu'un projet est en cours avec Nuera Studio. ${input.host}`;

  const text = [
    greeting,
    "",
    body,
    "",
    input.url,
    "",
    notice,
    "",
    `${input.interlocutors}, Nuera Studio`,
    "",
    footer,
  ].join("\n");
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;border:1px solid #d9dce3;border-radius:20px;overflow:hidden;font-family:Outfit,Arial,sans-serif;color:#222f52">
<tr><td style="background:#141730;padding:32px 40px;color:#ffffff;font-size:26px;font-weight:700">nuera</td></tr>
<tr><td style="padding:32px 40px 8px;font-size:22px;font-weight:600">${escapeHtml(greeting)}</td></tr>
<tr><td style="padding:8px 40px;font-size:16px;line-height:1.3">${escapeHtml(body)}</td></tr>
<tr><td style="padding:16px 40px"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#4467b2;color:#ffffff;font-weight:600;font-size:16px;text-decoration:none;padding:14px 28px;border-radius:12px">Accéder à mon espace</a></td></tr>
<tr><td style="padding:8px 40px;font-size:13px;line-height:1.3;color:#5b5d78">${escapeHtml(notice)}</td></tr>
<tr><td style="padding:16px 40px;font-size:14px;font-weight:600">${escapeHtml(input.interlocutors)}<br><span style="font-weight:400;font-size:12px;color:#5b5d78">Nuera Studio · les mêmes personnes, du début à la fin</span></td></tr>
<tr><td style="padding:24px 40px;font-size:11px;color:#5b5d78">${escapeHtml(footer)}</td></tr>
</table></td></tr></table>`;
  return { subject: SUBJECT, text, html };
}
