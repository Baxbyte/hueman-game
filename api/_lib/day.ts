// Daily puzzle identifier — kept in sync with the client (index.html) and api/og.ts.
// Puzzle #1 is the launch day; every player worldwide shares the same DAY for a
// given calendar day in UTC.
export const EPOCH_UTC = Date.UTC(2026, 5, 11); // 2026-06-11 = puzzle #1

/** Day number for "right now" in UTC (1-based). */
export function currentDay(now: Date = new Date()): number {
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(1, Math.floor((todayUTC - EPOCH_UTC) / 86400000) + 1);
}

/** Seconds remaining until the next UTC midnight (used for per-day key TTLs). */
export function secsToMidnight(now: Date = new Date()): number {
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(60, Math.floor((todayUTC + 86400000 - now.getTime()) / 1000));
}
