import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSchema } from "./_lib/db.js";
import { currentDay } from "./_lib/day.js";
import {
  PID_RE,
  SPEND,
  MAX_LIVES,
  BASE_LIVES,
  SLOW_CLOCK_MULT,
  WELCOME_CREDITS,
  publicPacks,
  getWallet,
  restoreWallet,
  underLimit,
} from "./_lib/credits.js";

// A wallet is created on first sight and comes with free credits, so an
// unbounded endpoint would let one machine farm Unlimited entries by inventing
// pids. A real player's client hits this a handful of times a day.
const WALLET_LIMIT = 100;
// Restore codes protect a paid balance, so guessing attempts get a tight cap.
const RESTORE_LIMIT = 10;

function clientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : (xff || "").split(",")[0];
  return (raw || "unknown").trim();
}

/**
 * GET  /api/wallet?pid=…            → balance, restore code, store catalogue
 * POST /api/wallet {pid, restore}   → move a paid balance onto this pid
 *
 * `storeOpen` tells the client whether checkout is actually wired up. When it
 * is false the game hides the buy buttons entirely rather than showing prices
 * that lead nowhere — free play is unaffected either way.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const storeOpen = !!process.env.STRIPE_SECRET_KEY;

  const readPid = (v: unknown) => (typeof v === "string" && PID_RE.test(v) ? v : null);

  const catalogue = {
    packs: publicPacks(),
    spend: SPEND,
    rules: {
      baseLives: BASE_LIVES,
      maxLives: MAX_LIVES,
      slowClockMult: SLOW_CLOCK_MULT,
      welcomeCredits: WELCOME_CREDITS,
    },
    storeOpen,
  };

  try {
    if (req.method === "GET") {
      const pid = readPid(req.query.pid);
      if (!pid) return res.status(400).json({ error: "bad_pid" });
      await ensureSchema();
      if (!(await underLimit(currentDay(), "wallet", clientIp(req), WALLET_LIMIT))) {
        return res.status(429).json({ error: "rate_limited", ...catalogue });
      }
      const w = await getWallet(pid);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ credits: w.credits, restore: w.restore, ...catalogue });
    }

    if (req.method === "POST") {
      let body: any = req.body;
      if (typeof body === "string") {
        if (body.length > 2000) return res.status(413).json({ error: "too_large" });
        try {
          body = JSON.parse(body);
        } catch {
          return res.status(400).json({ error: "bad_json" });
        }
      }
      const pid = readPid(body?.pid);
      if (!pid) return res.status(400).json({ error: "bad_pid" });
      const code = typeof body?.restore === "string" ? body.restore : "";
      await ensureSchema();
      if (!(await underLimit(currentDay(), "restore", clientIp(req), RESTORE_LIMIT))) {
        return res.status(429).json({ error: "rate_limited", ...catalogue });
      }
      const w = await restoreWallet(code, pid);
      if (!w) return res.status(404).json({ error: "bad_restore" });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ credits: w.credits, restore: w.restore, ...catalogue });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err: any) {
    const unconfigured = err && err.message === "db_not_configured";
    return res
      .status(unconfigured ? 503 : 500)
      .json({ error: unconfigured ? "storage_unavailable" : "server_error", ...catalogue });
  }
}
