/**
 * Lecture bornée du corps d'une requête publique. Next ne limite pas le corps d'une route : avec
 * `request.text()`, un inconnu sans signature fait charger en mémoire tout ce qu'il envoie, et la
 * taille n'est contrôlée qu'ensuite. Ici, la lecture s'arrête au premier octet de trop.
 */
export const WEBHOOK_MAX_BODY_BYTES = 1_000_000;

/** Le corps en texte, ou `null` s'il dépasse `maxBytes`. */
export async function readBodyWithin(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await request.body?.cancel();
    return null;
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}
