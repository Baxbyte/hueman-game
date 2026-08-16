import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql, ensureSchema } from "./_lib/db.js";
import { currentDay } from "./_lib/day.js";
import {
  PID_RE,
  SPEND,
  BASE_LIVES,
  MAX_LIVES,
  SLOW_CLOCK_MULT,
  getWallet,
  debit,
  refund,
} from "./_lib/credits.js";
import { mintRunToken } from "./_lib/token.js";

/**
 * POST /api/spend — buy one extra run at today's puzzle.
 *
 * Body: { pid, day, extraLives?: 0..2, slowClock?: boolean }
 *
 * Charges the run plus whichever handicaps were chosen, records the run, and
 * returns a signed token the client hands back to /api/score. The result of
 * that run competes on Unlimited; the player's Daily-board entry is already
 * filed and is never touched again.
 */

/** Bound on extra runs per player per day — a guard rail, not a paywall. */
const MAX_RUNS_PER_DAY = 20;

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

  const pid = typeof body.pid === "string" ? body.pid : "";
  if (!PID_RE.test(pid)) return res.status(400).json({ error: "bad_pid" });

  const DAY = currentDay();
  if (Number(body.day) !== DAY) return res.status(409).json({ error: "stale_day", day: DAY });

  const extraLives = Math.min(
    MAX_LIVES - BASE_LIVES,
    Math.max(0, Math.trunc(Number(body.extraLives) || 0))
  );
  const slowClock = body.slowClock === true;

  const cost =
    SPEND.rerun.credits + extraLives * SPEND.life.credits + (slowClock ? SPEND.slowclock.credits : 0);
  const items = [
    "rerun",
    ...Array(extraLives).fill("life"),
    ...(slowClock ? ["slowclock"] : []),
  ].join("+");

  try {
    await ensureSchema();
    const sql = getSql();

    await getWallet(pid); // create-on-first-sight, incl. the welcome grant

    const usedRows = (await sql`
      SELECT coalesce(max(n), 0)::int AS last FROM runs WHERE day = ${DAY} AND pid = ${pid}
    `) as { last: number }[];
    const n = (usedRows[0]?.last ?? 0) + 1;
    if (n > MAX_RUNS_PER_DAY) {
      return res.status(429).json({ error: "run_cap", cap: MAX_RUNS_PER_DAY });
    }

    const balance = await debit(pid, items, cost, DAY);
    if (balance == null) {
      const w = await getWallet(pid);
      return res.status(402).json({ error: "insufficient_credits", credits: w.credits, cost });
    }

    const lives = BASE_LIVES + extraLives;
    const mult = slowClock ? SLOW_CLOCK_MULT : 1;

    try {
      await sql`
        INSERT INTO runs (day, pid, n, lives, time_mult, used, ts)
        VALUES (${DAY}, ${pid}, ${n}, ${lives}, ${Math.round(mult * 100)}, false, ${Date.now()})
      `;
    } catch (e) {
      // Lost a race for this run number (or the write failed) — hand the
      // credits back rather than charging for a run that was never issued.
      await refund(pid, items, cost, DAY);
      return res.status(409).json({ error: "run_conflict" });
    }

    const token = mintRunToken({ pid, day: DAY, n, lives, m: Math.round(mult * 100) });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      token,
      day: DAY,
      run: n,
      lives,
      timeMult: mult,
      spent: cost,
      credits: balance,
    });
  } catch (err: any) {
    const unconfigured = err && err.message === "db_not_configured";
    return res
      .status(unconfigured ? 503 : 500)
      .json({ error: unconfigured ? "storage_unavailable" : "server_error" });
  }
}
