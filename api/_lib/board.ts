import { getSql } from "./db.js";

export const LEVEL_MIN = 1;
export const LEVEL_MAX = 60;
export const TIME_MIN = 200; // ms — sub-200ms for a real run is implausible
export const TIME_MAX = 3_600_000; // ms — cap at one hour

export const TOP_N = 50;

// Keep ~two weeks of days around so "yesterday" stays viewable and late
// stragglers still resolve, then prune older rows opportunistically on write.
export const RETENTION_DAYS = 14;

export type MetaEntry = {
  name: string;
  country: string;
  level: number;
  timeMs: number;
  ts: number;
};

/**
 * Composite sort score: level dominates (higher is better) and faster time
 * breaks ties. Time is clamped so it can never bleed into the level band above.
 * Stored as a bigint column, so we round to an integer here.
 */
export function compositeScore(level: number, timeMs: number): number {
  const t = Math.min(Math.max(timeMs, 0), 9_999_999);
  return Math.round(level * 1e7 - t / 1000);
}

export type Trend = "up" | "down" | "flat" | "new";

/**
 * Day-streak (consecutive days up to `day`) and score trend (vs the player's
 * most recent prior appearance) from their per-day scores. Pure + testable.
 */
export function computeStreakTrend(
  scoreByDay: Map<number, number>,
  day: number,
  window: number
): { streak: number; trend: Trend } {
  if (!scoreByDay.has(day)) return { streak: 0, trend: "new" };
  let streak = 0;
  for (let d = day; scoreByDay.has(d); d--) streak++;
  let prevDay: number | null = null;
  for (let d = day - 1; d > day - window; d--) {
    if (scoreByDay.has(d)) { prevDay = d; break; }
  }
  if (prevDay == null) return { streak, trend: "new" };
  const cur = scoreByDay.get(day)!;
  const prev = scoreByDay.get(prevDay)!;
  return { streak, trend: cur > prev ? "up" : cur < prev ? "down" : "flat" };
}

/** The two daily boards. `daily` is free first runs only; `overdrive` is best-of. */
export type BoardKind = "daily" | "overdrive";
export function asBoardKind(v: unknown): BoardKind {
  return v === "overdrive" ? "overdrive" : "daily";
}

/** 1-based rank within the day for a given composite score (1 = best). */
export async function rankForScore(day: number, score: number): Promise<number> {
  // Count entries strictly better (higher score) than this one.
  const rows = (await getSql()`
    SELECT count(*)::int AS better
    FROM scores
    WHERE day = ${day} AND score > ${score}
  `) as { better: number }[];
  return (rows[0]?.better ?? 0) + 1;
}

/** Same as rankForScore, against the Overdrive board. */
export async function rankForScoreOd(day: number, score: number): Promise<number> {
  const rows = (await getSql()`
    SELECT count(*)::int AS better
    FROM scores_od
    WHERE day = ${day} AND score > ${score}
  `) as { better: number }[];
  return (rows[0]?.better ?? 0) + 1;
}
