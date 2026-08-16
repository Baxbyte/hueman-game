import { getSql } from "./db.js";

/**
 * Purchase receipts, sent through Puzzle Page's existing Resend account.
 *
 * Two separate things happen when someone gives us an email at checkout:
 *
 *  1. A transactional receipt. They paid; they get told what they bought and,
 *     critically, their restore code — credits live in one browser, so that
 *     code is the only way back to them after clearing site data.
 *  2. Optionally, and only on an explicit tick, they join the daily list.
 *
 * Neither is allowed to fail the purchase. Credits are granted before any of
 * this runs, and every function here swallows its own errors: a bounced email
 * must never turn into a customer who paid and got nothing.
 */

const RESEND_API = "https://api.resend.com/emails";

/** Sender must be on a Resend-verified domain — puzzlepage.app is verified. */
function sender(): string {
  return process.env.EMAIL_FROM || "HUEMAN <credits@puzzlepage.app>";
}

export function isEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
}

/** Record the address, and remember whether they actually opted into mail. */
export async function recordSubscriber(
  email: string,
  pid: string,
  source: string,
  marketing: boolean
): Promise<void> {
  try {
    const now = Date.now();
    const sql = getSql();
    await sql`
      INSERT INTO subscribers (email, pid, source, marketing, created, updated)
      VALUES (${email.toLowerCase()}, ${pid}, ${source}, ${marketing}, ${now}, ${now})
      ON CONFLICT (email) DO UPDATE SET
        pid = EXCLUDED.pid,
        updated = EXCLUDED.updated,
        -- Consent only ever ratchets up here; withdrawing is a separate flow,
        -- so a later purchase without the tick can't silently unsubscribe them.
        marketing = subscribers.marketing OR EXCLUDED.marketing
    `;
  } catch {
    /* the purchase already succeeded — never surface this */
  }
}

function receiptHtml(o: {
  credits: number;
  total: number;
  restore: string;
  amount: number;
  currency: string;
}): string {
  const money = `${(o.amount / 100).toFixed(2)} ${o.currency.toUpperCase()}`;
  return `<!doctype html><html><body style="margin:0;background:#0E0E12;padding:28px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#17171D;border:1px solid #2A2A33;border-radius:20px;padding:26px 24px">
    <tr><td style="font-size:24px;font-weight:800;color:#F4F2EC;padding-bottom:4px">
      <span style="color:#4FA8D8">HUE</span>MAN
    </td></tr>
    <tr><td style="font-size:13px;color:#8C8C98;letter-spacing:.08em;text-transform:uppercase;padding-bottom:18px">Credit receipt</td></tr>
    <tr><td style="font-size:16px;color:#F4F2EC;line-height:1.55;padding-bottom:16px">
      Thanks — <b>${o.credits} credits</b> have been added to your HUEMAN account. You now have <b>${o.total}</b>.
    </td></tr>
    <tr><td style="background:#1F1F27;border:1px solid #2A2A33;border-radius:14px;padding:16px;">
      <div style="font-size:12px;color:#8C8C98;padding-bottom:6px">YOUR RESTORE CODE</div>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;font-weight:700;letter-spacing:.09em;color:#F4F2EC">${o.restore}</div>
      <div style="font-size:12px;color:#8C8C98;padding-top:10px;line-height:1.5">
        Your credits live in the browser you bought them in. If you clear site data or switch device, enter this code in the HUEMAN credit store to bring them back. Keep this email.
      </div>
    </td></tr>
    <tr><td style="font-size:13px;color:#8C8C98;padding-top:18px;line-height:1.6">
      Paid ${money}. Stripe has emailed your payment receipt separately.
    </td></tr>
    <tr><td style="padding-top:20px">
      <a href="https://huemangame.com/" style="display:block;background:#F4F2EC;color:#0E0E12;text-decoration:none;text-align:center;font-weight:700;padding:13px;border-radius:999px">Play today's puzzle</a>
    </td></tr>
    <tr><td style="font-size:11px;color:#8C8C98;padding-top:18px;line-height:1.6;text-align:center">
      HUEMAN is a <a href="https://puzzlepage.app" style="color:#4FA8D8">Puzzle Page</a> game.<br>
      You're getting this because you bought credits. It's a one-off receipt, not a subscription.
    </td></tr>
  </table></td></tr></table></body></html>`;
}

/**
 * Send the credits receipt. Returns whether it was sent, for logging only —
 * callers must not treat false as a failure worth surfacing to the buyer.
 */
export async function sendCreditsReceipt(o: {
  to: string;
  credits: number;
  total: number;
  restore: string;
  amount: number;
  currency: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !isEmail(o.to)) return false;
  try {
    const r = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender(),
        to: [o.to],
        subject: `Your ${o.credits} HUEMAN credits — and your restore code`,
        html: receiptHtml(o),
        text:
          `Thanks — ${o.credits} credits have been added to your HUEMAN account. You now have ${o.total}.\n\n` +
          `RESTORE CODE: ${o.restore}\n\n` +
          `Your credits live in the browser you bought them in. If you clear site data or switch device, ` +
          `enter this code in the HUEMAN credit store to bring them back. Keep this email.\n\n` +
          `Paid ${(o.amount / 100).toFixed(2)} ${o.currency.toUpperCase()}. Stripe has emailed your payment receipt separately.\n\n` +
          `Play: https://huemangame.com/`,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
