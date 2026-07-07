// Codec for shareable result URLs (/r/[id]). A player's run is encoded ENTIRELY
// in the id — no database, which fits HUEMAN's no-accounts model. The id is a
// base64url payload of `day.level.cells`, where `cells` is one digit per level
// square: 0–5 = color bucket (see CELL_*), 6 = a missed level (⬛).
//
// The client (index.html) builds the same token inline; keep the two in sync.

export const LEVEL_CAP = 60; // matches the game's MAX_LEVEL
export const MAX_CELLS = 200; // generous sanity bound for a single run

// Color buckets, index-aligned across emoji + hex + the game's hueEmoji().
export const CELL_EMOJI = ["🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "⬛"] as const;
export const CELL_HEX = ["#E5484D", "#FF8A34", "#F2D024", "#46B45A", "#4FA8D8", "#9B5DE5", "#2A2A33"] as const;

/** Hue → color-bucket index, matching index.html's hueEmoji() thresholds. */
export function hueIndex(h: number): number {
  if (h < 15 || h >= 345) return 0;
  if (h < 45) return 1;
  if (h < 70) return 2;
  if (h < 165) return 3;
  if (h < 255) return 4;
  if (h < 345) return 5;
  return 4;
}

export type DecodedResult = { day: number; level: number; cells: number[] };

function toBase64Url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function fromBase64Url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

/** Encode a run into a URL id. (Server-side mirror of the client encoder.) */
export function encodeResult(day: number, level: number, cells: number[]): string {
  return toBase64Url(`${day}.${level}.${cells.join("")}`);
}

/** Decode + validate a URL id. Returns null on anything malformed. */
export function decodeResult(id: string): DecodedResult | null {
  if (!id || id.length > 400 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  let raw: string;
  try {
    raw = fromBase64Url(id);
  } catch {
    return null;
  }
  const m = /^(\d+)\.(\d+)\.(\d*)$/.exec(raw);
  if (!m) return null;
  const day = Number(m[1]);
  const level = Number(m[2]);
  const cellStr = m[3];
  if (!Number.isInteger(day) || day < 1 || day > 100000) return null;
  if (!Number.isInteger(level) || level < 1 || level > LEVEL_CAP) return null;
  if (cellStr.length > MAX_CELLS) return null;
  const cells: number[] = [];
  for (const ch of cellStr) {
    const d = ch.charCodeAt(0) - 48;
    if (d < 0 || d > 6) return null;
    cells.push(d);
  }
  return { day, level, cells };
}

/** Rebuild the emoji grid string (5 per row) from decoded cells. */
export function cellsToEmojiGrid(cells: number[]): string {
  let out = "";
  let row = 0;
  for (const c of cells) {
    out += CELL_EMOJI[c] ?? "⬛";
    if (++row === 5) {
      out += "\n";
      row = 0;
    }
  }
  return out.trim();
}
