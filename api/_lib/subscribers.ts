import { randomBytes } from "node:crypto";
import { getSql } from "./db.js";

// ───────────────────────── schema ─────────────────────────
//
// A STRICTLY ISOLATED daily-email list, separate from `scores`. Double opt-in:
// a row is created on signup with confirmed_at = NULL; the send cron only ever
// touches rows WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL.
// Timestamps are epoch-ms bigints to match the `scores.ts` convention.

let ensured: Promise<void> | null = null;

export function ensureEmailSchema(): Promise<void> {
  if (ensured) return ensured;
  const db = getSql();
  ensured = (async () => {
    await db`
      CREATE TABLE IF NOT EXISTS email_subscribers (
        id              bigserial PRIMARY KEY,
        email           text    NOT NULL UNIQUE,
        tz              text    NOT NULL DEFAULT 'UTC',
        confirm_token   text    NOT NULL,
        unsub_token     text    NOT NULL,
        source          text    NOT NULL DEFAULT 'game_notify',
        created_at      bigint  NOT NULL,
        confirmed_at    bigint,
        unsubscribed_at bigint,
        last_sent_day   integer
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS email_subscribers_confirm_idx ON email_subscribers (confirm_token)`;
    await db`CREATE INDEX IF NOT EXISTS email_subscribers_unsub_idx ON email_subscribers (unsub_token)`;
    // Audit + idempotency: at most one logged send per subscriber per puzzle day.
    await db`
      CREATE TABLE IF NOT EXISTS email_send_log (
        subscriber_id bigint  NOT NULL,
        day           integer NOT NULL,
        sent_at       bigint  NOT NULL,
        resend_id     text,
        status        text    NOT NULL,
        PRIMARY KEY (subscriber_id, day)
      )
    `;
  })().catch((err) => {
    ensured = null;
    throw err;
  });
  return ensured;
}

// ───────────────────────── helpers ─────────────────────────

export function newToken(): string {
  return randomBytes(24).toString("hex");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeEmail(raw: unknown): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  if (e.length < 5 || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

/**
 * Validate an IANA timezone string by trying to format with it. Returns "UTC"
 * for anything missing or invalid so a bad client value can never break sends.
 */
export function normalizeTz(raw: unknown): string {
  const tz = String(raw ?? "").trim();
  if (!tz || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Current local hour (0–23) for a timezone. Falls back to UTC hour on error. */
export function localHour(tz: string, now: Date = new Date()): number {
  try {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(now);
    // "24" can appear at midnight in some environments; fold to 0.
    const h = parseInt(s, 10) % 24;
    return Number.isFinite(h) ? h : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

// ───────────────────────── types ─────────────────────────

export interface Subscriber {
  id: number;
  email: string;
  tz: string;
  confirm_token: string;
  unsub_token: string;
  source: string;
  created_at: number;
  confirmed_at: number | null;
  unsubscribed_at: number | null;
  last_sent_day: number | null;
}

// ───────────────────────── operations ─────────────────────────

export async function findByEmail(email: string): Promise<Subscriber | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT * FROM email_subscribers WHERE email = ${email} LIMIT 1
  `) as Subscriber[];
  return rows[0] ?? null;
}

/**
 * Idempotent signup. Inserts a fresh unconfirmed row, or — for an existing
 * un-confirmed / previously-unsubscribed address — refreshes its tokens and
 * clears the unsubscribe so a re-subscribe works cleanly. Returns the row plus
 * whether it is already an active (confirmed, not unsubscribed) subscriber.
 */
export async function upsertSubscriber(input: {
  email: string;
  tz: string;
  source: string;
}): Promise<{ sub: Subscriber; alreadyActive: boolean }> {
  const sql = getSql();
  const existing = await findByEmail(input.email);
  if (existing && existing.confirmed_at && !existing.unsubscribed_at) {
    return { sub: existing, alreadyActive: true };
  }
  const now = Date.now();
  const confirm = existing?.confirm_token ?? newToken();
  const unsub = existing?.unsub_token ?? newToken();
  const rows = (await sql`
    INSERT INTO email_subscribers (email, tz, confirm_token, unsub_token, source, created_at)
    VALUES (${input.email}, ${input.tz}, ${confirm}, ${unsub}, ${input.source}, ${now})
    ON CONFLICT (email) DO UPDATE SET
      tz = ${input.tz},
      unsubscribed_at = NULL
    RETURNING *
  `) as Subscriber[];
  return { sub: rows[0], alreadyActive: false };
}

export async function confirmByToken(token: string): Promise<Subscriber | null> {
  if (!token) return null;
  const sql = getSql();
  const rows = (await sql`
    UPDATE email_subscribers
       SET confirmed_at = COALESCE(confirmed_at, ${Date.now()}),
           unsubscribed_at = NULL
     WHERE confirm_token = ${token}
    RETURNING *
  `) as Subscriber[];
  return rows[0] ?? null;
}

export async function unsubscribeByToken(token: string): Promise<Subscriber | null> {
  if (!token) return null;
  const sql = getSql();
  const rows = (await sql`
    UPDATE email_subscribers SET unsubscribed_at = ${Date.now()}
     WHERE unsub_token = ${token}
    RETURNING *
  `) as Subscriber[];
  return rows[0] ?? null;
}

/** All confirmed, not-unsubscribed subscribers who haven't been sent `day`. */
export async function dueSubscribers(day: number): Promise<Subscriber[]> {
  const sql = getSql();
  return (await sql`
    SELECT * FROM email_subscribers
     WHERE confirmed_at IS NOT NULL
       AND unsubscribed_at IS NULL
       AND (last_sent_day IS NULL OR last_sent_day < ${day})
  `) as Subscriber[];
}

/**
 * Atomically claim today's send for a subscriber. The conditional UPDATE means
 * two overlapping cron runs can't both pass — only the first stamps the day and
 * gets a row back. Returns true if THIS caller won the claim.
 */
export async function claimDailySend(subscriberId: number, day: number): Promise<boolean> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE email_subscribers SET last_sent_day = ${day}
     WHERE id = ${subscriberId}
       AND (last_sent_day IS NULL OR last_sent_day < ${day})
    RETURNING id
  `) as { id: number }[];
  return rows.length > 0;
}

export async function logSend(
  subscriberId: number,
  day: number,
  status: string,
  resendId: string | null,
): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO email_send_log (subscriber_id, day, sent_at, resend_id, status)
    VALUES (${subscriberId}, ${day}, ${Date.now()}, ${resendId}, ${status})
    ON CONFLICT (subscriber_id, day) DO UPDATE SET
      sent_at = EXCLUDED.sent_at, resend_id = EXCLUDED.resend_id, status = EXCLUDED.status
  `;
}
