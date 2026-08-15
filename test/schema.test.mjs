/* Verifies the credits + two-board SQL against a real Postgres (PGlite).
   The DDL is read out of api/_lib/db.ts so this can never test a stale copy. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const ROOT = process.argv[2];
const src = readFileSync(ROOT + "/api/_lib/db.ts", "utf8");

// Every `await db`...`` in ensureSchema is a parameterless DDL statement.
const ddl = [...src.matchAll(/await db`([\s\S]*?)`;/g)].map((m) => m[1].trim());
if (ddl.length < 8) throw new Error("expected the full DDL set, got " + ddl.length);

const db = new PGlite();
for (const stmt of ddl) await db.exec(stmt);
console.log(`schema: ${ddl.length} statements applied ✓`);

const ok = [];
const bad = [];
const check = (name, cond, detail = "") => (cond ? ok : bad).push(name + (detail ? " — " + detail : ""));

const q = async (text, params) => (await db.query(text, params)).rows;

/* ---- 1. wallet creation is idempotent (no repeat welcome grant) ---- */
const mkWallet = (pid) =>
  q(
    `INSERT INTO wallets (pid, credits, restore, created, updated)
     VALUES ($1, 3, $2, 0, 0) ON CONFLICT (pid) DO NOTHING RETURNING credits`,
    [pid, "AAAA-" + pid.slice(0, 4)]
  );
await mkWallet("player01");
const second = await mkWallet("player01");
const w1 = await q(`SELECT credits FROM wallets WHERE pid='player01'`);
check("wallet: welcome grant applied once", second.length === 0 && w1[0].credits === 3, `credits=${w1[0].credits}`);

/* ---- 2. ledger ref uniqueness makes webhook redelivery a no-op ---- */
const credit = (ref) =>
  q(
    `INSERT INTO credit_ledger (pid, day, kind, item, delta, ref, ts)
     VALUES ('player01', 66, 'purchase', 'hue30', 30, $1, 0)
     ON CONFLICT (ref) WHERE ref IS NOT NULL DO NOTHING RETURNING id`,
    [ref]
  );
const first = await credit("cs_test_123");
const replay = await credit("cs_test_123");
check("webhook: same session id credits once", first.length === 1 && replay.length === 0);
if (first.length) await q(`UPDATE wallets SET credits = credits + 30 WHERE pid='player01'`);

/* NULL refs (spends) must still be insertable many times over. */
await q(`INSERT INTO credit_ledger (pid,day,kind,item,delta,ref,ts) VALUES ('player01',66,'spend','rerun',-3,NULL,0)`);
await q(`INSERT INTO credit_ledger (pid,day,kind,item,delta,ref,ts) VALUES ('player01',66,'spend','rerun',-3,NULL,0)`);
const spends = await q(`SELECT count(*)::int c FROM credit_ledger WHERE ref IS NULL AND kind='spend'`);
check("ledger: partial unique index allows many NULL refs", spends[0].c === 2, `rows=${spends[0].c}`);

/* ---- 3. guarded debit can never go negative ---- */
await q(`UPDATE wallets SET credits = 3 WHERE pid='player01'`);
const debit = (cost) =>
  q(`UPDATE wallets SET credits = credits - $1 WHERE pid='player01' AND credits >= $1 RETURNING credits`, [cost]);
const d1 = await debit(3);
const d2 = await debit(3);
const bal = await q(`SELECT credits FROM wallets WHERE pid='player01'`);
check(
  "debit: second spend refused, balance never negative",
  d1.length === 1 && d2.length === 0 && bal[0].credits === 0,
  `balance=${bal[0].credits}`
);

/* ---- 4. Daily board is frozen after the first run ---- */
const daily = (level, time, score, name) =>
  q(
    `INSERT INTO scores (day,pid,name,country,level,time_ms,score,ts)
     VALUES (66,'player01',$1,'US',$2,$3,$4,0)
     ON CONFLICT (day,pid) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country`,
    [name, level, time, score]
  );
await daily(12, 90000, 12 * 1e7 - 90, "Ada");
await daily(40, 10000, 40 * 1e7 - 10, "Ada"); // a much better later run
const pure = await q(`SELECT level, name FROM scores WHERE day=66 AND pid='player01'`);
check("Daily board: later runs cannot overwrite the first", pure[0].level === 12, `level=${pure[0].level}`);

await daily(40, 10000, 40 * 1e7 - 10, "Ada Lovelace"); // rename only
const renamed = await q(`SELECT level, name FROM scores WHERE day=66 AND pid='player01'`);
check(
  "Daily board: display name still follows a rename",
  renamed[0].name === "Ada Lovelace" && renamed[0].level === 12
);

/* ---- 5. Overdrive keeps the best run, and counts every attempt ---- */
const od = (level, time, score, runs, boosted) =>
  q(
    `INSERT INTO scores_od (day,pid,name,country,level,time_ms,score,runs,boosted,ts)
     VALUES (66,'player01','Ada','US',$1,$2,$3,$4,$5,0)
     ON CONFLICT (day,pid) DO UPDATE SET
       name=EXCLUDED.name, country=EXCLUDED.country, level=EXCLUDED.level,
       time_ms=EXCLUDED.time_ms, score=EXCLUDED.score,
       boosted=EXCLUDED.boosted, ts=EXCLUDED.ts
     WHERE EXCLUDED.score > scores_od.score`,
    [level, time, score, runs, boosted]
  );
const bump = (runs) => q(`UPDATE scores_od SET runs = GREATEST(runs,$1) WHERE day=66 AND pid='player01'`, [runs]);

await od(12, 90000, 12 * 1e7 - 90, 1, false); await bump(1);
await od(18, 80000, 18 * 1e7 - 80, 2, true);  await bump(2);
await od(15, 20000, 15 * 1e7 - 20, 3, true);  await bump(3); // worse level, must not win
const odRow = await q(`SELECT level, runs, boosted FROM scores_od WHERE day=66 AND pid='player01'`);
check("Overdrive: best run wins", odRow[0].level === 18, `level=${odRow[0].level}`);
check("Overdrive: attempts counted even when the run lost", odRow[0].runs === 3, `runs=${odRow[0].runs}`);

/* A free player with one strong run outranks a paying player's best. */
await q(`INSERT INTO scores_od (day,pid,name,country,level,time_ms,score,runs,boosted,ts)
         VALUES (66,'freebie1','Grace','GB',24,60000,${24 * 1e7 - 60},1,false,0)`);
const top = await q(`SELECT pid, runs FROM scores_od WHERE day=66 ORDER BY score DESC LIMIT 1`);
check("Overdrive: a free single run can top the board", top[0].pid === "freebie1" && top[0].runs === 1);

/* ---- 6. rank query matches the ORDER BY the board uses ---- */
const rank = await q(`SELECT count(*)::int better FROM scores_od WHERE day=66 AND score > ${18 * 1e7 - 80}`);
check("rank: Overdrive rank counts better scores", rank[0].better + 1 === 2, `rank=${rank[0].better + 1}`);

/* ---- 7. run rows are unique per attempt (no token replay minting) ---- */
await q(`INSERT INTO runs (day,pid,n,lives,time_mult,used,ts) VALUES (66,'player01',1,4,140,false,0)`);
let dup = false;
try {
  await q(`INSERT INTO runs (day,pid,n,lives,time_mult,used,ts) VALUES (66,'player01',1,4,140,false,0)`);
} catch { dup = true; }
check("runs: a run number can only be issued once", dup);

console.log("\n" + ok.map((s) => "  ✓ " + s).join("\n"));
if (bad.length) {
  console.log("\n" + bad.map((s) => "  ✗ " + s).join("\n"));
  process.exit(1);
}
console.log(`\n${ok.length}/${ok.length} SQL checks passed`);
