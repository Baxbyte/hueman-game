import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Resolve the Postgres connection from whatever the provisioned store exposes.
// Vercel's Neon integration (and the legacy Vercel Postgres one) wire several
// aliases into the environment; supporting all of them means the leaderboard
// works regardless of how the database was connected, with no code changes
// after provisioning. Prefer a pooled connection when one is offered.
let sql: NeonQueryFunction<false, false> | null = null;

function connectionString(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ""
  );
}

export function getSql(): NeonQueryFunction<false, false> {
  if (sql) return sql;
  const url = connectionString();
  if (!url) throw new Error("db_not_configured");
  sql = neon(url);
  return sql;
}

// Guard schema creation behind a per-instance promise so a warm function only
// pays the round trip once. CREATE ... IF NOT EXISTS keeps it idempotent across
// concurrent cold starts.
let ensured: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (ensured) return ensured;
  const db = getSql();
  ensured = (async () => {
    await db`
      CREATE TABLE IF NOT EXISTS scores (
        day     integer NOT NULL,
        pid     text    NOT NULL,
        name    text    NOT NULL,
        country text    NOT NULL,
        level   integer NOT NULL,
        time_ms integer NOT NULL,
        score   bigint  NOT NULL,
        ts      bigint  NOT NULL,
        PRIMARY KEY (day, pid)
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS scores_day_score_idx
        ON scores (day, score DESC)
    `;
    await db`
      CREATE TABLE IF NOT EXISTS rate_limits (
        day integer NOT NULL,
        ip  text    NOT NULL,
        n   integer NOT NULL DEFAULT 0,
        PRIMARY KEY (day, ip)
      )
    `;
  })().catch((err) => {
    // Don't cache a failed init — let the next request retry.
    ensured = null;
    throw err;
  });
  return ensured;
}
