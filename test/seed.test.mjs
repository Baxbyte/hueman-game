/* Guards the seeding decision that left Unlimited empty on every day that
   already existed when the board was introduced. */
import { boardsToSeed, seedRowsForDay } from "../api/_lib/seed.ts";

const ok = [], bad = [];
const check = (n, c, d = "") => (c ? ok : bad).push(n + (d ? " — " + d : ""));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---- the regression ----------------------------------------------------
   A day seeded before Unlimited existed has holders in `scores` and none in
   `scores_unlimited`. The original code inferred "already seeded" from `scores`
   alone and returned early, so those days never got an Unlimited board. */
check(
  "a day with Daily holders but no Unlimited holders still seeds Unlimited",
  eq(boardsToSeed(true, false), ["unlimited"]),
  JSON.stringify(boardsToSeed(true, false))
);

check("a brand new day seeds both boards", eq(boardsToSeed(false, false), ["daily", "unlimited"]));
check("a fully seeded day seeds nothing", eq(boardsToSeed(true, true), []));
check(
  "the mirror case seeds only Daily",
  eq(boardsToSeed(false, true), ["daily"]),
  JSON.stringify(boardsToSeed(false, true))
);

/* ---- holders themselves are unchanged ---- */
const a = seedRowsForDay(66);
const b = seedRowsForDay(66);
check("holder rows are deterministic for a given day", eq(a, b), `${a.length} rows`);
check("a day produces a populated board", a.length >= 15, `${a.length} holders`);
check(
  "holder pids stay namespaced so they remain removable",
  a.every((r) => /^seed-\d+$/.test(r.pid))
);
check("different days differ", !eq(seedRowsForDay(66), seedRowsForDay(67)));

console.log(ok.map((s) => "  ✓ " + s).join("\n"));
if (bad.length) {
  console.log("\n" + bad.map((s) => "  ✗ " + s).join("\n"));
  process.exit(1);
}
console.log(`\n${ok.length}/${ok.length} seeding checks passed`);
