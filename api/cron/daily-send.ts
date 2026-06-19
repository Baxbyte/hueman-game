import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql, ensureSchema } from "../_lib/db.js";
import { currentDay } from "../_lib/day.js";
import { ensureSeeded } from "../_lib/seed.js";
import {
  ensureEmailSchema,
  dueSubscribers,
  claimDailySend,
  logSend,
  localHour,
} from "../_lib/subscribers.js";
import { sendEmail, emailConfigured } from "../_lib/email.js";
import { buildDailyEmail, type LeaderRow } from "../_lib/email-templates.js";

// Hobby plan caps function duration; keep the batch within it.
export const config = { maxDuration: 60 };

// Delivery timing. The puzzle rolls over at 00:00 UTC; we deliver each
// subscriber the day's email once their LOCAL clock has reached SEND_HOUR, so
// the nudge lands in their morning, in their own time zone.
//
// Driven by an hourly trigger (.github/workflows/daily-email.yml). The ">=
// SEND_HOUR" window (rather than "== SEND_HOUR") makes delivery robust to
// scheduler jitter/skips: a missed top-of-hour still sends on the next run,
// and the per-(subscriber,day) claim guarantees exactly one send per day.
//
// EMAIL_SEND_HOUR=0 makes everyone eligible immediately — use that with a
// once-a-day 00:00 UTC trigger to "send all at the drop" instead.
const SEND_HOUR = Number(process.env.EMAIL_SEND_HOUR ?? 8);

function authorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // not yet configured — allow so it runs pre-setup
  const auth = req.headers.authorization || "";
  if (auth === `Bearer ${secret}`) return true;
  // Allow a manual ?key= for ad-hoc testing.
  return String(req.query.key ?? "") === secret;
}

async function topForDay(day: number): Promise<{ total: number; top: LeaderRow[] }> {
  const sql = getSql();
  const rows = (await sql`
    SELECT name, country, level FROM scores WHERE day = ${day} ORDER BY score DESC LIMIT 5
  `) as { name: string; country: string; level: number }[];
  const totalRows = (await sql`
    SELECT count(*)::int AS total FROM scores WHERE day = ${day}
  `) as { total: number }[];
  const top: LeaderRow[] = rows.map((r, i) => ({
    rank: i + 1,
    name: r.name ?? "Anonymous",
    country: r.country ?? "ZZ",
    level: r.level ?? 0,
  }));
  return { total: totalRows[0]?.total ?? 0, top };
}

/**
 * GET /api/cron/daily-send   (Vercel Cron, hourly)
 *
 * Sends each confirmed subscriber the day's HUEMAN email when their LOCAL clock
 * reaches SEND_HOUR. Idempotent per (subscriber, puzzle-day) via claimDailySend,
 * so overlapping/retried runs never double-send.
 *
 * Query helpers (require auth): ?force=1 ignores the local-hour gate (still
 * idempotent); ?preview=1 renders the email HTML without sending or writing.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });

  const DAY = currentDay();
  const force = String(req.query.force ?? "") === "1";
  const preview = String(req.query.preview ?? "") === "1";

  try {
    await ensureSchema();
    await ensureEmailSchema();
    await ensureSeeded(DAY);

    const { total, top } = await topForDay(DAY);

    if (preview) {
      const tmpl = buildDailyEmail({ day: DAY, unsubToken: "preview-token", total, top });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(tmpl.html);
    }

    if (!emailConfigured()) {
      return res.status(200).json({ ok: false, error: "email_not_configured", day: DAY });
    }

    const now = new Date();
    const due = await dueSubscribers(DAY);
    let sent = 0;
    let errors = 0;
    let skipped = 0;

    for (const sub of due) {
      // Send once the subscriber's local clock has reached SEND_HOUR (their
      // morning). Earlier in their day → wait for a later hourly run.
      if (!force && localHour(sub.tz, now) < SEND_HOUR) {
        skipped++;
        continue;
      }
      // Atomically claim this day for this subscriber before sending.
      if (!(await claimDailySend(sub.id, DAY))) {
        skipped++;
        continue;
      }
      const tmpl = buildDailyEmail({ day: DAY, unsubToken: sub.unsub_token, total, top });
      const r = await sendEmail({
        to: sub.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        listUnsubscribe: tmpl.listUnsub,
      });
      if (r.ok) {
        sent++;
        await logSend(sub.id, DAY, "sent", r.id);
      } else {
        errors++;
        console.error("[daily-send] send failed for", sub.email, r.error);
        await logSend(sub.id, DAY, "error", null);
        // Roll back the claim so a later run this same day can retry.
        await getSql()`UPDATE email_subscribers SET last_sent_day = NULL WHERE id = ${sub.id} AND last_sent_day = ${DAY}`;
      }
    }

    return res.status(200).json({ ok: true, day: DAY, candidates: due.length, sent, errors, skipped, sendHour: SEND_HOUR });
  } catch (err: any) {
    const unconfigured = err && err.message === "db_not_configured";
    console.error("[daily-send] error:", err);
    return res
      .status(unconfigured ? 503 : 500)
      .json({ error: unconfigured ? "storage_unavailable" : "server_error" });
  }
}
