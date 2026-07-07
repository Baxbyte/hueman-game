// Markdown-backed article system for /learn. Articles are plain .md files with
// YAML-ish frontmatter under content/learn/ — adding one requires no code
// changes. This module discovers, parses, and renders them.
//
// Files are read from disk at runtime. vercel.json's functions `includeFiles`
// globs content/learn/** into the bundles of the functions that need it
// (api/learn.ts, api/learn-index.ts, api/sitemap.ts), so the markdown ships
// with the deployment.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CONTENT_DIR = join(process.cwd(), "content", "learn");

export type ArticleMeta = {
  slug: string;
  title: string; // <title> / h1
  description: string; // meta description
  date: string; // ISO yyyy-mm-dd (publication)
  updated?: string; // ISO yyyy-mm-dd
  blurb: string; // short teaser for the index
};

export type Article = ArticleMeta & { html: string };

/** Minimal frontmatter parser: `key: value` lines between leading `---` fences. */
function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (!m) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) data[key] = val;
  }
  return { data, body: m[2] };
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Inline markdown: links, bold, italic, code. Run AFTER block escaping. */
function inline(s: string): string {
  return escHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
      const external = /^https?:\/\//.test(href) && !href.includes("huemangame.com");
      const rel = external ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${href}"${rel}>${text}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

/**
 * Tiny, dependency-free markdown → HTML for the subset our articles use:
 * ## / ### headings, paragraphs, - bullet lists, blockquotes, and inline marks.
 */
function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      closeList();
      i++;
      continue;
    }
    if (/^###\s+/.test(line)) {
      closeList();
      out.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`);
      i++;
      continue;
    }
    if (/^##\s+/.test(line)) {
      closeList();
      out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      i++;
      continue;
    }
    // paragraph: gather until blank line
    const buf: string[] = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#|>|[-*]\s)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    closeList();
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  closeList();
  return out.join("\n");
}

function readDir(): string[] {
  try {
    return readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

function toMeta(slug: string, data: Record<string, string>): ArticleMeta {
  return {
    slug,
    title: data.title ?? slug,
    description: data.description ?? "",
    date: data.date ?? "",
    updated: data.updated || undefined,
    blurb: data.blurb ?? data.description ?? "",
  };
}

/** All article metadata, newest first. Safe if the content dir is missing. */
export function listArticles(): ArticleMeta[] {
  const metas: ArticleMeta[] = [];
  for (const file of readDir()) {
    try {
      const raw = readFileSync(join(CONTENT_DIR, file), "utf8");
      const { data } = parseFrontmatter(raw);
      metas.push(toMeta(file.replace(/\.md$/, ""), data));
    } catch {
      /* skip unreadable file */
    }
  }
  return metas.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Full article (meta + rendered HTML) by slug, or null if not found. */
export function getArticle(slug: string): Article | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    const raw = readFileSync(join(CONTENT_DIR, `${slug}.md`), "utf8");
    const { data, body } = parseFrontmatter(raw);
    return { ...toMeta(slug, data), html: renderMarkdown(body) };
  } catch {
    return null;
  }
}
