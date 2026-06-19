// Rated-G display-name guardrails for the leaderboard. Layered and best-effort:
// normalize -> strip unsafe -> restrict charset -> fold leetspeak/repeats ->
// screen against a profanity/slur denylist and spam/URL/promo signals.
// Returns a safe display name, or null if the name should be rejected.
// Empty/garbage input falls back to "Anonymous".

const MAX_LEN = 16;
const MIN_LETTERS = 2;

// Control chars (C0/C1), soft hyphen, zero-width + bidi marks, word joiner, BOM.
const UNSAFE = new RegExp(
  "[\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200F\\u2028\\u2029\\u2060\\uFEFF]",
  "g"
);

// Matched against the folded signature (lowercased, leet-folded, letters-only,
// runs collapsed). Substring match — strict by design ("block all bad words"),
// which can occasionally catch an innocent lookalike; we accept that for a G rating.
const BAD = [
  // slurs / hate
  "nigger", "nigga", "faggot", "retard", "kike", "spic", "chink", "wetback",
  "tranny", "gook", "coon", "beaner", "raghead", "dyke", "negro",
  // profanity
  "fuck", "shit", "bitch", "bastard", "asshole", "arsehole", "cunt", "prick",
  "wanker", "bollocks", "bugger", "crap", "cock", "pussy", "twat", "slut",
  "whore", "douche", "piss", "dildo",
  // sexual (keep it G)
  "sex", "porn", "porno", "onlyfans", "xxx", "anal", "blowjob", "boob", "tits",
  "titty", "nude", "milf", "hentai", "horny", "orgasm", "penis", "vagina",
  "handjob", "rimjob", "creampie", "bukkake", "masturbat", "cumshot",
  // violence / hate ideology / abuse
  "nazi", "hitler", "kkk", "rapist", "molest", "pedo", "pedophile", "incest",
  "terrorist", "genocide", "lynch",
  // drugs
  "cocaine", "heroin", "meth", "marijuana", "ecstasy",
  // self-harm
  "suicide",
];

// Spam / promo tokens (folded or raw match).
const SPAM = [
  "onlyfan", "telegram", "whatsapp", "discord", "crypto", "bitcoin", "casino",
  "viagra", "cialis", "gambl", "betting", "forex", "airdrop", "giveaway",
  "subscribe", "promo",
];

// URL / handle / domain shapes in the raw name.
const URLISH =
  /(https?:|www\.|\.(com|net|org|io|xyz|ru|info|biz|link|gg|me|co|app|shop|store|online|site)\b|t\.me|@[a-z0-9_]{3,})/i;

// Leet/homoglyph folding so "n1gg3r", "sh!t", "@ss" don't slip through.
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "2": "z", "3": "e", "4": "a", "5": "s", "6": "g",
  "7": "t", "8": "b", "9": "g", "@": "a", "$": "s", "!": "i", "|": "i",
  "+": "t", "(": "c", "€": "e", "£": "l",
};

function stripUnsafe(s: string): string {
  return s.normalize("NFKC").replace(UNSAFE, "").replace(/\s+/g, " ").trim();
}

// Collapse a name to a comparison signature: lowercase, "ph"->"f", leet->letter,
// drop non-letters, then collapse 3+ repeats so "fuuuck"/"f.u.c.k"/"phuck" match.
function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ph/g, "f")
    .replace(/[0-9@$!|+()€£]/g, (c) => LEET[c] ?? "")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1{2,}/g, "$1");
}

function isBlocked(folded: string, raw: string): boolean {
  if (BAD.some((w) => folded.includes(w))) return true;
  const low = raw.toLowerCase();
  if (URLISH.test(low)) return true;
  if (SPAM.some((w) => folded.includes(w) || low.includes(w))) return true;
  return false;
}

export function sanitizeName(input: unknown): string | null {
  if (typeof input !== "string") return "Anonymous";

  // Screen for profanity/spam on the RICH form first, before the charset filter
  // strips leet symbols (!, @, $) that the fold relies on (e.g. "b!tch", "@spam").
  const raw = stripUnsafe(input);
  if (!raw) return "Anonymous";
  if (isBlocked(fold(raw), raw)) return null;

  // Display form: letters (incl. accented), digits, spaces and a few separators.
  const n = raw.replace(/[^\p{L}\p{N} ._'-]/gu, "").slice(0, MAX_LEN).trim();
  if (!n) return "Anonymous";

  const letters = (n.match(/\p{L}/gu) || []).length;
  // Reject obvious spam/garbage shapes.
  if (letters < MIN_LETTERS) return null;                 // needs real letters
  if (/(.)\1{4,}/.test(n)) return null;                   // 5+ identical in a row
  if ((n.match(/[0-9]/g) || []).length > letters) return null; // digit soup
  if (/[._'\-]{3,}/.test(n)) return null;                 // separator spam
  // Re-screen the cleaned form too (catches words formed only after stripping).
  if (isBlocked(fold(n), n)) return null;

  return n;
}
