import { Resend } from "resend";

// Resend's constructor throws when the API key is missing or malformed, which
// would crash the function at module load. In dev/preview the key may be a
// placeholder; every call site is guarded (and gated on a configured FROM
// address via emailConfigured()), so a dummy key here is safe and lets the
// function boot. Mirrors the Puzzle Page integration.
const RESEND_KEY = process.env.RESEND_API_KEY;
const safeKey =
  RESEND_KEY && RESEND_KEY.startsWith("re_") && RESEND_KEY.length > 10
    ? RESEND_KEY
    : "re_dev_placeholder_no_real_calls";

export const resend = new Resend(safeKey);

/**
 * The verified Resend sender. Branding is Puzzle Page (per product decision),
 * so the display name and address are Puzzle Page's; only the SUBJECT lines
 * speak as HUEMAN / huemangame.com. Configure FROM via env so the address can
 * track whatever domain is verified in Resend.
 *
 *   RESEND_FROM_EMAIL  e.g. "daily@puzzlepage.app"
 *   RESEND_FROM_NAME   e.g. "PuzzlePage Daily"  (defaults below)
 */
export function fromAddress(): string | null {
  const addr = process.env.RESEND_FROM_EMAIL;
  if (!addr) return null;
  const name = process.env.RESEND_FROM_NAME || "PuzzlePage Daily";
  return `${name} <${addr}>`;
}

/** True when we actually have what we need to send mail. */
export function emailConfigured(): boolean {
  return Boolean(
    RESEND_KEY &&
      RESEND_KEY.startsWith("re_") &&
      RESEND_KEY.length > 10 &&
      process.env.RESEND_FROM_EMAIL,
  );
}

export interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Value for the List-Unsubscribe header (one-click unsubscribe). */
  listUnsubscribe?: string;
}

export interface SendResult {
  ok: boolean;
  id: string | null;
  error?: string;
}

/**
 * Best-effort send. Never throws — returns {ok:false} so callers (especially
 * the cron) can log and continue the batch. Adds RFC 8058 one-click unsubscribe
 * headers whenever a List-Unsubscribe target is supplied.
 */
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const from = fromAddress();
  if (!emailConfigured() || !from) {
    return { ok: false, id: null, error: "email_not_configured" };
  }
  const headers: Record<string, string> = {};
  if (args.listUnsubscribe) {
    headers["List-Unsubscribe"] = args.listUnsubscribe;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  try {
    const res = (await resend.emails.send({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
      headers,
    })) as { data?: { id?: string } | null; error?: unknown; id?: string };

    if (res.error) {
      return { ok: false, id: null, error: String((res.error as any)?.message ?? res.error) };
    }
    return { ok: true, id: res.data?.id ?? res.id ?? null };
  } catch (err: any) {
    return { ok: false, id: null, error: String(err?.message ?? err) };
  }
}
