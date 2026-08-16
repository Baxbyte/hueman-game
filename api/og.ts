import { ImageResponse } from "@vercel/og";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { decodeResult } from "./_lib/result.js";
import {
  climbPos, missLevelsFromCells, clusterMisses, listLevels, distinctLevels,
  MAX_LEVEL, AVG_LEVEL,
} from "./_lib/climb.js";

// Mirrors the daily seed + color math in index.html so the card always shows today's real hue.
const EPOCH_UTC = Date.UTC(2026, 5, 11);

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function delta(level: number) {
  const dL = Math.max(2.2, 20 * Math.pow(0.875, level - 1));
  const dH = Math.max(3, 16 * Math.pow(0.88, level - 1));
  return { dL, dH };
}

const el = (type: string, style: Record<string, unknown>, children?: unknown) => ({
  type,
  props: { style, ...(children !== undefined ? { children } : {}) },
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const TODAY = Math.max(1, Math.floor((todayUTC - EPOCH_UTC) / 86400000) + 1);
  const secsToMidnight = Math.max(60, Math.floor((todayUTC + 86400000 - now.getTime()) / 1000));

  // Personalized result card for /r/[id] share pages (?r=<token>). Renders the
  // player's level + their result squares — no puzzle answer, so no spoiler.
  const rToken = Array.isArray(req.query.r) ? req.query.r[0] : req.query.r;
  const decoded = rToken ? decodeResult(rToken) : null;
  if (decoded && decoded.day <= TODAY) {
    const rr = mulberry32(decoded.day * 7919 + 13);
    const rHue = Math.floor(rr() * 360);
    const rAccent = `hsl(${rHue}, 70%, 55%)`;
    // A full-width climb across the bottom rather than a grid of squares: at
    // timeline-thumbnail size a wide bar with a big number stays legible where
    // 42 small cells turn to mush.
    const rMiss = missLevelsFromCells(decoded.cells);
    const TX = 70, TW = 1060, TY = 430, TH = 56;
    const atPct = (p: number) => TX + (TW * p) / 100;
    const rFill = (TW * climbPos(decoded.level)) / 100;
    const rHead = Math.min(TX + TW - 6, Math.max(TX, atPct(climbPos(decoded.level)) - 3));
    const rCard = el(
      "div",
      {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#0E0E12",
        color: "#F4F2EC",
        padding: "56px 70px",
        position: "relative",
      },
      [
        el("div", { display: "flex", fontSize: 56, fontWeight: 800 }, [
          el("span", { color: rAccent }, "HUE"),
          el("span", {}, "MAN"),
          el("span", { color: "#8C8C98", fontSize: 32, marginLeft: 16, marginTop: 20 }, `#${decoded.day}`),
        ]),
        el("div", { display: "flex", alignItems: "flex-end", marginTop: 26 }, [
          el("span", { fontSize: 150, fontWeight: 800, color: rAccent, lineHeight: 1 }, `${decoded.level}`),
          el("span", { fontSize: 44, color: "#8C8C98", marginLeft: 18, marginBottom: 22 }, `of ${MAX_LEVEL} levels`),
        ]),
        el("div", { display: "flex", fontSize: 38, fontWeight: 700, marginTop: 10 }, "Can you beat them?"),

        el("div", { position: "absolute", left: TX, top: TY, width: TW, height: TH, display: "flex",
                    background: "#17171D", border: "2px solid #2A2A33", borderRadius: TH / 2 }),
        el("div", { position: "absolute", left: TX, top: TY, width: rFill, height: TH, display: "flex",
                    borderRadius: TH / 2,
                    backgroundImage: `linear-gradient(90deg, #1E2A33 0%, ${rAccent} 100%)` }),
        el("div", { position: "absolute", left: atPct(climbPos(AVG_LEVEL)), top: TY, width: 2, height: TH,
                    display: "flex", background: "#8C8C98", opacity: 0.7 }),
        // Lives lost are gaps cut in the page colour, so they read on any hue.
        ...clusterMisses(rMiss).map((c) =>
          el("div", { position: "absolute", left: atPct(c.pos) - 5, top: TY - 2, width: 10, height: TH + 4,
                      display: "flex", background: "#0E0E12", border: "1px solid #E0524D" })),
        el("div", { position: "absolute", left: rHead, top: TY - 5, width: 6, height: TH + 10,
                    display: "flex", background: "#F4F2EC", borderRadius: 3 }),
        el("div", { position: "absolute", left: TX, top: TY + TH + 12, display: "flex", fontSize: 24, color: "#8C8C98" }, "Level 1"),
        el("div", { position: "absolute", left: TX + TW - 96, top: TY + TH + 12, display: "flex", fontSize: 24, color: "#8C8C98" }, `Level ${MAX_LEVEL}`),
        el("div", { position: "absolute", left: TX, top: TY + TH + 58, display: "flex", fontSize: 28, color: "#8C8C98" },
          rMiss.length
            ? `${rMiss.length} ${rMiss.length > 1 ? "lives" : "life"} lost at level${distinctLevels(rMiss) > 1 ? "s" : ""} ${listLevels(rMiss)}  ·  huemangame.com`
            : `No lives lost  ·  huemangame.com`),
      ]
    );
    const rImg = new ImageResponse(rCard as any, { width: 1200, height: 630 });
    const rBuf = Buffer.from(await rImg.arrayBuffer());
    res.setHeader("Content-Type", "image/png");
    // Result cards are immutable (the run never changes); today's still cache-safe.
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
    return res.status(200).send(rBuf);
  }

  // Optional ?day=N for archive cards. Only PAST, completed days are honored so
  // today's live puzzle is never spoiled; anything else falls back to today.
  const dayParam = Number(Array.isArray(req.query.day) ? req.query.day[0] : req.query.day);
  const isPastDay = Number.isFinite(dayParam) && dayParam >= 1 && dayParam < TODAY;
  const DAY = isPastDay ? Math.trunc(dayParam) : TODAY;

  const rng = mulberry32(DAY * 7919 + 13);
  const h = Math.floor(rng() * 360);
  const s = 55 + Math.floor(rng() * 30);
  const l = 42 + Math.floor(rng() * 20);

  // Teaser grid at level-6 difficulty: visible if you look, not trivial.
  const { dL, dH } = delta(6);
  const sL = rng() < 0.5 ? -1 : 1;
  const sH = rng() < 0.5 ? -1 : 1;
  const base = `hsl(${h}, ${s}%, ${l}%)`;
  const oddH = Math.round((h + sH * dH + 360) % 360);
  const oddL = Math.round(Math.min(92, Math.max(8, l + sL * dL)));
  const odd = `hsl(${oddH}, ${s}%, ${oddL}%)`;
  const accent = `hsl(${h}, 70%, 55%)`;
  const oddIdx = Math.floor(rng() * 16);

  const tiles = Array.from({ length: 16 }, (_, i) =>
    el("div", {
      width: 116,
      height: 116,
      borderRadius: 18,
      background: i === oddIdx ? odd : base,
    })
  );

  const card = el(
    "div",
    {
      width: "100%",
      height: "100%",
      display: "flex",
      background: "#0E0E12",
      color: "#F4F2EC",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "60px 70px",
    },
    [
      el("div", { display: "flex", flexDirection: "column", maxWidth: 540 }, [
        el("div", { display: "flex", fontSize: 76, fontWeight: 800 }, [
          el("span", { color: accent }, "HUE"),
          el("span", {}, "MAN"),
          el("span", { color: "#8C8C98", fontSize: 40, marginLeft: 18, marginTop: 28 }, `#${DAY}`),
        ]),
        el("div", { fontSize: 38, marginTop: 26 }, "One tile is a different shade."),
        el("div", { fontSize: 38, fontWeight: 700, color: accent }, "Can you spot it?"),
        el("div", { fontSize: 26, color: "#8C8C98", marginTop: 34 }, "One puzzle a day · Same for everyone on Earth"),
        el("div", { fontSize: 26, color: "#8C8C98", marginTop: 6 }, "huemangame.com"),
      ]),
      el(
        "div",
        {
          display: "flex",
          flexWrap: "wrap",
          width: 510,
          height: 510,
          gap: 14,
          alignContent: "flex-start",
        },
        tiles
      ),
    ]
  );

  const img = new ImageResponse(card as any, { width: 1200, height: 630 });
  const buf = Buffer.from(await img.arrayBuffer());

  res.setHeader("Content-Type", "image/png");
  // Past-day cards are immutable; today's card expires at the UTC rollover.
  res.setHeader(
    "Cache-Control",
    isPastDay
      ? "public, max-age=86400, s-maxage=604800, immutable"
      : `public, max-age=0, s-maxage=${secsToMidnight}`
  );
  res.status(200).send(buf);
}
