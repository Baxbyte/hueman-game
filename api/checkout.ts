import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PID_RE, CURRENCY, packForSku } from "./_lib/credits.js";
import { getStripe } from "./_lib/stripe.js";
import { isEmail } from "./_lib/email.js";

/**
 * POST /api/checkout { pid, sku } → { url }
 *
 * Creates a Stripe Checkout Session and hands back the hosted payment page.
 *
 * Prices are declared inline with `price_data`, so there is nothing to create
 * in the Stripe dashboard: point STRIPE_SECRET_KEY at any existing Stripe
 * account and the packs in _lib/credits.ts become the catalogue. Changing a
 * price is a code change, reviewed like any other.
 */

const SITE = "https://huemangame.com";

/** Hosts a return URL may point at: the live site, previews, and local dev. */
function allowedHost(host: string): boolean {
  return (
    host === "huemangame.com" ||
    host === "www.huemangame.com" ||
    host.endsWith(".vercel.app") ||
    host.startsWith("localhost:") ||
    host === "localhost"
  );
}

/**
 * Absolute origin for the success/cancel URLs.
 *
 * The Host header is caller-supplied, and these URLs end up inside a Stripe
 * session, so an unvetted value would let someone point a real checkout's
 * return trip at a site they control. Anything unrecognised falls back to the
 * canonical domain.
 */
function origin(req: VercelRequest): string {
  const hostRaw = req.headers["x-forwarded-host"] || req.headers.host;
  const host = (Array.isArray(hostRaw) ? hostRaw[0] : hostRaw || "").toLowerCase();
  if (!host || !allowedHost(host)) return SITE;
  const protoRaw = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(protoRaw) ? protoRaw[0] : protoRaw || "https").split(",")[0];
  return `${proto}://${host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: "store_closed" });

  let body: any = req.body;
  if (typeof body === "string") {
    if (body.length > 2000) return res.status(413).json({ error: "too_large" });
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "bad_json" });
    }
  }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "bad_body" });

  const pid = typeof body.pid === "string" ? body.pid : "";
  if (!PID_RE.test(pid)) return res.status(400).json({ error: "bad_pid" });

  const pack = packForSku(body.sku);
  if (!pack) return res.status(400).json({ error: "bad_sku" });

  // Optional. Given, it pre-fills Stripe's form, gets Stripe to send its own
  // payment receipt, and lets the webhook mail the restore code — the one piece
  // of a purchase that is genuinely painful to lose.
  const email = isEmail(body.email) ? body.email.trim().toLowerCase() : null;
  const marketing = body.marketing === true && !!email;

  const site = origin(req);

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        success_url: `${site}/?credits=ok&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/?credits=cancel`,
        client_reference_id: pid,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: CURRENCY,
              unit_amount: pack.amount,
              product_data: {
                name: `HUEMAN — ${pack.name}`,
                description:
                  "Credits for extra runs at the daily HUEMAN puzzle. Non-refundable digital goods.",
              },
            },
          },
        ],
        // Read back by the webhook. Credits are taken from metadata rather than
        // re-derived from the amount, so a price change can never retro-price an
        // in-flight session.
        ...(email ? { customer_email: email } : {}),
        metadata: {
          pid,
          sku: pack.sku,
          credits: String(pack.credits),
          ...(email ? { email, marketing: marketing ? "1" : "0" } : {}),
        },
        payment_intent_data: {
          metadata: { pid, sku: pack.sku },
          // Stripe's own payment receipt, separate from our credits email.
          ...(email ? { receipt_email: email } : {}),
        },
        allow_promotion_codes: true,
      },
      {
        // Retries of the same intent reuse the session instead of opening a
        // second one; the minute bucket keeps a deliberate re-purchase working.
        idempotencyKey: `hue:${pid}:${pack.sku}:${Math.floor(Date.now() / 60000)}`,
      }
    );

    if (!session.url) return res.status(502).json({ error: "stripe_error" });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ url: session.url, sku: pack.sku, credits: pack.credits });
  } catch (err) {
    // Never surface Stripe's message to the client — it can echo account state.
    const kind =
      err instanceof Error && err.name === "StripeConnectionError"
        ? "stripe_unreachable"
        : "stripe_error";
    return res.status(502).json({ error: kind });
  }
}
