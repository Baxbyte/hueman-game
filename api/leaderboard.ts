import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql, ensureSchema } from "./_lib/db.js";
import { currentDay } from "./_lib/day.js";
import { TOP_N, RETENTION_DAYS, rankForScore, compositeScore } from "./_lib/board.js";

// TEMPORARY: write-path self-test, exercised via ?selftest=1, on an isolated
// synthetic day that real queries never touch. Cleans up after itself. Removed
// once the Neon port is verified.
async function runSelfTest(res: VercelResponse) {
  const steps: Record<string, unknown> = {};
  try {
    await ensureSchema();
    const sql = getSql();
    steps.schema = "ok";
    const TEST_DAY = 999_999;
    const pid = "selftest" + Math.random().toString(36).slice(2, 10);
    const score = compositeScore(13, 31234);
    await sql`
      INSERT INTO scores (day, pid, name, country, level, time_ms, score, ts)
      VALUES (${TEST_DAY}, ${pid}, ${"SelfTest"}, ${"US"}, ${13}, ${31234}, ${score}, ${Date.now()})
      ON CONFLICT (day, pid) DO UPDATE SET score = EXCLUDED.score
      WHERE EXCLUDED.score > scores.score
    `;
    steps.insert = "ok";
    const back = (await sql`
      SELECT name, country, level, time_ms, score FROM scores
      WHERE day = ${TEST_DAY} AND pid = ${pid}
    `) as any[];
    steps.readBack = back[0] ?? null;
    steps.rank = await rankForScore(TEST_DAY, score);
    const del = (await sql`DELETE FROM scores WHERE day = ${TEST_DAY} RETURNING pid`) as any[];
    steps.cleanedUp = del.length;
    return res.status(200).json({ ok: true, steps });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message, steps });
  }
}

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

  if (req.query.selftest === "1") return runSelfTest(res);

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
