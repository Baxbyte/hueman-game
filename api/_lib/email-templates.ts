/**
 * Transactional + daily email templates for the HUEMAN daily-notification list.
 *
 * Per product decision: the *branding* is Puzzle Page (logo, wordmark, teal
 * palette, "PuzzlePage Daily" sender) but the *subject lines* speak as HUEMAN /
 * huemangame.com. Links for playing point at huemangame.com; list-management
 * links (confirm / unsubscribe) point at the huemangame.com API.
 *
 * All HTML is email-client-safe: tables, inline styles, no external CSS.
 */

const SITE = "https://huemangame.com";
const PP = "https://www.puzzlepage.app/play";

// Puzzle Page palette
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const TEAL = "#0d9488";
const TEAL_DARK = "#0e7490";
const BLUE = "#1d4ed8";
const INK = "#0f172a";
const BODY = "#475569";
const MUTED = "#94a3b8";
const HAIRLINE = "#e2e8f0";
const PAGE = "#f5f7fa";

export function confirmUrl(token: string): string {
  return `${SITE}/api/confirm?token=${encodeURIComponent(token)}`;
}
export function unsubUrl(token: string): string {
  return `${SITE}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}
export function listUnsubscribeHeader(token: string): string {
  return `<${unsubUrl(token)}>`;
}

function esc(s: string): string {
  return String(s).replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

/** Shared PuzzlePage-branded shell. `footer` is raw HTML appended after content. */
function shell(opts: { preheader: string; inner: string; footer: string }): string {
  return `<!DOCTYPE html><html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>PuzzlePage Daily</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
  <span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(opts.preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="height:6px;background:${TEAL};background-image:linear-gradient(90deg,${TEAL} 0%,${TEAL_DARK} 55%,${BLUE} 100%);line-height:6px;font-size:6px;">&nbsp;</td></tr>
        <tr><td style="padding:26px 32px 0;font-family:${FONT};">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" style="padding-right:12px;">
              <div style="width:36px;height:36px;border-radius:8px;background:${TEAL};background-image:linear-gradient(135deg,${TEAL} 0%,${TEAL_DARK} 55%,${BLUE} 100%);color:#fff;font-weight:800;font-size:15px;text-align:center;line-height:36px;font-family:${FONT};">PP</div>
            </td>
            <td valign="middle">
              <div style="font-family:${FONT};font-size:16px;font-weight:700;color:${INK};line-height:1.1;">PuzzlePage</div>
              <div style="font-family:${FONT};font-size:11px;font-weight:600;color:${MUTED};letter-spacing:0.08em;text-transform:uppercase;margin-top:2px;">Daily</div>
            </td>
          </tr></table>
        </td></tr>
        ${opts.inner}
        <tr><td style="padding:24px 32px 32px;font-family:${FONT};">
          <div style="height:1px;background:${HAIRLINE};line-height:1px;font-size:1px;margin-bottom:16px;">&nbsp;</div>
          ${opts.footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function btn(href: string, label: string): string {
  return `<a href="${href}" style="display:block;text-align:center;background:${TEAL};background-image:linear-gradient(135deg,${TEAL} 0%,${TEAL_DARK} 55%,${BLUE} 100%);color:#ffffff;text-decoration:none;padding:15px 24px;border-radius:10px;font-family:${FONT};font-size:16px;font-weight:800;">${label}</a>`;
}

// ───────────────────── confirmation (double opt-in) ─────────────────────

export function buildConfirmationEmail(confirmToken: string) {
  const url = confirmUrl(confirmToken);
  const inner = `
    <tr><td style="padding:24px 32px 0;font-family:${FONT};">
      <h1 style="margin:0 0 12px;font-family:${FONT};font-size:25px;font-weight:800;line-height:1.2;color:${INK};letter-spacing:-0.02em;">One tap and you're in.</h1>
      <p style="margin:0 0 18px;font-family:${FONT};font-size:15px;line-height:1.6;color:${BODY};">
        Confirm your email and we'll ping you the moment each day's <strong style="color:${INK};">HUEMAN</strong> color puzzle drops —
        the same grid everyone on Earth is racing, with a live global leaderboard.
      </p>
    </td></tr>
    <tr><td style="padding:0 32px;font-family:${FONT};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0fdfa;border:1px solid #ccfbf1;border-radius:12px;">
        <tr><td style="padding:16px 18px;font-family:${FONT};font-size:14px;line-height:1.7;color:${BODY};">
          <strong style="color:${INK};">What you'll get:</strong><br>
          🎨 One quick daily nudge when the new color puzzle is live<br>
          ⏱ Sent in time for your morning, in your time zone<br>
          🏆 A peek at where you stand on the global board<br>
          ✋ One-click unsubscribe, anytime
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:24px 32px 4px;font-family:${FONT};">${btn(url, "Confirm &amp; get the daily →")}</td></tr>
    <tr><td style="padding:8px 32px 0;font-family:${FONT};">
      <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">Button not working? Paste this into your browser:<br><span style="color:${BODY};word-break:break-all;">${url}</span></p>
    </td></tr>`;
  const footer = `<p style="margin:0;font-family:${FONT};font-size:12px;color:${MUTED};line-height:1.6;">Didn't sign up? Just ignore this — we won't add you to anything, and you'll hear nothing more.</p>`;
  return {
    subject: "Confirm your HUEMAN daily puzzle alerts 🎨",
    html: shell({ preheader: "One tap confirms your daily HUEMAN color-puzzle reminder.", inner, footer }),
    text:
      `One tap and you're in.\n\n` +
      `Confirm your email to get a daily ping when HUEMAN's new color puzzle drops (huemangame.com):\n${url}\n\n` +
      `What you'll get:\n` +
      `  • One quick daily nudge when the new puzzle is live\n` +
      `  • Timed for your morning, in your time zone\n` +
      `  • A peek at where you stand on the global board\n` +
      `  • One-click unsubscribe anytime\n\n` +
      `Didn't sign up? Ignore this email — we won't add you to anything.`,
  };
}

// ───────────────────── welcome ("you're in") ─────────────────────

export function buildWelcomeEmail(unsubToken: string) {
  const inner = `
    <tr><td style="padding:24px 32px 0;font-family:${FONT};">
      <h1 style="margin:0 0 12px;font-family:${FONT};font-size:25px;font-weight:800;line-height:1.2;color:${INK};letter-spacing:-0.02em;">You're in. 🎉</h1>
      <p style="margin:0 0 18px;font-family:${FONT};font-size:15px;line-height:1.6;color:${BODY};">
        Your daily <strong style="color:${INK};">HUEMAN</strong> reminder is confirmed. Starting with the next drop, you'll get a
        nudge each day when the new color puzzle goes live — timed for your morning. Why wait? Today's is live right now.
      </p>
    </td></tr>
    <tr><td style="padding:8px 32px 4px;font-family:${FONT};">${btn(`${SITE}/?ref=welcome-email`, "Play today's HUEMAN →")}</td></tr>`;
  const footer = `
    <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;color:${MUTED};line-height:1.6;">You're on the <strong style="color:${BODY};">HUEMAN Daily</strong> list — a private list, separate from everything else.</p>
    <p style="margin:0;font-family:${FONT};font-size:12px;color:${MUTED};line-height:1.6;">Changed your mind? <a href="${unsubUrl(unsubToken)}" style="color:${BODY};text-decoration:underline;">Unsubscribe in one click</a>.</p>`;
  return {
    subject: "You're in — HUEMAN daily alerts are on 🎨",
    html: shell({ preheader: "Confirmed! Your daily HUEMAN color-puzzle reminder is on.", inner, footer }),
    text:
      `You're in!\n\n` +
      `Your daily HUEMAN reminder is confirmed. You'll get a nudge each day when the new color puzzle drops.\n\n` +
      `Today's is live now: ${SITE}/?ref=welcome-email\n\n` +
      `You're on the HUEMAN Daily list — separate from everything else. Unsubscribe anytime: ${unsubUrl(unsubToken)}`,
  };
}

// ───────────────────── daily drop ─────────────────────

export interface LeaderRow {
  rank: number;
  name: string;
  country: string;
  level: number;
}

function flag(cc: string): string {
  const c = (cc || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "🌍";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/**
 * Rotating subject line. A static subject on a *daily* send is the single
 * biggest open-rate killer — inboxes collapse identical subjects. Rotate
 * deterministically by day so retries for a given day are stable but no two
 * days repeat. `crowd` (today's player count) folds in live FOMO when present.
 */
export function pickDailySubject(day: number, crowd: number | null): string {
  const candidates: Array<string | null> = [
    `HUEMAN #${day} is live 🎨`,
    `Today's color puzzle just dropped`,
    `Can your eyes spot today's odd shade?`,
    crowd && crowd > 0 ? `${crowd.toLocaleString()} people are on today's board. Not you yet.` : null,
    `New HUEMAN — beat your friends to it`,
    `Spot today's odd color before midnight 🎨`,
    crowd && crowd > 0 ? `${crowd.toLocaleString()} solvers already locked a score today` : null,
    `Don't break the streak — HUEMAN #${day} is up`,
  ];
  const resolved = candidates.filter((s): s is string => Boolean(s));
  return resolved[day % resolved.length] ?? `HUEMAN #${day} is live 🎨`;
}

export function buildDailyEmail(opts: {
  day: number;
  unsubToken: string;
  total: number;
  top: LeaderRow[];
}) {
  const { day, unsubToken, total, top } = opts;
  const playUrl = `${SITE}/?ref=daily-email`;
  const subject = pickDailySubject(day, total);
  const fomo =
    total > 0
      ? `${total.toLocaleString()} people already locked in a score on puzzle #${day} — you're not on the board yet.`
      : `Puzzle #${day} just dropped — get on the board before everyone else wakes up.`;

  const rowsHtml = top
    .slice(0, 5)
    .map((e) => {
      const medal = e.rank === 1 ? "#fbbf24" : e.rank === 2 ? "#cbd5e1" : e.rank === 3 ? "#d97706" : "#64748b";
      return `<tr>
        <td style="padding:7px 8px;font-family:${FONT};font-size:13px;font-weight:800;color:${medal};text-align:center;width:28px;">${e.rank}</td>
        <td style="padding:7px 6px;font-family:${FONT};font-size:15px;text-align:center;width:26px;">${flag(e.country)}</td>
        <td style="padding:7px 8px;font-family:${FONT};font-size:13px;font-weight:600;color:#e6edf3;">${esc(e.name || "Anonymous")}</td>
        <td style="padding:7px 8px;font-family:${FONT};font-size:12px;font-weight:700;color:#f0abfc;text-align:right;white-space:nowrap;">Lv ${e.level}</td>
      </tr>`;
    })
    .join("");

  const board = rowsHtml
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;margin:0 0 16px;">
        <tr><td colspan="4" style="padding:10px 12px 6px;font-family:${FONT};font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#a78bfa;">🏆 Today's top players · puzzle #${day}</td></tr>
        ${rowsHtml}
        <tr><td colspan="4" style="padding:6px 12px 10px;font-family:${FONT};font-size:11px;color:#94a3b8;border-top:1px solid rgba(255,255,255,0.06);">${fomo}</td></tr>
      </table>`
    : `<p style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:1.5;color:#cbd5e1;">${fomo}</p>`;

  const inner = `
    <tr><td style="padding:24px 32px 0;font-family:${FONT};">
      <p style="margin:0 0 6px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">Puzzle #${day} · today only</p>
      <h1 style="margin:0 0 14px;font-family:${FONT};font-size:26px;font-weight:800;line-height:1.2;color:${INK};letter-spacing:-0.02em;">Today's HUEMAN is live.</h1>
    </td></tr>
    <tr><td style="padding:0 32px;font-family:${FONT};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0E0E12;background-image:linear-gradient(135deg,#1b1726 0%,#0E0E12 60%);border-radius:14px;" bgcolor="#0E0E12">
        <tr><td style="padding:22px 22px 20px;font-family:${FONT};">
          <p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#e879f9;">✨ The daily color game</p>
          <p style="margin:0 0 8px;font-family:${FONT};font-size:22px;font-weight:800;line-height:1.2;color:#ffffff;">Can your eyes spot today's odd shade?</p>
          <p style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:1.55;color:#cbd5e1;">
            <strong style="color:#fde68a;">HUEMAN</strong> is Wordle for your eyes — one color puzzle a day, the same for everyone on Earth. Tap the tile that's a slightly different shade before the clock runs out. Each level the difference shrinks and the timer drops.
          </p>
          ${board}
          <a href="${playUrl}" style="display:block;text-align:center;background:#d946ef;background-image:linear-gradient(135deg,#d946ef 0%,#f43f5e 55%,#f59e0b 100%);color:#ffffff;text-decoration:none;padding:14px 18px;border-radius:9px;font-family:${FONT};font-size:15px;font-weight:800;">Play today's HUEMAN →</a>
          <p style="margin:12px 0 0;font-family:${FONT};font-size:11px;line-height:1.5;color:#f59e0b;font-weight:600;text-align:center;">⏰ Puzzle #${day} vanishes at midnight UTC. No replay, no second chance.</p>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:18px 32px 0;font-family:${FONT};text-align:center;">
      <a href="${PP}?ref=hueman-daily" style="font-family:${FONT};font-size:12px;color:${MUTED};text-decoration:underline;">More free daily games from Puzzle Page →</a>
    </td></tr>`;
  const footer = `
    <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;color:${MUTED};line-height:1.6;">This is the <strong style="color:${BODY};">HUEMAN Daily</strong> list — a private list, separate from everything else we send.</p>
    <p style="margin:0;font-family:${FONT};font-size:12px;color:${MUTED};line-height:1.6;">Not feeling it anymore? <a href="${unsubUrl(unsubToken)}" style="color:${BODY};text-decoration:underline;">Unsubscribe in one click</a>.</p>`;
  return {
    subject,
    listUnsub: listUnsubscribeHeader(unsubToken),
    html: shell({ preheader: `Puzzle #${day} is live — same color grid worldwide, gone at midnight UTC.`, inner, footer }),
    text:
      `Today's HUEMAN is live — puzzle #${day}.\n\n` +
      `HUEMAN is Wordle for your eyes. Spot the tile that's a slightly different shade before the clock runs out. ` +
      `Same puzzle worldwide, gone at midnight UTC.\n` +
      (total > 0 ? `${total.toLocaleString()} people are already on today's board — you're not.\n` : ``) +
      `\nPlay now: ${playUrl}\n\n` +
      `More free daily games: ${PP}?ref=hueman-daily\n\n` +
      `---\nHUEMAN Daily list. Unsubscribe in one click: ${unsubUrl(unsubToken)}`,
  };
}

// ───────────────────── on-site result pages (HTML responses) ─────────────────────

function page(title: string, heading: string, msg: string, cta?: { href: string; label: string }): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:${PAGE};font-family:${FONT};padding:24px;}
  .card{max-width:440px;width:100%;background:#fff;border-radius:16px;padding:40px 32px;text-align:center;box-shadow:0 1px 3px rgba(15,23,42,.08);}
  .bar{height:6px;border-radius:999px;width:48px;margin:0 auto 24px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK} 55%,${BLUE});}
  h1{margin:0 0 12px;font-size:24px;font-weight:800;color:${INK};letter-spacing:-.02em;}
  p{margin:0 0 8px;font-size:15px;line-height:1.6;color:${BODY};}
  a.cta{display:inline-block;margin-top:20px;background:${TEAL};background-image:linear-gradient(135deg,${TEAL},${TEAL_DARK} 55%,${BLUE});color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:800;font-size:15px;}
  @media(prefers-color-scheme:dark){body{background:#0b0f14}.card{background:#11161d}h1{color:#e6edf3}p{color:#9aa4b2}}
</style></head>
<body><div class="card"><div class="bar"></div><h1>${esc(heading)}</h1><p>${msg}</p>${cta ? `<a class="cta" href="${cta.href}">${esc(cta.label)}</a>` : ""}</div></body></html>`;
}

export function confirmedPage(): string {
  return page("Subscription confirmed", "You're in. 🎉", "Your daily HUEMAN reminder is confirmed. We'll nudge you when each new color puzzle drops — timed for your morning. Today's is live right now.", { href: `${SITE}/?ref=confirm-page`, label: "Play today's HUEMAN →" });
}
export function alreadyOrInvalidPage(): string {
  return page("Link expired", "Hmm, that link didn't work", "It may have already been used or expired. If you're still not getting daily emails, just sign up again from the bell icon in the game.", { href: `${SITE}/?ref=confirm-invalid`, label: "Open HUEMAN" });
}
export function unsubscribedPage(): string {
  return page("Unsubscribed", "You're unsubscribed", "You've been removed from the HUEMAN daily list and won't get any more daily emails. This only affects HUEMAN daily reminders. Changed your mind? Re-subscribe anytime from the bell icon in the game.", { href: `${SITE}/?ref=unsub-page`, label: "Back to HUEMAN" });
}
