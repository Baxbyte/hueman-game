import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PID_RE, CURRENCY, packForSku } from "./_lib/credits.js";

/**
 * POST /api/checkout { pid, sku } → { url }
 *
 * Creates a Stripe Checkout Session and hands back the hosted payment page.
 *
 * Prices are declared inline with `price_data`, so there is nothing to create
 * in the Stripe dashboard: point STRIPE_SECRET_KEY at any existing Stripe
 * account and the packs in _lib/credits.ts become the catalogue. Changing a
 * price is a code change, reviewed like any other.
 *
 * Talking to Stripe over plain fetch keeps this repo dependency-free, matching
 * the rest of the codebase.
 */

const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";

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

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(503).json({ error: "store_closed" });

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

  const site = origin(req);
  const form = new URLSearchParams({
    mode: "payment",
    success_url: `${site}/?credits=ok&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/?credits=cancel`,
    client_reference_id: pid,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": CURRENCY,
    "line_items[0][price_data][unit_amount]": String(pack.amount),
    "line_items[0][price_data][product_data][name]": `HUEMAN — ${pack.name}`,
    "line_items[0][price_data][product_data][description]":
      "Credits for extra runs at the daily HUEMAN puzzle. Non-refundable digital goods.",
    // Read back by the webhook. Credits are taken from metadata rather than
    // re-derived from the amount, so a price change can never retro-price an
    // in-flight session.
    "metadata[pid]": pid,
    "metadata[sku]": pack.sku,
    "metadata[credits]": String(pack.credits),
    "payment_intent_data[metadata][pid]": pid,
    "payment_intent_data[metadata][sku]": pack.sku,
    allow_promotion_codes: "true",
  });

  try {
    const r = await fetch(STRIPE_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Retries of the same intent reuse the session instead of opening a
        // second one; the minute bucket keeps a deliberate re-purchase working.
        "Idempotency-Key": `hue:${pid}:${pack.sku}:${Math.floor(Date.now() / 60000)}`,
      },
      body: form,
    });
    const data: any = await r.json();
    if (!r.ok || !data?.url) {
      return res.status(502).json({ error: "stripe_error" });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ url: data.url, sku: pack.sku, credits: pack.credits });
  } catch {
    return res.status(502).json({ error: "stripe_unreachable" });
  }
}
