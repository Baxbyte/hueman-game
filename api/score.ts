import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql, ensureSchema } from "./_lib/db.js";
import { currentDay } from "./_lib/day.js";
import { normalizeCountry } from "./_lib/countries.js";
import { sanitizeName } from "./_lib/name.js";
import {
  LEVEL_MIN,
  LEVEL_MAX,
  TIME_MIN,
  TIME_MAX,
  RETENTION_DAYS,
  compositeScore,
  rankForScore,
  rankForScoreUnlimited,
} from "./_lib/board.js";
import { ensureSeeded } from "./_lib/seed.js";
import { verifyRunToken } from "./_lib/token.js";
import { BASE_LIVES } from "./_lib/credits.js";

const PID_RE = /^[a-z0-9]{8,40}$/i;
// Submissions per IP per day. Headroom for the free run plus a full day of
// Unlimited attempts (capped at 20 in /api/spend) and the odd retry.
const RATE_LIMIT = 60;

function clientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : (xff || "").split(",")[0];
  return (raw || "unknown").trim();
}

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  // Round rather than reject non-integers: client timing values are fractional
  // (performance.now() deltas), and must not be turned away as "bad_score".
  return Math.min(max, Math.max(min, Math.round(n)));
}

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
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "bad_body" });
  }

  const DAY = currentDay();
  // The puzzle is daily and shared; a result only counts for the live day.
  if (clampInt(body.day, 1, 10_000_000) !== DAY) {
    return res.status(409).json({ error: "stale_day", day: DAY });
  }

  const pid = typeof body.pid === "string" ? body.pid : "";
  if (!PID_RE.test(pid)) return res.status(400).json({ error: "bad_pid" });

  const level = clampInt(body.level, LEVEL_MIN, LEVEL_MAX);
  const timeMs = clampInt(body.timeMs, TIME_MIN, TIME_MAX);
  if (level == null || timeMs == null) {
    return res.status(400).json({ error: "bad_score" });
  }

  const name = sanitizeName(body.name);
  if (name == null) return res.status(400).json({ error: "bad_name" });

  const country =
    normalizeCountry(body.country) !== "ZZ"
      ? normalizeCountry(body.country)
      : normalizeCountry(req.headers["x-vercel-ip-country"]);

  try {
    await ensureSchema();
    const sql = getSql();

    // Per-IP per-day rate limit (caps spray, not a determined attacker).
    const rl = (await sql`
      INSERT INTO rate_limits (day, ip, n) VALUES (${DAY}, ${clientIp(req)}, 1)
      ON CONFLICT (day, ip) DO UPDATE SET n = rate_limits.n + 1
      RETURNING n
    `) as { n: number }[];
    if ((rl[0]?.n ?? 0) > RATE_LIMIT) {
      return res.status(429).json({ error: "rate_limited" });
    }

    // Ensure the day's holding entries exist so rank/total/percentile are
    // computed against a populated board, consistent with what's displayed.
    await ensureSeeded(DAY);

    const score = compositeScore(level, timeMs);
    const ts = Date.now();

    // A valid run token means this result came from a credit-funded extra run,
    // so it belongs on Unlimited. Everything else is the player's one free run
    // of the day and belongs on the pure Daily board.
    const claims = verifyRunToken(body.token);
    const paid = !!claims && claims.pid === pid && claims.day === DAY;
    const attempts = paid ? claims!.n + 1 : 1;
    const boosted = paid && (claims!.lives > BASE_LIVES || claims!.m > 100);

    if (!paid) {
      // Daily board: written once and then frozen. A player's rank here can
      // only ever be beaten by someone else's first run — no amount of money
      // moves this row, which is what keeps the free game worth playing.
      // Display fields still follow a name change; the run itself never does.
      await sql`
        INSERT INTO scores (day, pid, name, country, level, time_ms, score, ts)
        VALUES (${DAY}, ${pid}, ${name}, ${country}, ${level}, ${timeMs}, ${score}, ${ts})
        ON CONFLICT (day, pid) DO UPDATE SET
          name = EXCLUDED.name, country = EXCLUDED.country
      `;
    } else {
      await sql`UPDATE runs SET used = true WHERE day = ${DAY} AND pid = ${pid} AND n = ${claims!.n}`;
    }

    // Unlimited takes every run from everyone — free players included, with
    // their single attempt — and keeps the best. Buying credits buys more
    // chances at this board, not a better starting position on it.
    await sql`
      INSERT INTO scores_unlimited (day, pid, name, country, level, time_ms, score, runs, boosted, ts)
      VALUES (${DAY}, ${pid}, ${name}, ${country}, ${level}, ${timeMs}, ${score},
              ${attempts}, ${boosted}, ${ts})
      ON CONFLICT (day, pid) DO UPDATE SET
        name = EXCLUDED.name, country = EXCLUDED.country, level = EXCLUDED.level,
        time_ms = EXCLUDED.time_ms, score = EXCLUDED.score,
        boosted = EXCLUDED.boosted, ts = EXCLUDED.ts
      WHERE EXCLUDED.score > scores_unlimited.score
    `;
    // Attempt count tracks the whole day, not just the winning run, so it is
    // updated even when this run failed to beat the player's own best.
    await sql`
      UPDATE scores_unlimited SET runs = GREATEST(runs, ${attempts})
      WHERE day = ${DAY} AND pid = ${pid}
    `;

    // Opportunistically prune days that have aged out of the viewable window.
    await sql`DELETE FROM scores WHERE day < ${DAY - (RETENTION_DAYS - 1)}`;
    await sql`DELETE FROM scores_unlimited WHERE day < ${DAY - (RETENTION_DAYS - 1)}`;
    await sql`DELETE FROM runs WHERE day < ${DAY - (RETENTION_DAYS - 1)}`;
    await sql`DELETE FROM rate_limits WHERE day < ${DAY}`;

    const bestRows = (await sql`
      SELECT score FROM scores WHERE day = ${DAY} AND pid = ${pid}
    `) as { score: number }[];
    const best = bestRows[0]?.score ?? null;

    const totalRows = (await sql`
      SELECT count(*)::int AS total FROM scores WHERE day = ${DAY}
    `) as { total: number }[];
    const total = totalRows[0]?.total ?? 0;

    const rank = best == null ? 0 : await rankForScore(DAY, Number(best));
    const percentile =
      total > 0 ? Math.max(1, Math.round((1 - (rank - 1) / total) * 100)) : 100;

    const odBestRows = (await sql`
      SELECT score, runs FROM scores_unlimited WHERE day = ${DAY} AND pid = ${pid}
    `) as { score: number; runs: number }[];
    const odBest = odBestRows[0]?.score ?? null;
    const odTotalRows = (await sql`
      SELECT count(*)::int AS total FROM scores_unlimited WHERE day = ${DAY}
    `) as { total: number }[];
    const od = {
      rank: odBest == null ? 0 : await rankForScoreUnlimited(DAY, Number(odBest)),
      total: odTotalRows[0]?.total ?? 0,
      runs: odBestRows[0]?.runs ?? attempts,
    };

    return res.status(200).json({
      ok: true,
      day: DAY,
      board: paid ? "unlimited" : "daily",
      rank,
      total,
      percentile,
      od,
    });
  } catch (err: any) {
    const unconfigured = err && err.message === "db_not_configured";
    return res
      .status(unconfigured ? 503 : 500)
      .json({ error: unconfigured ? "storage_unavailable" : "server_error" });
  }
}
