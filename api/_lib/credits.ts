import { getSql } from "./db.js";
import { currentDay } from "./day.js";

/**
 * Credits — the optional layer on top of a game that stays completely free.
 *
 * Ground rules, encoded here so they can't drift:
 *  - The free run is untouched: 3 lives, standard clock, one ranked attempt a
 *    day, and it is the ONLY thing that can appear on the Daily board.
 *  - Credits buy *more attempts* at the same puzzle (and optional handicaps on
 *    those attempts), which compete on the separate Overdrive board.
 *  - Every wallet is created with WELCOME_CREDITS, so the first extra run is
 *    always free. Nobody hits a price tag before they've tried the thing.
 */

/** Credits granted the first time a player's wallet is created. */
export const WELCOME_CREDITS = 3;

/** What a credit buys. Costs are deliberately small multiples of a rerun. */
export const SPEND = {
  // A full extra ranked attempt at today's puzzle (Overdrive board).
  rerun: { credits: 3, label: "Extra run" },
  // Start the run with 4 lives instead of 3. Stacks to a hard cap of 5.
  life: { credits: 2, label: "Extra life" },
  // Every level's clock runs 40% longer for this run.
  slowclock: { credits: 2, label: "Slow clock" },
} as const;

export type SpendItem = keyof typeof SPEND;
export const SPEND_ITEMS = Object.keys(SPEND) as SpendItem[];
export function isSpendItem(v: unknown): v is SpendItem {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SPEND, v);
}

/** Hard ceilings on what a single run can be boosted to. */
export const MAX_LIVES = 5;
export const BASE_LIVES = 3;
export const SLOW_CLOCK_MULT = 1.4;

/**
 * Credit packs.
 *
 * Priced off two anchors from the market: the $0.99–$1.99 impulse band casual
 * games use for "keep playing" (Candy Crush's 5-extra-moves prompt), and the
 * ~$40/yr that NYT Games, Puzzmo Plus and GeoGuessr Pro all land on for a daily
 * puzzle habit. Sub-$1 is deliberately absent: a $0.99 charge loses ~30% to
 * fixed processing, so the entry tier starts at $1.99.
 *
 * Per-credit price falls across tiers (19.9¢ → 8¢) so the ladder always rewards
 * trading up, and the top tier doubles as the price anchor for everything below.
 */
export type Pack = {
  sku: string;
  credits: number;
  /** Price in the smallest currency unit (cents). */
  amount: number;
  name: string;
  blurb: string;
  /** Optional merchandising badge. */
  badge?: string;
};

export const PACKS: readonly Pack[] = [
  {
    sku: "hue10",
    credits: 10,
    amount: 199,
    name: "10 credits",
    blurb: "3 extra runs",
  },
  {
    sku: "hue30",
    credits: 30,
    amount: 499,
    name: "30 credits",
    blurb: "10 extra runs",
    badge: "Most popular",
  },
  {
    sku: "hue100",
    credits: 100,
    amount: 1299,
    name: "100 credits",
    blurb: "33 extra runs",
    badge: "Best value",
  },
  {
    sku: "hue500",
    credits: 500,
    amount: 3999,
    name: "500 credits",
    blurb: "A year of Overdrive",
  },
];

export const CURRENCY = "usd";

export function packForSku(sku: unknown): Pack | null {
  if (typeof sku !== "string") return null;
  return PACKS.find((p) => p.sku === sku) ?? null;
}

/** Public shape of a pack for the client store (no server-only fields today). */
export function publicPacks() {
  return PACKS.map((p) => ({
    sku: p.sku,
    credits: p.credits,
    amount: p.amount,
    currency: CURRENCY,
    name: p.name,
    blurb: p.blurb,
    badge: p.badge ?? null,
  }));
}

/**
 * Per-IP, per-day counter on top of the existing rate_limits table.
 *
 * `bucket` is prefixed into the ip column so each limiter gets its own tally
 * and none of them interfere with the score submission limit. Returns true
 * while the caller is still under `limit`.
 */
export async function underLimit(
  day: number,
  bucket: string,
  ip: string,
  limit: number
): Promise<boolean> {
  const rows = (await getSql()`
    INSERT INTO rate_limits (day, ip, n) VALUES (${day}, ${bucket + ":" + ip}, 1)
    ON CONFLICT (day, ip) DO UPDATE SET n = rate_limits.n + 1
    RETURNING n
  `) as { n: number }[];
  return (rows[0]?.n ?? 0) <= limit;
}

export const PID_RE = /^[a-z0-9]{8,40}$/i;
/** Restore codes are shown to humans, so avoid 0/O/1/I ambiguity. */
const RESTORE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY34679";
export const RESTORE_RE = /^[ACDEFGHJKLMNPQRTUVWXY34679]{4}-[ACDEFGHJKLMNPQRTUVWXY34679]{4}$/;

function randomRestore(): string {
  const bytes = new Uint8Array(8);
  (globalThis.crypto as Crypto).getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => RESTORE_ALPHABET[b % RESTORE_ALPHABET.length]);
  return chars.slice(0, 4).join("") + "-" + chars.slice(4).join("");
}

export type Wallet = { pid: string; credits: number; restore: string; fresh: boolean };

/**
 * Fetch a wallet, creating it (with the welcome grant) on first sight.
 *
 * The insert and the welcome ledger row are both conditional on the wallet not
 * already existing, so a double-tap on the store can't mint free credits.
 */
export async function getWallet(pid: string): Promise<Wallet> {
  const sql = getSql();
  const now = Date.now();

  const created = (await sql`
    INSERT INTO wallets (pid, credits, restore, created, updated)
    VALUES (${pid}, ${WELCOME_CREDITS}, ${randomRestore()}, ${now}, ${now})
    ON CONFLICT (pid) DO NOTHING
    RETURNING pid, credits, restore
  `) as { pid: string; credits: number; restore: string }[];

  if (created.length) {
    await sql`
      INSERT INTO credit_ledger (pid, day, kind, item, delta, ref, ts)
      VALUES (${pid}, ${currentDay()}, 'grant', 'welcome', ${WELCOME_CREDITS},
              ${"welcome:" + pid}, ${now})
      ON CONFLICT (ref) WHERE ref IS NOT NULL DO NOTHING
    `;
    return { ...created[0], fresh: true };
  }

  const rows = (await sql`
    SELECT pid, credits, restore FROM wallets WHERE pid = ${pid}
  `) as { pid: string; credits: number; restore: string }[];
  // The INSERT conflicted, so a row exists; the fallback only guards a racing
  // delete, which nothing in the app does.
  return rows[0] ? { ...rows[0], fresh: false } : { pid, credits: 0, restore: "", fresh: false };
}

/**
 * Move a paid balance onto a new pid. Used when a player clears site data or
 * picks the game back up on another device — the no-account equivalent of a
 * login. The old wallet is drained rather than deleted so the ledger still
 * reconciles, and the restore code follows the credits.
 */
export async function restoreWallet(code: string, toPid: string): Promise<Wallet | null> {
  const sql = getSql();
  const now = Date.now();
  const norm = code.trim().toUpperCase();
  if (!RESTORE_RE.test(norm)) return null;

  const src = (await sql`
    SELECT pid, credits FROM wallets WHERE restore = ${norm}
  `) as { pid: string; credits: number }[];
  const from = src[0];
  if (!from) return null;
  if (from.pid === toPid) return getWallet(toPid);

  // Make sure the destination exists first (and takes its welcome grant, if new).
  await getWallet(toPid);

  const moved = from.credits;
  await sql.transaction([
    sql`UPDATE wallets SET credits = 0, updated = ${now} WHERE pid = ${from.pid}`,
    sql`UPDATE wallets
        SET credits = credits + ${moved}, restore = ${norm}, updated = ${now}
        WHERE pid = ${toPid}`,
    // Give the drained wallet a new code so the old one can't be replayed.
    sql`UPDATE wallets SET restore = ${randomRestore()} WHERE pid = ${from.pid}`,
    sql`INSERT INTO credit_ledger (pid, day, kind, item, delta, ref, ts)
        VALUES (${from.pid}, ${currentDay()}, 'restore-out', ${toPid}, ${-moved}, NULL, ${now})`,
    sql`INSERT INTO credit_ledger (pid, day, kind, item, delta, ref, ts)
        VALUES (${toPid}, ${currentDay()}, 'restore-in', ${from.pid}, ${moved}, NULL, ${now})`,
  ]);

  const rows = (await sql`
    SELECT pid, credits, restore FROM wallets WHERE pid = ${toPid}
  `) as { pid: string; credits: number; restore: string }[];
  return rows[0] ? { ...rows[0], fresh: false } : null;
}

/**
 * Credit a purchase exactly once.
 *
 * Idempotency rides on the unique index over credit_ledger.ref: Stripe retries
 * webhooks freely, and a redelivery inserts zero rows and therefore adds zero
 * credits. Returns the new balance, or null if this ref was already applied.
 */
export async function creditPurchase(
  pid: string,
  sku: string,
  credits: number,
  ref: string
): Promise<number | null> {
  const sql = getSql();
  const now = Date.now();

  await getWallet(pid); // ensure the row exists before we increment it

  const applied = (await sql`
    INSERT INTO credit_ledger (pid, day, kind, item, delta, ref, ts)
    VALUES (${pid}, ${currentDay()}, 'purchase', ${sku}, ${credits}, ${ref}, ${now})
    ON CONFLICT (ref) WHERE ref IS NOT NULL DO NOTHING
    RETURNING id
  `) as { id: string }[];
  if (!applied.length) return null; // already processed

  const rows = (await sql`
    UPDATE wallets SET credits = credits + ${credits}, updated = ${now}
    WHERE pid = ${pid}
    RETURNING credits
  `) as { credits: number }[];
  return rows[0]?.credits ?? null;
}

/**
 * Debit a spend atomically. The guarded UPDATE means two concurrent requests
 * can never take the balance negative — the loser matches zero rows and is
 * reported back as insufficient funds.
 */
export async function debit(
  pid: string,
  item: string,
  cost: number,
  day: number
): Promise<number | null> {
  const sql = getSql();
  const now = Date.now();

  const rows = (await sql`
    UPDATE wallets SET credits = credits - ${cost}, updated = ${now}
    WHERE pid = ${pid} AND credits >= ${cost}
    RETURNING credits
  `) as { credits: number }[];
  if (!rows.length) return null;

  await sql`
    INSERT INTO credit_ledger (pid, day, kind, item, delta, ref, ts)
    VALUES (${pid}, ${day}, 'spend', ${item}, ${-cost}, NULL, ${now})
  `;
  return rows[0].credits;
}

/** Put credits back when a debited run could not be issued. */
export async function refund(pid: string, item: string, cost: number, day: number): Promise<void> {
  const sql = getSql();
  const now = Date.now();
  await sql`
    UPDATE wallets SET credits = credits + ${cost}, updated = ${now} WHERE pid = ${pid}
  `;
  await sql`
    INSERT INTO credit_ledger (pid, day, kind, item, delta, ref, ts)
    VALUES (${pid}, ${day}, 'refund', ${item}, ${cost}, NULL, ${now})
  `;
}
