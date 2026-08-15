import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe webhook signature verification.
 *
 * Kept as a dependency-free pure function so it can be exercised directly:
 * this is the check standing between a forged HTTP request and free credits.
 */

/** Reject signatures older than this to blunt replay of a captured request. */
export const TOLERANCE_SEC = 5 * 60;

export function verifyStripeSignature(
  // Uint8Array rather than Buffer: Buffer's declared type varies over
  // ArrayBufferLike, which node:crypto's own signatures reject.
  payload: Uint8Array,
  header: string,
  secret: string,
  now: number = Date.now()
): boolean {
  const parts = new Map<string, string[]>();
  for (const kv of header.split(",")) {
    const i = kv.indexOf("=");
    if (i < 1) continue;
    const k = kv.slice(0, i).trim();
    const v = kv.slice(i + 1).trim();
    parts.set(k, [...(parts.get(k) ?? []), v]);
  }
  const t = parts.get("t")?.[0];
  const sigs = parts.get("v1") ?? [];
  if (!t || !sigs.length) return false;

  const age = Math.abs(Math.floor(now / 1000) - Number(t));
  if (!Number.isFinite(age) || age > TOLERANCE_SEC) return false;

  // Stripe signs the literal bytes `${t}.${body}` — the body must not have been
  // parsed and re-serialized anywhere upstream.
  const expected = createHmac("sha256", secret)
    .update(new Uint8Array(Buffer.concat([new Uint8Array(Buffer.from(t + ".")), payload])))
    .digest("hex");
  const exp = new Uint8Array(Buffer.from(expected));
  // Several v1 signatures can arrive at once during a secret rotation.
  return sigs.some((s) => {
    const got = new Uint8Array(Buffer.from(s));
    return got.length === exp.length && timingSafeEqual(got, exp);
  });
}
