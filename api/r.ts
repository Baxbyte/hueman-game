import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentDay } from "./_lib/day.js";
import { brandHue, longDate } from "./_lib/puzzle.js";
import { decodeResult } from "./_lib/result.js";
import { climbTrackHtml, missLevelsFromCells, MAX_LEVEL } from "./_lib/climb.js";
import { shell, esc, SITE_URL } from "./_lib/page.js";

function qStr(v: VercelRequest["query"][string]): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const today = currentDay();
  const id = qStr(req.query.id);
  const decoded = decodeResult(id);

  // These pages are user-generated and unbounded, so they're noindex — but the
  // OG/Twitter tags still render, so link previews work everywhere.
  const robots = "noindex, follow";

  if (!decoded || decoded.day > today) {
    // Malformed or impossible (future) result — friendly fallback, still noindex.
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
    return res.status(decoded ? 404 : 400).send(
      shell(
        {
          title: "HUEMAN — the daily color game",
          description: "Spot the odd shade before the clock runs out. A new puzzle every day.",
          canonical: `${SITE_URL}/`,
          robots,
          accentHue: brandHue(today),
        },
        `<h1>Ready to play?</h1>
<p class="lede">That challenge link looks broken — but today's puzzle is live.</p>
<p><a class="cta" href="/">Play today's HUEMAN #${today} →</a></p>`
      )
    );
  }

  const { day, level, cells } = decoded;
  const isToday = day === today;
  const missLevels = missLevelsFromCells(cells);

  const hue = brandHue(day);
  const dateStr = longDate(day);

  const title = `Someone reached Level ${level} on HUEMAN #${day} — can you beat them?`;
  const description = isToday
    ? `They spotted the odd shade up to Level ${level} on today's HUEMAN. Play the same puzzle free — no signup — and see if your eyes are sharper.`
    : `A Level ${level} run on HUEMAN #${day} (${dateStr}). Play today's free daily color game and beat it.`;
  const canonical = `${SITE_URL}/r/${encodeURIComponent(id)}`;
  const ogImage = `${SITE_URL}/api/og?r=${encodeURIComponent(id)}`;

  const cta = isToday
    ? `<p><a class="cta" href="/">Play HUEMAN #${day} now →</a></p>
       <p class="muted">Same puzzle, same clock — everyone on Earth gets it today.</p>`
    : `<p class="note">HUEMAN #${day} closed when the day ended — but there's a fresh one live right now.</p>
       <p><a class="cta" href="/">Play today's HUEMAN #${today} →</a></p>`;

  const extraCss = `<style>
    .runcard{--rc-h:26px;background:var(--surface-2);border:1px solid var(--line);
      border-radius:16px;padding:16px;margin:20px 0;text-align:left}
    .note{color:var(--muted);font-size:.9rem}
    .rhero{text-align:center}
    .rlevel{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;
      font-size:clamp(2.4rem,9vw,3.6rem);letter-spacing:-.02em;color:var(--daily);line-height:1}
  </style>`;

  const body = `<div class="rhero">
  <p class="eyebrow">HUEMAN #${day} · ${esc(dateStr)}</p>
  <h1>Can you beat them?</h1>
  <p class="rlevel">Level ${level} <span style="font-size:.4em;color:var(--muted)">of ${MAX_LEVEL}</span></p>
  <div class="runcard">${climbTrackHtml(level, missLevels)}<p class="rc-key">The bar is how far up the 60-level climb they got. Each <b>\u2715</b> is a life lost.</p></div>
  ${cta}
</div>

<div class="disclaimer">
  HUEMAN is a game, not a medical color vision test, and cannot diagnose color blindness.
  Shade differences include brightness shifts, so it stays playable with most types of color
  vision deficiency. If you have concerns about your color vision, see an eye care professional.
</div>

<p class="muted" style="text-align:center"><a href="/archive">Browse past puzzles</a> ·
<a href="/learn">Get better at HUEMAN</a></p>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800");
  return res.status(200).send(
    shell(
      { title, description, canonical, accentHue: hue, robots, ogImage, head: `${extraCss}\n` },
      body
    )
  );
}
