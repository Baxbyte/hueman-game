import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentDay, secsToMidnight } from "./_lib/day.js";
import { brandHue, dateForDay, lastArchivedDay } from "./_lib/puzzle.js";
import { shell, esc, SITE_URL } from "./_lib/page.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const today = currentDay();
  const maxDay = lastArchivedDay();

  // Group completed days by calendar month, newest first.
  type Group = { key: string; label: string; days: number[] };
  const groups: Group[] = [];
  const index = new Map<string, Group>();
  for (let n = maxDay; n >= 1; n--) {
    const d = dateForDay(n);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    let g = index.get(key);
    if (!g) {
      g = { key, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, days: [] };
      index.set(key, g);
      groups.push(g);
    }
    g.days.push(n);
  }

  const dayCell = (n: number) => {
    const d = dateForDay(n);
    return `<a class="arch-cell" href="/archive/${n}">
      <span class="arch-swatch" style="background:hsl(${brandHue(n)} 70% 55%)"></span>
      <span class="arch-n">#${n}</span>
      <span class="arch-date muted">${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}</span>
    </a>`;
  };

  const monthsHtml = groups
    .map(
      (g) => `<section class="arch-month">
      <h2>${esc(g.label)}</h2>
      <div class="arch-grid">${g.days.map(dayCell).join("")}</div>
    </section>`
    )
    .join("");

  const emptyHtml = `<p class="lede">No puzzles have been completed yet — check back after
    the first daily rollover.</p>
    <p><a class="cta" href="/">Play today's puzzle →</a></p>`;

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "HUEMAN Puzzle Archive",
    url: `${SITE_URL}/archive`,
    description: "Every past HUEMAN daily color puzzle.",
    isPartOf: { "@id": `${SITE_URL}/#website` },
  };

  const extraCss = `<style>
    .arch-month{margin:28px 0}
    .arch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:10px}
    .arch-cell{display:flex;flex-direction:column;align-items:center;gap:4px;
      padding:12px 8px;border:1px solid var(--line);border-radius:12px;color:var(--text)}
    .arch-cell:hover{border-color:var(--muted);text-decoration:none}
    .arch-swatch{width:32px;height:32px;border-radius:8px}
    .arch-n{font-weight:700;font-size:.9rem}
    .arch-date{font-size:.72rem}
  </style>`;

  const body = `<h1>Puzzle archive</h1>
<p class="lede">Every past HUEMAN — one color puzzle a day, the same for everyone on Earth.
${maxDay >= 1 ? `${maxDay} puzzle${maxDay === 1 ? "" : "s"} and counting.` : ""}</p>
<p><a class="cta" href="/">Play today's #${today} →</a></p>
${maxDay >= 1 ? monthsHtml : emptyHtml}`;

  const head = `${extraCss}\n<script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    `public, max-age=0, s-maxage=${secsToMidnight()}, stale-while-revalidate=86400`
  );
  return res.status(200).send(
    shell(
      {
        title: "HUEMAN Archive — Every Past Daily Color Puzzle",
        description:
          "Browse every past HUEMAN daily color puzzle by date. See each day's palette and difficulty, then play today's free color game.",
        canonical: `${SITE_URL}/archive`,
        accentHue: brandHue(today),
        head,
      },
      body
    )
  );
}
