import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql, ensureSchema } from "./_lib/db.js";
import { currentDay, secsToMidnight } from "./_lib/day.js";
import { RETENTION_DAYS } from "./_lib/board.js";
import { dayMotif, brandHue, longDate, isoDate, lastArchivedDay } from "./_lib/puzzle.js";
import { shell, esc, SITE_URL } from "./_lib/page.js";

function qInt(v: VercelRequest["query"][string]): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Global difficulty context for a past day, IF still within the DB retention
 * window (~14 days). Older days have been pruned, so we omit stats gracefully.
 * Returns null on any DB issue — the page renders fine without it.
 */
async function difficultyContext(
  day: number,
  today: number
): Promise<{ avgLevel: number; players: number } | null> {
  if (day < today - (RETENTION_DAYS - 1)) return null; // pruned — no data
  try {
    await ensureSchema();
    const rows = (await getSql()`
      SELECT round(avg(level))::int AS avg_level, count(*)::int AS players
      FROM scores WHERE day = ${day}
    `) as { avg_level: number | null; players: number }[];
    const r = rows[0];
    if (!r || !r.players) return null;
    return { avgLevel: r.avg_level ?? 0, players: r.players };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const today = currentDay();
  const maxDay = lastArchivedDay(); // today − 1: only completed UTC days
  const n = qInt(req.query.n);

  // Today's live puzzle is never archived (no spoilers); send players to play it.
  if (n === today) {
    res.setHeader("Cache-Control", `public, max-age=0, s-maxage=${secsToMidnight()}`);
    res.setHeader("Location", "/");
    return res.status(307).end();
  }

  if (n == null || n < 1 || n > maxDay) {
    res.setHeader("Cache-Control", `public, max-age=0, s-maxage=${secsToMidnight()}`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(404).send(
      shell(
        {
          title: "Puzzle not found — HUEMAN",
          description: "That HUEMAN puzzle isn't in the archive yet.",
          canonical: `${SITE_URL}/archive`,
          robots: "noindex, follow",
          accentHue: brandHue(today),
        },
        `<h1>Puzzle not found</h1>
<p class="lede">That puzzle isn't in the archive${n && n >= today ? " yet — it hasn't been played worldwide" : ""}.</p>
<p><a class="cta" href="/">Play today's puzzle →</a></p>
<p><a href="/archive">Browse the full archive</a></p>`
      )
    );
  }

  const motif = dayMotif(n);
  const hue = brandHue(n);
  const date = longDate(n);
  const iso = isoDate(n);
  const stats = await difficultyContext(n, today);

  const title = `HUEMAN #${n} — Daily Color Game for ${date} | Results & Stats`;
  const description = `HUEMAN puzzle #${n} from ${date}. See the day's color motif and difficulty, then play today's free daily color game — spot the odd shade before the clock runs out.`;
  const canonical = `${SITE_URL}/archive/${n}`;

  const tilesHtml = motif.tiles
    .map((c) => `<div style="background:${c}"></div>`)
    .join("");

  const statsHtml = stats
    ? `<p>On ${esc(date)}, the average player reached <b>level ${stats.avgLevel}</b> across
       <b>${stats.players.toLocaleString("en-US")}</b> ranked runs worldwide.</p>`
    : `<p class="muted">Global stats for this day are no longer available — rankings reset
       and are only kept for about two weeks. Play today's puzzle to see live stats.</p>`;

  const prevLink =
    n > 1
      ? `<a class="prev" href="/archive/${n - 1}">← #${n - 1}<br><span class="muted">${esc(longDate(n - 1))}</span></a>`
      : `<span class="prev disabled">← #${n - 1}</span>`;
  const nextLink =
    n + 1 <= maxDay
      ? `<a class="next" href="/archive/${n + 1}">#${n + 1} →<br><span class="muted">${esc(longDate(n + 1))}</span></a>`
      : `<a class="next" href="/">Play today's #${today} →<br><span class="muted">Live now</span></a>`;

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "HUEMAN", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Archive", item: `${SITE_URL}/archive` },
      { "@type": "ListItem", position: 3, name: `#${n}`, item: canonical },
    ],
  };

  const body = `<article>
  <p class="eyebrow">Puzzle #${n}</p>
  <h1>HUEMAN #${n}</h1>
  <p class="lede">The daily color game for <time datetime="${iso}">${esc(date)}</time>.</p>

  <div class="card" style="text-align:center">
    <div class="motif" role="img" aria-label="Color motif for HUEMAN #${n}">${tilesHtml}</div>
    <p class="muted" style="margin-top:16px;font-size:.85rem">A non-spoiler glimpse of this day's palette.</p>
  </div>

  <h2>How hard was #${n}?</h2>
  ${statsHtml}

  <p style="margin-top:24px"><a class="cta" href="/">Play today's puzzle →</a></p>

  <nav class="pager" aria-label="Puzzle navigation">
    ${prevLink}
    ${nextLink}
  </nav>

  <div class="disclaimer">
    HUEMAN is a game, not a medical color vision test, and cannot diagnose color blindness.
    Shade differences include brightness shifts, so it stays playable with most types of color
    vision deficiency. If you have concerns about your color vision, see an eye care professional.
  </div>

  <p class="muted"><a href="/archive">← Browse all past puzzles</a></p>
</article>`;

  const head = `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Cache until the next UTC rollover: past-day content is stable, but the
  // newest page's "next" link flips to a real archive entry at midnight.
  res.setHeader(
    "Cache-Control",
    `public, max-age=0, s-maxage=${secsToMidnight()}, stale-while-revalidate=86400`
  );
  return res.status(200).send(
    shell(
      { title, description, canonical, accentHue: hue, head, ogImage: `${SITE_URL}/api/og?day=${n}` },
      body
    )
  );
}
