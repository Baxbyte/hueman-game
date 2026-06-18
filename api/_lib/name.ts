// Best-effort display-name sanitization for the leaderboard. This is intentionally
// lightweight: a casual game doesn't need (and can't achieve) perfect moderation.
// We strip control/zero-width characters, clamp length, restrict to a friendly
// charset, and screen against a small substring denylist.

const MAX_LEN = 16;

// Small, conservative substring denylist. Matched case-insensitively against the
// name with non-letters removed. Not exhaustive by design.
const BAD = [
  "nigger", "nigga", "faggot", "retard", "cunt", "whore", "rape", "rapist",
  "nazi", "hitler", "kike", "spic", "chink", "wetback", "tranny", "molest",
  "pedo", "fuck", "shit", "bitch", "bastard", "pussy", "slut", "asshole",
];

// Control chars (C0/C1), soft hyphen, zero-width + bidi marks, word joiner, BOM.
const UNSAFE = new RegExp(
  "[\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200F\\u2028\\u2029\\u2060\\uFEFF]",
  "g"
);

function stripUnsafe(s: string): string {
  return s.replace(UNSAFE, "").replace(/\s+/g, " ").trim();
}

function isProfane(s: string): boolean {
  const flat = s.toLowerCase().replace(/[^a-z]/g, "");
  return BAD.some((w) => flat.includes(w));
}

/**
 * Returns a safe display name, or null if the input should be rejected
 * (e.g. profane). Empty/garbage input falls back to "Anonymous".
 */
export function sanitizeName(input: unknown): string | null {
  if (typeof input !== "string") return "Anonymous";
  // Allow letters (incl. accented), digits, spaces and a few separators.
  let n = stripUnsafe(input).replace(/[^\p{L}\p{N} ._'-]/gu, "");
  n = n.slice(0, MAX_LEN).trim();
  if (!n) return "Anonymous";
  if (isProfane(n)) return null;
  return n;
}
