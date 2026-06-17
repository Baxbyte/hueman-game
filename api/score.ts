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
} from "./_lib/board.js";

const PID_RE = /^[a-z0-9]{8,40}$/i;
const RATE_LIMIT = 30; // submissions per IP per day

function clientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : (xff || "").split(",")[0];
  return (raw || "unknown").trim();
}

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return Math.min(max, Math.max(min, n));
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

    const score = compositeScore(level, timeMs);
    const ts = Date.now();

    // One entry per player per day; only overwrite if this run is better.
    await sql`
      INSERT INTO scores (day, pid, name, country, level, time_ms, score, ts)
      VALUES (${DAY}, ${pid}, ${name}, ${country}, ${level}, ${timeMs}, ${score}, ${ts})
      ON CONFLICT (day, pid) DO UPDATE SET
        name = EXCLUDED.name, country = EXCLUDED.country, level = EXCLUDED.level,
        time_ms = EXCLUDED.time_ms, score = EXCLUDED.score, ts = EXCLUDED.ts
      WHERE EXCLUDED.score > scores.score
    `;

    // Opportunistically prune days that have aged out of the viewable window.
    await sql`DELETE FROM scores WHERE day < ${DAY - (RETENTION_DAYS - 1)}`;
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

    return res.status(200).json({ ok: true, day: DAY, rank, total, percentile });
  } catch (err: any) {
    const unconfigured = err && err.message === "db_not_configured";
    return res
      .status(unconfigured ? 503 : 500)
      .json({ error: unconfigured ? "storage_unavailable" : "server_error" });
  }
}
