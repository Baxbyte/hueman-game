import { ImageResponse } from "@vercel/og";
import type { VercelRequest, VercelResponse } from "@vercel/node";

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
  const DAY = Math.max(1, Math.floor((todayUTC - EPOCH_UTC) / 86400000) + 1);

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

  const secsToMidnight = Math.max(60, Math.floor((todayUTC + 86400000 - now.getTime()) / 1000));
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", `public, max-age=0, s-maxage=${secsToMidnight}`);
  res.status(200).send(buf);
}
