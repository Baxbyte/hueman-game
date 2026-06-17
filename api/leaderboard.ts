import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql, ensureSchema } from "./_lib/db.js";
import { currentDay } from "./_lib/day.js";
import { TOP_N, RETENTION_DAYS, rankForScore } from "./_lib/board.js";

function qInt(v: VercelRequest["query"][string]): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

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

  const pid = typeof req.query.pid === "string" ? req.query.pid : "";
  const geoRaw = req.headers["x-vercel-ip-country"];
  const geo = (Array.isArray(geoRaw) ? geoRaw[0] : geoRaw) || "";

  try {
    await ensureSchema();
    const sql = getSql();

    // Top N entries (highest composite score first) with their display meta.
    const rows = (await sql`
      SELECT name, country, level, time_ms
      FROM scores
      WHERE day = ${day}
      ORDER BY score DESC
      LIMIT ${TOP_N}
    `) as { name: string; country: string; level: number; time_ms: number }[];

    const top = rows.map((r, i) => ({
      rank: i + 1,
      name: r.name ?? "Anonymous",
      country: r.country ?? "ZZ",
      level: r.level ?? 0,
      timeMs: r.time_ms ?? 0,
    }));

    const totalRows = (await sql`
      SELECT count(*)::int AS total FROM scores WHERE day = ${day}
    `) as { total: number }[];
    const total = totalRows[0]?.total ?? 0;

    let me: { rank: number; level: number; timeMs: number } | null = null;
    if (pid) {
      const meRows = (await sql`
        SELECT score, level, time_ms FROM scores WHERE day = ${day} AND pid = ${pid}
      `) as { score: number; level: number; time_ms: number }[];
      const row = meRows[0];
      if (row) {
        me = {
          rank: await rankForScore(day, Number(row.score)),
          level: row.level ?? 0,
          timeMs: row.time_ms ?? 0,
        };
      }
    }

    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=15");
    return res.status(200).json({ day, total, top, me, geo });
  } catch (err: any) {
    const unconfigured = err && err.message === "db_not_configured";
    return res
      .status(unconfigured ? 503 : 500)
      .json({ error: unconfigured ? "storage_unavailable" : "server_error", day, geo });
  }
}
