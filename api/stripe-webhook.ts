import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema } from "./_lib/db.js";
import { PID_RE, packForSku, creditPurchase } from "./_lib/credits.js";
import { getStripe, type Stripe } from "./_lib/stripe.js";

/**
 * POST /api/stripe-webhook — the only path that can mint paid credits.
 *
 * Credits are never granted from the browser's return trip (a success_url is
 * trivially forged); they are granted here, after Stripe's signature checks
 * out. Redelivery is safe: creditPurchase keys on the session id and a repeat
 * inserts nothing.
 */

// Stripe signs the exact bytes it sent, so the body must not be parsed for us.
export const config = { api: { bodyParser: false } };

// Uint8Array rather than Buffer: Buffer's declared type varies over
// ArrayBufferLike, which the SDK's WebhookPayload signature rejects.
function rawBody(req: VercelRequest): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error("too_large"));
        return;
      }
      chunks.push(new Uint8Array(c));
    });
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = getStripe();
  if (!secret || !stripe) return res.status(503).json({ error: "webhook_not_configured" });

  const sigRaw = req.headers["stripe-signature"];
  const sig = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw;
  if (!sig) return res.status(400).json({ error: "missing_signature" });

  let payload: Uint8Array;
  try {
    payload = await rawBody(req);
  } catch {
    return res.status(413).json({ error: "too_large" });
  }

  // constructEvent both verifies the signature (with Stripe's own timestamp
  // tolerance and multi-signature rotation handling) and parses the payload,
  // so a forged or replayed request never reaches the crediting code below.
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, sig, secret);
  } catch {
    return res.status(400).json({ error: "bad_signature" });
  }

  // Anything else (refunds, disputes, test pings) is acknowledged and ignored.
  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return res.status(200).json({ received: true });
  }

  // Narrowed by the event type above, so this is a Checkout Session.
  const session = event.data.object;
  if (session.payment_status !== "paid") {
    // Delayed payment methods land here first; the async_payment_succeeded
    // event follows once the money actually clears.
    return res.status(200).json({ received: true, pending: true });
  }

  const pid = session.metadata?.pid || session.client_reference_id || "";
  const pack = packForSku(session.metadata?.sku);
  const credits = Number(session.metadata?.credits);
  const sessionId = session.id || "";

  if (!PID_RE.test(pid) || !pack || !sessionId || !Number.isFinite(credits) || credits <= 0) {
    // Acknowledge so Stripe stops retrying something we can never apply.
    return res.status(200).json({ received: true, ignored: "unrecognized_session" });
  }
  // Trust the session's own metadata, but never award more than the pack sells.
  const grant = Math.min(credits, pack.credits);

  try {
    await ensureSchema();
    const balance = await creditPurchase(pid, pack.sku, grant, sessionId);
    return res.status(200).json({ received: true, applied: balance != null });
  } catch {
    // 500 asks Stripe to retry — the ledger's unique ref keeps that safe.
    return res.status(500).json({ error: "server_error" });
  }
}
