import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getKv } from "./_lib/kv.js";
import { currentDay } from "./_lib/day.js";
import {
  TOP_N,
  lbKey,
  metaKey,
  rankForScore,
  type MetaEntry,
} from "./_lib/board.js";

function qInt(v: VercelRequest["query"][string]): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const today = currentDay();
  // Default to today; allow viewing recent days only (within the key TTL window).
  const requested = qInt(req.query.day);
  const day =
    requested != null && requested <= today && requested >= today - 13
      ? requested
      : today;

  const pid = typeof req.query.pid === "string" ? req.query.pid : "";
  const geoRaw = req.headers["x-vercel-ip-country"];
  const geo = (Array.isArray(geoRaw) ? geoRaw[0] : geoRaw) || "";

  try {
    const kv = getKv();

    // Top N members (highest composite score first) + their display meta.
    const flat = (await kv.zrange(lbKey(day), 0, TOP_N - 1, {
      rev: true,
      withScores: true,
    })) as (string | number)[];

    const members: string[] = [];
    for (let i = 0; i < flat.length; i += 2) members.push(String(flat[i]));

    let top: Array<{ rank: number; name: string; country: string; level: number; timeMs: number }> = [];
    if (members.length) {
      const metas = (await kv.mget(
        ...members.map((m) => metaKey(day, m))
      )) as (MetaEntry | null)[];
      top = members.map((_m, i) => {
        const meta = metas[i];
        return {
          rank: i + 1,
          name: meta?.name ?? "Anonymous",
          country: meta?.country ?? "ZZ",
          level: meta?.level ?? 0,
          timeMs: meta?.timeMs ?? 0,
        };
      });
    }

    const total = await kv.zcard(lbKey(day));

    let me: { rank: number; level: number; timeMs: number } | null = null;
    if (pid) {
      const score = (await kv.zscore(lbKey(day), pid)) as number | null;
      if (score != null) {
        const meta = (await kv.get<MetaEntry>(metaKey(day, pid))) as MetaEntry | null;
        me = {
          rank: await rankForScore(day, Number(score)),
          level: meta?.level ?? 0,
          timeMs: meta?.timeMs ?? 0,
        };
      }
    }

    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=15");
    return res.status(200).json({ day, total, top, me, geo });
  } catch (err: any) {
    const unconfigured = err && err.message === "kv_not_configured";
    return res
      .status(unconfigured ? 503 : 500)
      .json({ error: unconfigured ? "storage_unavailable" : "server_error", day, geo });
  }
}
