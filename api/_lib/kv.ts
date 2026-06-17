import { createClient, type VercelKV } from "@vercel/kv";

// Resolve the Redis/KV connection from whatever the provisioned store exposes.
// Vercel's first-party KV uses the KV_ prefix; the Upstash-via-Marketplace
// integration may instead expose UPSTASH_ / REDIS_ prefixed REST credentials.
// Supporting all of them means the leaderboard works regardless of how the
// store was connected, with no code changes after provisioning.
let client: VercelKV | null = null;

export function getKv(): VercelKV {
  if (client) return client;
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_API_URL ||
    "";
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_API_TOKEN ||
    "";
  if (!url || !token) {
    throw new Error("kv_not_configured");
  }
  client = createClient({ url, token });
  return client;
}
