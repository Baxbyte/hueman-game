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

    // ---- Unlimited board -------------------------------------------------
    // `scores` is the PURE daily board: a player's first, unassisted run only,
    // written once and never overwritten. Unlimited is the second board, where
    // extra (credit-funded) runs and boosted runs compete. Every free run is
    // mirrored here too, so a free player with one great run can still top it —
    // buying credits buys more attempts, never a head start.
    // This board shipped as "Overdrive" and was renamed to "Unlimited". Carry
    // the existing rows across rather than stranding them in an orphaned table.
    //
    // Order matters: this MUST run before the CREATE below. If CREATE ran first
    // it would make an empty scores_unlimited, the rename would then be skipped
    // because the target exists, and every live row would be left behind in
    // scores_od with the board silently reading as empty.
    await db`
      DO $mig$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = current_schema() AND table_name = 'scores_od')
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = current_schema() AND table_name = 'scores_unlimited')
        THEN
          ALTER TABLE scores_od RENAME TO scores_unlimited;
          IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'scores_od_day_score_idx') THEN
            ALTER INDEX scores_od_day_score_idx RENAME TO scores_unlimited_day_score_idx;
          END IF;
        END IF;
      END
      $mig$;
    `;
    await db`
      CREATE TABLE IF NOT EXISTS scores_unlimited (
        day     integer NOT NULL,
        pid     text    NOT NULL,
        name    text    NOT NULL,
        country text    NOT NULL,
        level   integer NOT NULL,
        time_ms integer NOT NULL,
        score   bigint  NOT NULL,
        runs    integer NOT NULL DEFAULT 1,
        boosted boolean NOT NULL DEFAULT false,
        ts      bigint  NOT NULL,
        PRIMARY KEY (day, pid)
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS scores_unlimited_day_score_idx
        ON scores_unlimited (day, score DESC)
    `;

    // ---- credits ---------------------------------------------------------
    // Balances live server-side and are keyed by the same anonymous pid the
    // leaderboard uses, so buying credits still needs no account. `restore` is
    // a short human-typable code so a player who clears site data (or moves to
    // a second device) can pull a paid balance back.
    await db`
      CREATE TABLE IF NOT EXISTS wallets (
        pid      text PRIMARY KEY,
        credits  integer NOT NULL DEFAULT 0,
        restore  text    NOT NULL,
        created  bigint  NOT NULL,
        updated  bigint  NOT NULL
      )
    `;
    await db`
      CREATE UNIQUE INDEX IF NOT EXISTS wallets_restore_idx ON wallets (restore)
    `;

    // Append-only audit trail for every credit in and out. `ref` carries the
    // Stripe checkout session id on purchases; the unique index makes webhook
    // redelivery a no-op rather than a double credit.
    await db`
      CREATE TABLE IF NOT EXISTS credit_ledger (
        id    bigserial PRIMARY KEY,
        pid   text    NOT NULL,
        day   integer NOT NULL,
        kind  text    NOT NULL,
        item  text    NOT NULL,
        delta integer NOT NULL,
        ref   text,
        ts    bigint  NOT NULL
      )
    `;
    await db`
      CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_ref_idx
        ON credit_ledger (ref) WHERE ref IS NOT NULL
    `;

    // Email addresses given at checkout. `marketing` is stored separately from
    // the row's existence on purpose: everyone who buys gets a transactional
    // receipt (they asked for it by paying), but only an explicit tick puts
    // them on the daily list. Conflating the two is how people end up on
    // mailing lists they never joined.
    await db`
      CREATE TABLE IF NOT EXISTS subscribers (
        email     text PRIMARY KEY,
        pid       text,
        source    text    NOT NULL,
        marketing boolean NOT NULL DEFAULT false,
        created   bigint  NOT NULL,
        updated   bigint  NOT NULL
      )
    `;
    await db`
      CREATE INDEX IF NOT EXISTS subscribers_marketing_idx
        ON subscribers (marketing) WHERE marketing
    `;

    // One row per paid/boosted run so run numbers can't be replayed and the
    // Unlimited board can show how many attempts a score took.
    await db`
      CREATE TABLE IF NOT EXISTS runs (
        day     integer NOT NULL,
        pid     text    NOT NULL,
        n       integer NOT NULL,
        lives   integer NOT NULL,
        time_mult integer NOT NULL,
        used    boolean NOT NULL DEFAULT false,
        ts      bigint  NOT NULL,
        PRIMARY KEY (day, pid, n)
      )
    `;
  })().catch((err) => {
    // Don't cache a failed init — let the next request retry.
    ensured = null;
    throw err;
  });
  return ensured;
}
