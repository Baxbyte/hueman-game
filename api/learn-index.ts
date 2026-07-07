import type { VercelRequest, VercelResponse } from "@vercel/node";
import { currentDay } from "./_lib/day.js";
import { brandHue } from "./_lib/puzzle.js";
import { listArticles } from "./_lib/content.js";
import { shell, esc, SITE_URL } from "./_lib/page.js";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const today = currentDay();
  const articles = listArticles();

  const cardsHtml = articles.length
    ? articles
        .map(
          (a) => `<a class="learn-card" href="/learn/${a.slug}">
        <h2>${esc(a.title)}</h2>
        <p>${esc(a.blurb)}</p>
        <span class="learn-more">Read →</span>
      </a>`
        )
        .join("")
    : `<p class="lede">Guides are on the way. In the meantime, <a href="/">play today's puzzle</a>.</p>`;

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "HUEMAN — Learn",
    url: `${SITE_URL}/learn`,
    description: "Guides on playing HUEMAN better and on how color vision works.",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    hasPart: articles.map((a) => ({
      "@type": "Article",
      headline: a.title,
      url: `${SITE_URL}/learn/${a.slug}`,
    })),
  };

  const extraCss = `<style>
    .learn-list{display:grid;gap:14px;margin:24px 0}
    .learn-card{display:block;padding:20px;border:1px solid var(--line);border-radius:16px;
      background:var(--surface);color:var(--text)}
    .learn-card:hover{border-color:var(--muted);text-decoration:none}
    .learn-card h2{margin:0 0 8px;font-size:1.2rem}
    .learn-card p{margin:0 0 10px;color:var(--muted);font-size:.95rem}
    .learn-more{color:var(--daily);font-weight:700;font-size:.9rem}
  </style>`;

  const body = `<h1>Learn</h1>
<p class="lede">How to see better, play sharper, and understand the weird, wonderful science of color.</p>
<p><a class="cta" href="/">Play today's HUEMAN #${today} →</a></p>
<div class="learn-list">${cardsHtml}</div>`;

  const head = `${extraCss}\n<script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).send(
    shell(
      {
        title: "Learn — HUEMAN Color Game Guides & Color Vision Explainers",
        description:
          "Guides on getting better at HUEMAN plus clear explainers on color perception — how many colors humans see, whether you can train color vision, and the science behind The Dress.",
        canonical: `${SITE_URL}/learn`,
        accentHue: brandHue(today),
        head,
      },
      body
    )
  );
}
