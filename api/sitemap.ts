import type { VercelRequest, VercelResponse } from "@vercel/node";
import { secsToMidnight } from "./_lib/day.js";
import { isoDate, lastArchivedDay } from "./_lib/puzzle.js";
import { listArticles } from "./_lib/content.js";
import { SITE_URL } from "./_lib/page.js";

type Entry = { loc: string; lastmod?: string; changefreq?: string; priority?: string };

function urlTag(e: Entry): string {
  return (
    `  <url>\n    <loc>${e.loc}</loc>\n` +
    (e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>\n` : "") +
    (e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>\n` : "") +
    (e.priority ? `    <priority>${e.priority}</priority>\n` : "") +
    `  </url>`
  );
}

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const maxDay = lastArchivedDay();
  const today = new Date().toISOString().slice(0, 10);

  const entries: Entry[] = [
    { loc: `${SITE_URL}/`, lastmod: today, changefreq: "daily", priority: "1.0" },
    { loc: `${SITE_URL}/archive`, lastmod: today, changefreq: "daily", priority: "0.7" },
    { loc: `${SITE_URL}/learn`, changefreq: "weekly", priority: "0.6" },
  ];

  // Learn articles (auto-discovered from content/learn).
  for (const a of listArticles()) {
    entries.push({
      loc: `${SITE_URL}/learn/${a.slug}`,
      lastmod: a.updated || a.date || undefined,
      changefreq: "monthly",
      priority: "0.6",
    });
  }

  // One entry per completed puzzle day (newest first). Immutable once past.
  for (let n = maxDay; n >= 1; n--) {
    entries.push({
      loc: `${SITE_URL}/archive/${n}`,
      lastmod: isoDate(n),
      changefreq: "yearly",
      priority: "0.5",
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(urlTag).join("\n")}
</urlset>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    `public, max-age=0, s-maxage=${secsToMidnight()}, stale-while-revalidate=86400`
  );
  return res.status(200).send(xml);
}
