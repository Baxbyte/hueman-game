import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql, ensureSchema } from "./_lib/db.js";
import { compositeScore, rankForScore } from "./_lib/board.js";

// TEMPORARY diagnostic endpoint: exercises the full write path against an
// isolated synthetic day (never touched by real queries) and cleans up after
// itself. Used to verify the Neon port end-to-end, then removed.
const TEST_DAY = 999_999;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.query.run !== "1") {
    return res.status(400).json({ error: "pass ?run=1" });
  }
  const steps: Record<string, unknown> = {};
  try {
    await ensureSchema();
    const sql = getSql();
    steps.schema = "ok";

    const pid = "selftest" + Math.random().toString(36).slice(2, 10);
    const score = compositeScore(13, 31234);

    // Same upsert-if-better shape as POST /api/score.
    await sql`
      INSERT INTO scores (day, pid, name, country, level, time_ms, score, ts)
      VALUES (${TEST_DAY}, ${pid}, ${"SelfTest"}, ${"US"}, ${13}, ${31234}, ${score}, ${Date.now()})
      ON CONFLICT (day, pid) DO UPDATE SET
        name = EXCLUDED.name, country = EXCLUDED.country, level = EXCLUDED.level,
        time_ms = EXCLUDED.time_ms, score = EXCLUDED.score, ts = EXCLUDED.ts
      WHERE EXCLUDED.score > scores.score
    `;
    steps.insert = "ok";

    const back = (await sql`
      SELECT name, country, level, time_ms, score
      FROM scores WHERE day = ${TEST_DAY} AND pid = ${pid}
    `) as any[];
    steps.readBack = back[0] ?? null;

    steps.rank = await rankForScore(TEST_DAY, score);

    const del = (await sql`
      DELETE FROM scores WHERE day = ${TEST_DAY} RETURNING pid
    `) as any[];
    steps.cleanedUp = del.length;

    return res.status(200).json({ ok: true, steps });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message, steps });
  }
}
