/* The climb is rendered by four separate code paths (the game, /r pages, the OG
   image, the player card). These guard the maths they all share, plus the
   drift risk of index.html carrying its own copy of the CSS. */
import { execFileSync } from "node:child_process";
import {
  climbPos, missLevelsFromCells, clusterMisses, listLevels, distinctLevels,
  climbLabel, MAX_LEVEL, AVG_LEVEL, CLUSTER_PCT,
} from "../api/_lib/climb.ts";

const ok = [], bad = [];
const check = (n, c, d = "") => (c ? ok : bad).push(n + (d ? " — " + d : ""));

/* ---- the curve ---- */
check("a level-1 run is still visible", climbPos(1) > 5, climbPos(1).toFixed(1) + "%");
check("a full clear fills the track", climbPos(MAX_LEVEL) === 100);
check("level 0 is empty", climbPos(0) === 0);
check("out-of-range levels clamp", climbPos(999) === 100 && climbPos(-5) === 0);
check("the curve rises monotonically",
  Array.from({length: MAX_LEVEL}, (_, i) => climbPos(i + 1)).every((v, i, a) => i === 0 || v > a[i-1]));
// A linear scale would put the median run at 15% and make it read as failure.
check("the average run sits about a third along",
  climbPos(AVG_LEVEL) > 30 && climbPos(AVG_LEVEL) < 40, climbPos(AVG_LEVEL).toFixed(1) + "%");

/* ---- deriving misses from the stored cells (0-5 cleared, 6 = miss) ---- */
check("misses are attributed to the level they happened on",
  JSON.stringify(missLevelsFromCells([0,1,2,6,3,6,6])) === JSON.stringify([4,5,5]),
  JSON.stringify(missLevelsFromCells([0,1,2,6,3,6,6])));
check("a clean run has no misses", missLevelsFromCells([0,1,2,3]).length === 0);
check("an all-miss run reads as level 1", JSON.stringify(missLevelsFromCells([6,6,6])) === JSON.stringify([1,1,1]));

/* ---- clustering: overlapping notches must merge, distant ones must not ---- */
const same = clusterMisses([5,5,5]);
check("three deaths on one level merge into one notch", same.length === 1 && same[0].n === 3);
const spread = clusterMisses([2, 30, 58]);
check("distant deaths stay separate", spread.length === 3);
check("clusters stay inside the track",
  clusterMisses([1, MAX_LEVEL]).every(c => c.pos >= 0 && c.pos <= 100));
const adjacent = clusterMisses([40, 41]);
check("adjacent late levels merge (they render closer than " + CLUSTER_PCT + "%)", adjacent.length === 1);

/* ---- prose: the bug found in the browser ---- */
check('repeated levels read as "5 (×3)", not "5, 5 and 5"',
  listLevels([5,5,5]) === "5 (×3)", listLevels([5,5,5]));
check("distinct levels list naturally", listLevels([6,11,12]) === "6, 11 and 12", listLevels([6,11,12]));
check("mixed runs combine both forms", listLevels([6,6,12]) === "6 (×2) and 12", listLevels([6,6,12]));
check("one level needs no conjunction", listLevels([9]) === "9");
check("pluralisation follows distinct levels, not lives",
  distinctLevels([5,5,5]) === 1 && distinctLevels([6,11,12]) === 3);

/* ---- the accessible description replaces "15 coloured squares" ---- */
const label = climbLabel(12, [6,11,12]);
check("the label states level, ceiling and every death",
  label.includes("level 12 of 60") && label.includes("3 lives lost") && label.includes("6, 11 and 12"), label);
check("a clean run says so", climbLabel(20, []).includes("No lives lost"));

/* ---- index.html carries its own copy of the CSS; prove it hasn't drifted ---- */
try {
  execFileSync("node", ["tools/sync-climb-css.mjs", ".", "--check"], { stdio: "pipe" });
  check("index.html's climb CSS matches api/_lib/climb.ts", true);
} catch (e) {
  check("index.html's climb CSS matches api/_lib/climb.ts", false, "run: npm run sync:climb");
}

console.log(ok.map((s) => "  ✓ " + s).join("\n"));
if (bad.length) {
  console.log("\n" + bad.map((s) => "  ✗ " + s).join("\n"));
  process.exit(1);
}
console.log(`\n${ok.length}/${ok.length} climb checks passed`);
