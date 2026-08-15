import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Run tokens — proof that a boosted/extra run was actually paid for.
 *
 * /api/spend debits credits and mints one of these; /api/score will only file a
 * result on the Overdrive board if it arrives with a valid, unexpired token for
 * that pid + day + run number. Without a token a submission is treated as the
 * player's one free run and lands on the Daily board.
 *
 * This is a spend gate, not an anti-cheat: the game is a static page, so a
 * determined player can always post whatever level they like. What the token
 * does buy is that credits can't be forged and a single purchase can't be
 * replayed into unlimited Overdrive entries.
 */

const TTL_MS = 2 * 60 * 60 * 1000; // a run has two hours to be filed

function secret(): string {
  // A dedicated secret is preferred; falling back to the database URL keeps
  // tokens working with zero extra configuration, since it is already a
  // server-only value that is stable across deployments.
  const s = process.env.HUEMAN_RUN_SECRET || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!s) throw new Error("run_secret_unavailable");
  return s;
}

export type RunClaims = {
  pid: string;
  day: number;
  /** 1-based index of this extra run within the day. */
  n: number;
  lives: number;
  /** Clock multiplier ×100, so the token stays integer-only. */
  m: number;
};

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(body: string): string {
  return b64url(createHmac("sha256", secret()).update(body).digest());
}

export function mintRunToken(c: RunClaims): string {
  const payload = { ...c, e: Date.now() + TTL_MS };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return body + "." + sign(body);
}

/** Verify a token and return its claims, or null if it is invalid or expired. */
export function verifyRunToken(token: unknown): RunClaims | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return null;
  }
  // Compare as plain Uint8Arrays: Buffer's typing varies over ArrayBufferLike,
  // which timingSafeEqual's signature won't accept.
  const a = new Uint8Array(Buffer.from(mac));
  const b = new Uint8Array(Buffer.from(expected));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p?.e !== "number" || Date.now() > p.e) return null;
    if (typeof p.pid !== "string" || typeof p.day !== "number") return null;
    if (typeof p.n !== "number" || typeof p.lives !== "number" || typeof p.m !== "number") {
      return null;
    }
    return { pid: p.pid, day: p.day, n: p.n, lives: p.lives, m: p.m };
  } catch {
    return null;
  }
}
