import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql, ensureSchema } from "./_lib/db.js";
import { currentDay } from "./_lib/day.js";
import {
  ensureEmailSchema,
  normalizeEmail,
  normalizeTz,
  upsertSubscriber,
} from "./_lib/subscribers.js";
import { sendEmail, emailConfigured } from "./_lib/email.js";
import { buildConfirmationEmail, listUnsubscribeHeader } from "./_lib/email-templates.js";

const RATE_LIMIT = 8; // signup attempts per IP per day

function clientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : (xff || "").split(",")[0];
  return (raw || "unknown").trim();
}

/**
 * POST /api/subscribe  { email, tz?, source? }
 *
 * Double opt-in: creates an UNCONFIRMED row and emails a confirmation link.
 * Always responds 200 {ok:true} for any valid-looking email (even duplicates)
 * so the endpoint can't be used to enumerate who's subscribed.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

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

  const email = normalizeEmail(body.email);
  if (!email) return res.status(400).json({ error: "bad_email" });
  const tz = normalizeTz(body.tz);
  const source = String(body.source ?? "game_notify").slice(0, 40);

  try {
    await ensureSchema();
    await ensureEmailSchema();
    const sql = getSql();

    // Per-IP/day rate limit (reuses the generic rate_limits table, namespaced).
    const DAY = currentDay();
    const rl = (await sql`
      INSERT INTO rate_limits (day, ip, n) VALUES (${DAY}, ${"sub:" + clientIp(req)}, 1)
      ON CONFLICT (day, ip) DO UPDATE SET n = rate_limits.n + 1
      RETURNING n
    `) as { n: number }[];
    if ((rl[0]?.n ?? 0) > RATE_LIMIT) {
      return res.status(429).json({ error: "rate_limited" });
    }

    const { sub, alreadyActive } = await upsertSubscriber({ email, tz, source });

    if (alreadyActive) {
      return res.status(200).json({ ok: true, status: "already_subscribed" });
    }

    // Send the confirmation email (best-effort; surface config gaps to logs).
    if (emailConfigured()) {
      const tmpl = buildConfirmationEmail(sub.confirm_token);
      const r = await sendEmail({
        to: email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        listUnsubscribe: listUnsubscribeHeader(sub.unsub_token),
      });
      if (!r.ok) console.error("[subscribe] confirmation send failed:", r.error);
    } else {
      console.warn("[subscribe] email not configured — row created but no confirmation sent");
    }

    return res.status(200).json({ ok: true, status: "confirmation_sent" });
  } catch (err: any) {
    const unconfigured = err && err.message === "db_not_configured";
    return res
      .status(unconfigured ? 503 : 500)
      .json({ error: unconfigured ? "storage_unavailable" : "server_error" });
  }
}
