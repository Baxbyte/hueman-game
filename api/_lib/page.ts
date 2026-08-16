// Server-rendered HTML shell for content pages (archive, learn, result cards).
// Mirrors index.html's design system so new pages look native: same fonts,
// palette, wordmark, and footer. Kept intentionally lightweight — one shared
// Google Fonts link (already used by the homepage, so it's warm in cache), all
// other CSS inlined, no JS, no render-blocking additions.

export const SITE_URL = "https://huemangame.com";
export const PUZZLEPAGE_URL = "https://www.puzzlepage.app/play";

export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type ShellOpts = {
  title: string;
  description: string;
  canonical: string; // absolute URL
  accentHue?: number; // today's/day's hue for --daily tint
  ogImage?: string; // absolute URL; defaults to /api/og
  ogTitle?: string;
  ogDescription?: string;
  robots?: string; // e.g. "noindex, follow"; omit for default indexable
  head?: string; // extra <head> HTML (JSON-LD, etc.)
  bodyClass?: string;
};

import { CLIMB_CSS } from "./climb.js";

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#0E0E12;--surface:#17171D;--surface-2:#1F1F27;--line:#2A2A33;
  --text:#F4F2EC;--muted:#8C8C98;--daily:#4FA8D8;--miss:#E0524D;
}
html{-webkit-text-size-adjust:100%}
body{
  background:var(--ink);color:var(--text);
  font-family:'Inter',system-ui,sans-serif;line-height:1.6;
  padding:24px 20px 64px;-webkit-font-smoothing:antialiased;
}
.wrap{max-width:720px;margin:0 auto}
a{color:var(--daily);text-decoration:none}
a:hover{text-decoration:underline}
header.site{display:flex;align-items:center;justify-content:space-between;
  padding-bottom:20px;margin-bottom:28px;border-bottom:1px solid var(--line)}
.wordmark{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;
  font-size:1.5rem;letter-spacing:-.02em}
.wordmark .hue{color:var(--daily)}.wordmark .man{color:var(--text)}
.wordmark:hover{text-decoration:none}
.nav a{color:var(--muted);font-size:.9rem;margin-left:16px;font-weight:600}
.nav a:hover{color:var(--text)}
h1{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;
  font-size:clamp(1.7rem,5vw,2.4rem);line-height:1.15;letter-spacing:-.02em;margin-bottom:10px}
h2{font-family:'Bricolage Grotesque',sans-serif;font-weight:700;
  font-size:1.35rem;margin:32px 0 12px;letter-spacing:-.01em}
h3{font-weight:700;font-size:1.08rem;margin:24px 0 8px}
p{margin:0 0 14px}
.muted{color:var(--muted)}
.lede{font-size:1.08rem;color:var(--muted);margin-bottom:24px}
.eyebrow{font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--daily);margin-bottom:8px}
.cta{display:inline-block;background:var(--daily);color:var(--ink);font-weight:700;
  padding:13px 22px;border-radius:12px;margin:8px 0;transition:transform .1s ease}
.cta:hover{text-decoration:none;transform:translateY(-1px)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px}
.pager{display:flex;justify-content:space-between;gap:12px;margin:28px 0}
.pager a,.pager span{flex:1;padding:12px 14px;border:1px solid var(--line);border-radius:12px;
  font-size:.9rem;color:var(--muted)}
.pager a:hover{border-color:var(--muted);color:var(--text);text-decoration:none}
.pager .next{text-align:right}
.pager .disabled{opacity:.35}
.disclaimer{font-size:.82rem;color:var(--muted);border:1px solid var(--line);
  border-radius:12px;padding:14px 16px;margin:20px 0;line-height:1.55}
footer.site{margin-top:48px;padding-top:24px;border-top:1px solid var(--line);
  color:var(--muted);font-size:.85rem;line-height:1.7}
footer.site a{color:var(--muted);font-weight:600}footer.site a:hover{color:var(--text)}
.motif{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:100%;
  max-width:280px;aspect-ratio:1;margin:0 auto}
.motif div{border-radius:12px}

${CLIMB_CSS}
`;

/** Shared site header (wordmark links home; small nav). */
export function header(): string {
  return `<header class="site">
  <a class="wordmark" href="/"><span class="hue">HUE</span><span class="man">MAN</span></a>
  <nav class="nav">
    <a href="/">Play</a>
    <a href="/archive">Archive</a>
    <a href="/learn">Learn</a>
  </nav>
</header>`;
}

/** Shared site footer. */
export function footer(): string {
  return `<footer class="site">
  One puzzle a day · Same for everyone on Earth<br>
  A <a href="${PUZZLEPAGE_URL}" rel="noopener">Puzzle Page</a> game — play more &amp;
  create your own at <a href="${PUZZLEPAGE_URL}" rel="noopener">puzzlepage.app</a>.
  <br><br>
  <span class="muted">HUEMAN is a game, not a medical color vision test, and cannot diagnose
  color blindness. If you have concerns about your color vision, see an eye care professional.</span>
</footer>`;
}

/** Full HTML document. */
export function shell(opts: ShellOpts, body: string): string {
  const {
    title, description, canonical,
    accentHue, ogImage = `${SITE_URL}/api/og`,
    ogTitle = title, ogDescription = description, robots, head = "", bodyClass = "",
  } = opts;
  const accentCss =
    accentHue != null ? `<style>:root{--daily:hsl(${accentHue} 70% 55%)}</style>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${robots ? `<meta name="robots" content="${esc(robots)}">\n` : ""}<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDescription)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="HUEMAN">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(ogDescription)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<meta name="theme-color" content="#0E0E12">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${BASE_CSS}</style>${accentCss}
${head}</head>
<body class="${bodyClass}">
<div class="wrap">
${header()}
${body}
${footer()}
</div>
</body>
</html>`;
}
