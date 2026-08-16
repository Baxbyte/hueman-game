import { getSql } from "./db.js";
import { compositeScore } from "./board.js";

// Realistic "holding" entries so a freshly-rolled day never looks empty for new
// players. Inserted lazily and idempotently for whichever day is viewed or
// submitted to. Real players intermix by score and climb above these over time.
//
// Each holder has a STABLE identity across days: pid = "seed-<poolIndex>" (not
// per-day), so the streak/trend feature treats them like genuine returning
// players. A holder "plays" ~80% of days (organic streak gaps), with a
// characteristic skill plus daily variance so scores trend up and down.
//
// Seed pids contain a hyphen, so they can never collide with a real player's pid
// (those must match /^[a-z0-9]{8,40}$/) and are easy to remove later
// (DELETE FROM scores WHERE pid LIKE 'seed-%').

// Plausible display names + ISO country codes (all in the allowlist).
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

// Strongest holder level — deliberately well below the game's cap so skilled
// real players can always overtake. Independent of LEVEL_MAX on purpose.
const SEED_TOP_LEVEL = 20;
const PLAY_PROB = 0.8; // chance a given holder appears on a given day

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

/** Deterministic holding rows for a given day (subset of the pool that "played"). */
export function seedRowsForDay(day: number): SeedRow[] {
  const rows: SeedRow[] = [];
  for (let pi = 0; pi < POOL.length; pi++) {
    // Per-(day,player) stream drives whether they played and how well.
    const rnd = mulberry32((day * 73856093) ^ (pi * 19349663) ^ 0x9e3779b9);
    if (rnd() > PLAY_PROB) continue; // sat this day out

    const [name, country] = POOL[pi];
    // Characteristic skill (stable per player) blended with daily variance, so
    // a holder's score wobbles up and down day to day around their own level.
    const baseSkill = mulberry32(pi * 2654435761 + 7)();
    const skill = clamp(baseSkill * 0.7 + rnd() * 0.3, 0, 1);

    const level = clamp(Math.round(5 + skill * (SEED_TOP_LEVEL - 5)), 4, SEED_TOP_LEVEL);
    const timeMs = clamp(
      Math.round(150_000 - skill * 115_000 + (rnd() - 0.5) * 22_000),
      12_000,
      300_000
    );

    rows.push({
      pid: `seed-${pi}`,
      name,
      country,
      level,
      timeMs,
      score: compositeScore(level, timeMs),
      // Deterministic, plausible "played earlier" timestamp (never surfaced).
      ts: 1_700_000_000_000 + day * 86_400_000 + pi * 137_000,
    });
  }
  return rows;
}

// Avoid redundant work within a warm instance; the DB check + ON CONFLICT keep
// it correct across instances and concurrent cold starts regardless.
const seededDays = new Set<number>();

export type Board = "daily" | "unlimited";

/**
 * Which boards still need holders, given what each already has.
 *
 * Deliberately checks the two boards independently. Inferring one board's state
 * from the other's is what left every pre-existing day with an empty Unlimited
 * board when that board was introduced: those days already had holders in
 * `scores`, so seeding short-circuited before `scores_unlimited` was ever considered.
 * Keeping this per-board means a future third board backfills the same way,
 * simply by being viewed.
 */
export function boardsToSeed(hasDaily: boolean, hasUnlimited: boolean): Board[] {
  const need: Board[] = [];
  if (!hasDaily) need.push("daily");
  if (!hasUnlimited) need.push("unlimited");
  return need;
}

/**
 * Idempotently ensure holding rows exist for `day` on both boards.
 *
 * Self-healing: a day whose Unlimited holders are missing gets them the next
 * time that day is viewed or submitted to, so no separate backfill is needed.
 */
export async function ensureSeeded(day: number): Promise<void> {
  if (seededDays.has(day)) return;
  const sql = getSql();

  // Existing holders are never rewritten (they may come from an earlier seeding
  // scheme); each board is only filled if it has none of its own.
  const [daily, unlimited] = (await Promise.all([
    sql`SELECT 1 FROM scores    WHERE day = ${day} AND pid LIKE 'seed-%' LIMIT 1`,
    sql`SELECT 1 FROM scores_unlimited WHERE day = ${day} AND pid LIKE 'seed-%' LIMIT 1`,
  ])) as unknown[][];

  const need = boardsToSeed(daily.length > 0, unlimited.length > 0);
  if (!need.length) {
    seededDays.add(day);
    return;
  }

  const rows = seedRowsForDay(day);
  const statements = rows.flatMap((r) => [
    ...(need.includes("daily")
      ? [
          sql`
            INSERT INTO scores (day, pid, name, country, level, time_ms, score, ts)
            VALUES (${day}, ${r.pid}, ${r.name}, ${r.country}, ${r.level}, ${r.timeMs}, ${r.score}, ${r.ts})
            ON CONFLICT (day, pid) DO NOTHING
          `,
        ]
      : []),
    // Holders appear on Unlimited too, with a single unboosted run — the same
    // rule real free players get, so an empty Unlimited board never greets a
    // player who just spent credits.
    ...(need.includes("unlimited")
      ? [
          sql`
            INSERT INTO scores_unlimited (day, pid, name, country, level, time_ms, score, runs, boosted, ts)
            VALUES (${day}, ${r.pid}, ${r.name}, ${r.country}, ${r.level}, ${r.timeMs}, ${r.score}, 1, false, ${r.ts})
            ON CONFLICT (day, pid) DO NOTHING
          `,
        ]
      : []),
  ]);

  if (statements.length) await sql.transaction(statements);
  seededDays.add(day);
}
