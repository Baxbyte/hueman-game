/* index.html is a standalone static file with no build step, so the climb
   styles have to exist there as well as in api/_lib/climb.ts for the
   server-rendered pages. Rather than trust two hand-maintained copies, this
   writes one into the other. `--check` fails instead of writing, so the test
   suite can catch drift. */
import { readFileSync, writeFileSync } from "node:fs";

const root = process.argv[2] || ".";
const check = process.argv.includes("--check");
const src = readFileSync(`${root}/api/_lib/climb.ts`, "utf8");
const m = /export const CLIMB_CSS = `([\s\S]*?)`;/.exec(src);
if (!m) throw new Error("CLIMB_CSS not found in api/_lib/climb.ts");
const css = m[1].trim();

const htmlPath = `${root}/index.html`;
const html = readFileSync(htmlPath, "utf8");
const START = "  /* climb:start", END = "  /* climb:end */";
const a = html.indexOf(START), b = html.indexOf(END);
if (a < 0 || b < 0) throw new Error("climb markers not found in index.html");
const head = html.slice(a, html.indexOf("\n", a) + 1);

const block = head + css.split("\n").map((l) => (l ? "  " + l : l)).join("\n") + "\n" + END;
const next = html.slice(0, a) + block + html.slice(b + END.length);

if (check) {
  if (next !== html) {
    console.error("✗ climb CSS in index.html has drifted from api/_lib/climb.ts — run: npm run sync:climb");
    process.exit(1);
  }
  console.log("  ✓ climb CSS matches api/_lib/climb.ts");
} else {
  writeFileSync(htmlPath, next);
  console.log("synced climb CSS into index.html");
}
