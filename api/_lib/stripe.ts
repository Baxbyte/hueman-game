import Stripe from "stripe";

/**
 * Shared Stripe client.
 *
 * Built lazily and cached per instance: the store is optional, so a deployment
 * with no key must still serve the free game rather than crash at import time.
 * Reusing one client across warm invocations also reuses its HTTP connections.
 */
let client: Stripe | null = null;
let clientKey = "";

/** The configured client, or null when the store isn't switched on. */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // Rebuild if the key was rotated under a warm instance.
  if (!client || clientKey !== key) {
    client = new Stripe(key, {
      // Vercel Functions can be recycled aggressively; a bounded retry keeps a
      // transient network blip from surfacing as a failed purchase.
      maxNetworkRetries: 2,
      timeout: 15_000,
      appInfo: { name: "HUEMAN", url: "https://huemangame.com" },
    });
    clientKey = key;
  }
  return client;
}

export type { Stripe };
