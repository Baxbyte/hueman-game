import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureEmailSchema, unsubscribeByToken } from "./_lib/subscribers.js";
import { unsubscribedPage, alreadyOrInvalidPage } from "./_lib/email-templates.js";

/**
 * GET  /api/unsubscribe?token=...  — link click from an email footer.
 * POST /api/unsubscribe?token=...  — RFC 8058 one-click (List-Unsubscribe-Post).
 *
 * Idempotent: unsubscribing an already-unsubscribed token still succeeds.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String((req.query.token as string) ?? "");
  const oneClick = req.method === "POST";

  try {
    await ensureEmailSchema();
    const sub = token ? await unsubscribeByToken(token) : null;

    if (oneClick) {
      // Mail clients just need a 2xx; no human reads this body.
      return res.status(sub ? 200 : 404).json({ ok: Boolean(sub) });
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(sub ? 200 : 404).send(sub ? unsubscribedPage() : alreadyOrInvalidPage());
  } catch (err) {
    console.error("[unsubscribe] error:", err);
    if (oneClick) return res.status(500).json({ ok: false });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(alreadyOrInvalidPage());
  }
}
