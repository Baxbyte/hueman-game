import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql, ensureSchema } from "./_lib/db.js";
import { currentDay } from "./_lib/day.js";
import {
  TOP_N,
  RETENTION_DAYS,
  rankForScore,
  rankForScoreUnlimited,
  computeStreakTrend,
  asBoardKind,
  type Trend,
} from "./_lib/board.js";
import { ensureSeeded } from "./_lib/seed.js";

/**
 * GET /api/leaderboard?day=&pid=&board=daily|unlimited
 *
 *  - `daily` (default): every player's first, unassisted run. The original
 *    board, unchanged — credits cannot put a row on it or move one.
 *  - `unlimited`: best run of the day from anyone, including credit-funded
 *    extra runs. Free players appear here too, with their single attempt.
 */

function qInt(v: VercelRequest["query"][string]): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

type Row = {
  pid: string;
  name: string;
  country: string;
  level: number;
  time_ms: number;
  runs?: number;
  boosted?: boolean;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const today = currentDay();
  // Default to today; allow viewing recent days only (within the retention window).
  const requested = qInt(req.query.day);
  const day =
    requested != null && requested <= today && requested >= today - (RETENTION_DAYS - 1)
      ? requested
      : today;

  const board = asBoardKind(Array.isArray(req.query.board) ? req.query.board[0] : req.query.board);
  const unlimited = board === "unlimited";

  const pid = typeof req.query.pid === "string" ? req.query.pid : "";
  const geoRaw = req.headers["x-vercel-ip-country"];
  const geo = (Array.isArray(geoRaw) ? geoRaw[0] : geoRaw) || "";

  try {
    await ensureSchema();
    const sql = getSql();

    // Keep the viewed day populated with holding entries so it's never empty.
    await ensureSeeded(day);

    // Top N entries (highest composite score first) with their display meta.
    const rows = (unlimited
      ? await sql`
          SELECT pid, name, country, level, time_ms, runs, boosted
          FROM scores_unlimited
          WHERE day = ${day}
          ORDER BY score DESC
          LIMIT ${TOP_N}
        `
      : await sql`
          SELECT pid, name, country, level, time_ms
          FROM scores
          WHERE day = ${day}
          ORDER BY score DESC
          LIMIT ${TOP_N}
        `) as Row[];

    // Pull each entrant's recent per-day scores once, to derive day-streak and
    // whether their score is trending up or down vs their previous appearance.
    const histRows = (unlimited
      ? await sql`
          SELECT pid, day, score FROM scores_unlimited
          WHERE day <= ${day} AND day > ${day - RETENTION_DAYS}
        `
      : await sql`
          SELECT pid, day, score FROM scores
          WHERE day <= ${day} AND day > ${day - RETENTION_DAYS}
        `) as { pid: string; day: number; score: number | string }[];

    const byPid = new Map<string, Map<number, number>>();
    for (const h of histRows) {
      let m = byPid.get(h.pid);
      if (!m) byPid.set(h.pid, (m = new Map()));
      m.set(h.day, Number(h.score));
    }

    const streakTrend = (id: string): { streak: number; trend: Trend } =>
      computeStreakTrend(byPid.get(id) ?? new Map(), day, RETENTION_DAYS);

    const top = rows.map((r, i) => {
      const st = streakTrend(r.pid);
      return {
        rank: i + 1,
        name: r.name ?? "Anonymous",
        country: r.country ?? "ZZ",
        level: r.level ?? 0,
        timeMs: r.time_ms ?? 0,
        streak: st.streak,
        trend: st.trend,
        ...(unlimited ? { runs: r.runs ?? 1, boosted: !!r.boosted } : {}),
      };
    });

    const totalRows = (unlimited
      ? await sql`SELECT count(*)::int AS total FROM scores_unlimited WHERE day = ${day}`
      : await sql`SELECT count(*)::int AS total FROM scores WHERE day = ${day}`) as {
      total: number;
    }[];
    const total = totalRows[0]?.total ?? 0;

    let me:
      | {
          rank: number;
          level: number;
          timeMs: number;
          streak: number;
          trend: Trend;
          runs?: number;
        }
      | null = null;
    if (pid) {
      const meRows = (unlimited
        ? await sql`
            SELECT score, level, time_ms, runs FROM scores_unlimited
            WHERE day = ${day} AND pid = ${pid}
          `
        : await sql`
            SELECT score, level, time_ms FROM scores WHERE day = ${day} AND pid = ${pid}
          `) as { score: number; level: number; time_ms: number; runs?: number }[];
      const row = meRows[0];
      if (row) {
        const st = streakTrend(pid);
        me = {
          rank: unlimited
            ? await rankForScoreUnlimited(day, Number(row.score))
            : await rankForScore(day, Number(row.score)),
          level: row.level ?? 0,
          timeMs: row.time_ms ?? 0,
          streak: st.streak,
          trend: st.trend,
          ...(unlimited ? { runs: row.runs ?? 1 } : {}),
        };
      }
    }

    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=15");
    return res.status(200).json({ day, board, total, top, me, geo });
  } catch (err: any) {
    const unconfigured = err && err.message === "db_not_configured";
    return res
      .status(unconfigured ? 503 : 500)
      .json({ error: unconfigured ? "storage_unavailable" : "server_error", day, board, geo });
  }
}
