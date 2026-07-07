import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentDay } from "./_lib/day.js";
import { brandHue } from "./_lib/puzzle.js";
import { getArticle, listArticles } from "./_lib/content.js";
import { shell, esc, SITE_URL } from "./_lib/page.js";

function qStr(v: VercelRequest["query"][string]): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const today = currentDay();
  const slug = qStr(req.query.slug);
  const article = getArticle(slug);

  if (!article) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
    return res.status(404).send(
      shell(
        {
          title: "Article not found — HUEMAN",
          description: "That guide doesn't exist.",
          canonical: `${SITE_URL}/learn`,
          robots: "noindex, follow",
          accentHue: brandHue(today),
        },
        `<h1>Not found</h1>
<p class="lede">That guide doesn't exist (yet).</p>
<p><a class="cta" href="/learn">Browse all guides →</a></p>`
      )
    );
  }

  const canonical = `${SITE_URL}/learn/${article.slug}`;

  // Cross-links: up to two other articles for internal linking.
  const others = listArticles().filter((a) => a.slug !== article.slug).slice(0, 2);
  const keepReading = others.length
    ? `<aside class="keep-reading">
        <h2>Keep reading</h2>
        <ul>${others
          .map((a) => `<li><a href="/learn/${a.slug}">${esc(a.title)}</a></li>`)
          .join("")}</ul>
      </aside>`
    : "";

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    ...(article.date ? { datePublished: article.date } : {}),
    dateModified: article.updated || article.date || undefined,
    author: { "@type": "Organization", name: "HUEMAN", url: `${SITE_URL}/` },
    publisher: {
      "@type": "Organization",
      name: "Puzzle Page",
      url: "https://puzzlepage.app",
      logo: { "@type": "ImageObject", url: `${SITE_URL}/apple-touch-icon.png` },
    },
    image: `${SITE_URL}/api/og`,
    mainEntityOfPage: canonical,
    isPartOf: { "@id": `${SITE_URL}/#website` },
  };

  const extraCss = `<style>
    article.post{max-width:680px}
    .post-meta{color:var(--muted);font-size:.85rem;margin:-4px 0 24px}
    article.post p{margin:0 0 16px;font-size:1.02rem}
    article.post ul{margin:0 0 16px 1.1em}
    article.post li{margin:0 0 8px}
    article.post blockquote{border-left:3px solid var(--daily);padding:2px 0 2px 16px;
      margin:0 0 16px;color:var(--muted);font-style:italic}
    .post-cta{margin:28px 0;padding:20px;border:1px solid var(--line);border-radius:16px;
      background:var(--surface);text-align:center}
    .keep-reading{margin-top:36px;padding-top:20px;border-top:1px solid var(--line)}
    .keep-reading ul{list-style:none;padding:0;margin:0}
    .keep-reading li{margin:8px 0}
  </style>`;

  const dateLine = article.date
    ? `<p class="post-meta"><time datetime="${esc(article.date)}">${esc(fmtDate(article.date))}</time>${
        article.updated && article.updated !== article.date
          ? ` · updated ${esc(fmtDate(article.updated))}`
          : ""
      }</p>`
    : "";

  const body = `<article class="post">
  <p class="eyebrow"><a href="/learn">Learn</a></p>
  <h1>${esc(article.title)}</h1>
  ${dateLine}
  ${article.html}

  <div class="post-cta">
    <p><b>Enough theory — how sharp are your eyes?</b></p>
    <p><a class="cta" href="/">Play today's HUEMAN #${today} →</a></p>
  </div>

  ${keepReading}

  <div class="disclaimer">
    HUEMAN is a game, not a medical color vision test, and cannot diagnose color blindness.
    If you have concerns about your color vision, see an eye care professional.
  </div>
</article>`;

  const head = `${extraCss}\n<script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).send(
    shell(
      { title: `${article.title} | HUEMAN`, description: article.description, canonical, accentHue: brandHue(today), head },
      body
    )
  );
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
