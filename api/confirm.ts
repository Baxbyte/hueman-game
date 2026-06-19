import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureEmailSchema, confirmByToken } from "./_lib/subscribers.js";
import { sendEmail, emailConfigured } from "./_lib/email.js";
import {
  buildWelcomeEmail,
  confirmedPage,
  alreadyOrInvalidPage,
  listUnsubscribeHeader,
} from "./_lib/email-templates.js";

/**
 * GET /api/confirm?token=...
 *
 * Completes double opt-in: stamps confirmed_at and fires the automated
 * "you're in" welcome email. Returns a friendly branded HTML page either way.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String((req.query.token as string) ?? "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  try {
    await ensureEmailSchema();
    const sub = await confirmByToken(token);
    if (!sub) {
      return res.status(404).send(alreadyOrInvalidPage());
    }

    // Fire the welcome email once — only on the transition to confirmed. We
    // approximate "just confirmed" by confirmed_at being within the last
    // minute; a re-clicked link won't re-send.
    const justConfirmed = sub.confirmed_at != null && Date.now() - sub.confirmed_at < 60_000;
    if (justConfirmed && emailConfigured()) {
      const tmpl = buildWelcomeEmail(sub.unsub_token);
      const r = await sendEmail({
        to: sub.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        listUnsubscribe: listUnsubscribeHeader(sub.unsub_token),
      });
      if (!r.ok) console.error("[confirm] welcome send failed:", r.error);
    }

    return res.status(200).send(confirmedPage());
  } catch (err) {
    console.error("[confirm] error:", err);
    return res.status(500).send(alreadyOrInvalidPage());
  }
}
