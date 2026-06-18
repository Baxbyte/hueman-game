import { getSql } from "./db.js";
import { compositeScore, LEVEL_MAX } from "./board.js";

// Realistic "holding" entries so a freshly-rolled day never looks empty for new
// players. They are inserted lazily and idempotently for whichever day is being
// viewed or submitted to, so today, the backlog, and every future day stay
// populated with no maintenance. Real players intermix by score and climb above
// these over time. Seed rows use a "seed-<day>-<i>" pid, which can never collide
// with a real player's pid (those must match /^[a-z0-9]{8,40}$/), so they are
// easy to identify and remove later.

// A pool of plausible display names + ISO country codes (all in the allowlist).
const POOL: ReadonlyArray<readonly [string, string]> = [
  ["Maya", "US"], ["Liam", "GB"], ["Sofia", "BR"], ["Kenji", "JP"],
  ["Aria", "CA"], ["Noah", "DE"], ["Lucas", "FR"], ["Emma", "NL"],
  ["Hugo", "ES"], ["Mia", "AU"], ["Yuki", "JP"], ["Diego", "MX"],
  ["Nina", "IT"], ["Omar", "AE"], ["Ravi", "IN"], ["Chloe", "IE"],
  ["Ivan", "PL"], ["Lena", "SE"], ["Theo", "GR"], ["Zara", "ZA"],
  ["Felix", "AT"], ["Aisha", "NG"], ["Marco", "CH"], ["Priya", "IN"],
  ["Jonas", "DK"], ["Elif", "TR"], ["Sora", "KR"], ["Mateo", "AR"],
  ["Freya", "NO"], ["Tariq", "SG"],
];

// Small, fast, deterministic PRNG so each day's board is stable across requests
// (no flicker) yet varies day to day.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SeedRow = {
  pid: string;
  name: string;
  country: string;
  level: number;
  timeMs: number;
  score: number;
  ts: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Deterministic set of holding rows for a given day, ordered best-first. */
export function seedRowsForDay(day: number): SeedRow[] {
  const rnd = mulberry32(day * 2654435761 + 12345);

  // Deterministic shuffle of the name pool so leaders differ day to day.
  const pool = POOL.map((p) => [...p] as [string, string]);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const count = 20 + Math.floor(rnd() * 7); // 20–26 holders
  const now = Date.now();
  const rows: SeedRow[] = [];
  for (let i = 0; i < count; i++) {
    const [name, country] = pool[i % pool.length];
    const frac = count > 1 ? i / (count - 1) : 0; // 0 = top, 1 = bottom

    // Top holder caps at LEVEL_MAX-5 (~20) so skilled real players can always
    // overtake; levels taper down the board with a little noise.
    const level = clamp(
      Math.round(LEVEL_MAX - 5 - frac * 11 + (rnd() - 0.5) * 2),
      5,
      LEVEL_MAX - 3
    );
    // Faster times near the top; ~30s..150s with noise.
    const timeMs = clamp(
      Math.round(30_000 + frac * 120_000 + (rnd() - 0.5) * 18_000),
      3_000,
      600_000
    );

    rows.push({
      pid: `seed-${day}-${i}`,
      name,
      country,
      level,
      timeMs,
      score: compositeScore(level, timeMs),
      // Plausible "earlier today" timestamps (not surfaced to clients).
      ts: now - (count - i) * 90_000,
    });
  }
  return rows;
}

// Avoid redundant work within a warm function instance; ON CONFLICT keeps it
// correct across instances and concurrent cold starts regardless.
const seededDays = new Set<number>();

/** Idempotently ensure the holding rows exist for `day`. */
export async function ensureSeeded(day: number): Promise<void> {
  if (seededDays.has(day)) return;
  const sql = getSql();
  const rows = seedRowsForDay(day);
  await sql.transaction(
    rows.map(
      (r) => sql`
        INSERT INTO scores (day, pid, name, country, level, time_ms, score, ts)
        VALUES (${day}, ${r.pid}, ${r.name}, ${r.country}, ${r.level}, ${r.timeMs}, ${r.score}, ${r.ts})
        ON CONFLICT (day, pid) DO NOTHING
      `
    )
  );
  seededDays.add(day);
}
