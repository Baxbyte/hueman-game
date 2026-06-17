import { kv } from "@vercel/kv";

// Keep daily keys around for two weeks so "yesterday" stays viewable and late
// stragglers still resolve, then let them auto-evict.
export const TTL_SECONDS = 14 * 24 * 60 * 60;

export const LEVEL_MIN = 1;
export const LEVEL_MAX = 25;
export const TIME_MIN = 200; // ms — sub-200ms for a real run is implausible
export const TIME_MAX = 3_600_000; // ms — cap at one hour

export const TOP_N = 50;

export type MetaEntry = {
  name: string;
  country: string;
  level: number;
  timeMs: number;
  ts: number;
};

export const lbKey = (day: number) => `lb:${day}`;
export const metaKey = (day: number, pid: string) => `meta:${day}:${pid}`;

/**
 * Composite sort score for a single sorted set: level dominates (higher is
 * better) and faster time breaks ties. Time is clamped so it can never bleed
 * into the level band above.
 */
export function compositeScore(level: number, timeMs: number): number {
  const t = Math.min(Math.max(timeMs, 0), 9_999_999);
  return level * 1e7 - t / 1000;
}

/** 1-based rank within the day for a given composite score (1 = best). */
export async function rankForScore(day: number, score: number): Promise<number> {
  // Count members strictly better (higher score) than this one.
  const better = await kv.zcount(lbKey(day), `(${score}`, "+inf");
  return (Number(better) || 0) + 1;
}
