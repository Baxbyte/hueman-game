// Shared daily-puzzle math for server-rendered pages (archive, result cards,
// OG images). Deliberately mirrors the inline copy in index.html and api/og.ts
// so every surface shows the SAME hue/motif for a given day. The client keeps
// its own inline copy (it can't import this TS module); this is the source of
// truth for everything rendered server-side.
import { EPOCH_UTC, currentDay } from "./day.js";

export { EPOCH_UTC, currentDay };

/** Same PRNG as the game — identical sequence for a given seed everywhere. */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grid dimension (n×n) for a level — matches index.html gridSize(). */
export function gridSize(level: number): number {
  if (level <= 2) return 2;
  if (level <= 5) return 3;
  if (level <= 9) return 4;
  if (level <= 14) return 5;
  return 6;
}

/** Perceptual gap for a level — matches index.html delta(). */
export function delta(level: number): { dL: number; dH: number } {
  const dL = Math.max(2.2, 20 * Math.pow(0.875, level - 1));
  const dH = Math.max(3, 16 * Math.pow(0.88, level - 1));
  return { dL, dH };
}

export type LevelColors = { base: string; odd: string; h: number; s: number; l: number };

/** Base + odd tile colors for a level, drawn from the given RNG stream. */
export function levelColors(rng: () => number, level: number): LevelColors {
  const h = Math.floor(rng() * 360);
  const s = 55 + Math.floor(rng() * 30);
  const l = 42 + Math.floor(rng() * 20);
  const { dL, dH } = delta(level);
  const sL = rng() < 0.5 ? -1 : 1;
  const sH = rng() < 0.5 ? -1 : 1;
  const base = `hsl(${h} ${s}% ${l}%)`;
  const oddL = Math.min(92, Math.max(8, l + sL * dL));
  const oddH = (h + sH * dH + 360) % 360;
  const odd = `hsl(${oddH} ${s}% ${oddL}%)`;
  return { base, odd, h, s, l };
}

/** The day's seed — identical to the game's `mulberry32(DAY*7919+13)`. */
export function daySeed(day: number): number {
  return day * 7919 + 13;
}

/** Today's brand accent hue for a day (level-1 hue, as the game tints the UI). */
export function brandHue(day: number): number {
  const rng = mulberry32(daySeed(day));
  return levelColors(rng, 1).h;
}

export type Motif = {
  base: string;
  odd: string;
  accent: string;
  oddIdx: number;
  tiles: string[]; // 16 hsl() strings for a 4×4 non-spoiler teaser
};

/**
 * A non-spoiler visual motif for a day: a 4×4 teaser at level-6 difficulty
 * (visible if you look, not trivial), matching the OG card's aesthetic. Safe
 * for archive/share pages — archive only ever shows COMPLETED days, and the
 * teaser difficulty never reveals the live puzzle's actual grid or answer.
 */
export function dayMotif(day: number): Motif {
  const rng = mulberry32(daySeed(day));
  const c = levelColors(rng, 6);
  // Round for tidy HTML source; visually identical to the game's tiles.
  const round = (hsl: string) => hsl.replace(/[\d.]+/g, (m) => String(Math.round(Number(m) * 10) / 10));
  const base = round(c.base);
  const odd = round(c.odd);
  const accent = `hsl(${c.h} 70% 55%)`;
  const oddIdx = Math.floor(rng() * 16);
  const tiles = Array.from({ length: 16 }, (_, i) => (i === oddIdx ? odd : base));
  return { base, odd, accent, oddIdx, tiles };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** UTC Date for the start of a given puzzle day. */
export function dateForDay(day: number): Date {
  return new Date(EPOCH_UTC + (day - 1) * 86400000);
}

/** "June 3, 2026" for a puzzle number. */
export function longDate(day: number): string {
  const d = dateForDay(day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "2026-06-03" (ISO date, for <time> and sitemap lastmod). */
export function isoDate(day: number): string {
  return dateForDay(day).toISOString().slice(0, 10);
}

/**
 * The highest puzzle number that may appear in the archive: only COMPLETED UTC
 * days. Today's puzzle (currentDay) is live, so the archive tops out at
 * currentDay − 1.
 */
export function lastArchivedDay(now: Date = new Date()): number {
  return currentDay(now) - 1;
}
