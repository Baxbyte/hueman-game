import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getKv } from "./_lib/kv.js";
import { currentDay, secsToMidnight } from "./_lib/day.js";
import { normalizeCountry } from "./_lib/countries.js";
import { sanitizeName } from "./_lib/name.js";
import {
  TTL_SECONDS,
  LEVEL_MIN,
  LEVEL_MAX,
  TIME_MIN,
  TIME_MAX,
  lbKey,
  metaKey,
  compositeScore,
  rankForScore,
  type MetaEntry,
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
    const kv = getKv();

    // Per-IP per-day rate limit (caps spray, not a determined attacker).
    const rlKey = `rl:${DAY}:${clientIp(req)}`;
    const n = await kv.incr(rlKey);
    if (n === 1) await kv.expire(rlKey, secsToMidnight());
    if (n > RATE_LIMIT) return res.status(429).json({ error: "rate_limited" });

    const score = compositeScore(level, timeMs);

    // One entry per player per day; only overwrite if this run is better.
    const existing = (await kv.zscore(lbKey(DAY), pid)) as number | null;
    if (existing == null || score > Number(existing)) {
      const meta: MetaEntry = { name, country, level, timeMs, ts: Date.now() };
      await kv.zadd(lbKey(DAY), { score, member: pid });
      await kv.set(metaKey(DAY, pid), meta, { ex: TTL_SECONDS });
      await kv.expire(lbKey(DAY), TTL_SECONDS);
    }

    const best = (await kv.zscore(lbKey(DAY), pid)) as number | null;
    const rank = best == null ? 0 : await rankForScore(DAY, Number(best));
    const total = await kv.zcard(lbKey(DAY));
    const percentile =
      total > 0 ? Math.max(1, Math.round((1 - (rank - 1) / total) * 100)) : 100;

    return res.status(200).json({ ok: true, day: DAY, rank, total, percentile });
  } catch (err: any) {
    const unconfigured = err && err.message === "kv_not_configured";
    return res
      .status(unconfigured ? 503 : 500)
      .json({ error: unconfigured ? "storage_unavailable" : "server_error" });
  }
}
