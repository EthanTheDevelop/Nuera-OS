import { handleCalWebhook } from "@/modules/appointments/cal-webhook.handler";

/** Webhook Cal.diy / Cal.com, optionnel (A9) : sans `CAL_WEBHOOK_SECRET`, cette route répond 404. */
export async function POST(request: Request): Promise<Response> {
  return handleCalWebhook(request);
}
