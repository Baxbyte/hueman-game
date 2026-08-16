/**
 * The climb — one way of drawing a run, shared by every surface that renders one.
 *
 * The run used to be a row of hue-matched emoji squares. The hue carried no
 * information: six of the seven glyphs all meant "cleared a level", and the one
 * glyph that meant something (a life lost) was the faintest thing in the row.
 * Noise was loud and signal was quiet, the count never equalled the score, and
 * a strong run ran to sixty-odd squares.
 *
 * The fix follows from the shape of the data: levels cleared is unbounded
 * (1..60), lives lost is always at most a handful. So draw the unbounded thing
 * continuously — a track filled to the level you reached — and the bounded
 * thing discretely, as notches cut out of that track. Constant footprint at
 * three levels or sixty, and the failures finally have room to be labelled.
 */

export const MAX_LEVEL = 60;
/** Roughly the median run; drawn as a reference mark so a score has context. */
export const AVG_LEVEL = 9;

/**
 * Position along the track, 0..100.
 *
 * Deliberately non-linear. On a linear scale the median run (~level 9) fills
 * 15% of the bar and reads as failure, which is both discouraging and untrue —
 * late levels cost far more than early ones. The gamma curve puts the average
 * player just past a third and keeps the top of the ladder looking reachable.
 */
export const CLIMB_GAMMA = 0.55;
export function climbPos(level: number): number {
  const t = Math.min(1, Math.max(0, level / MAX_LEVEL));
  return t ? Math.pow(t, CLIMB_GAMMA) * 100 : 0;
}

/**
 * Which levels a run died on, from the encoded cells (0-5 cleared, 6 = miss).
 * The same walk works on a live run's history and on a decoded share link, so
 * nothing needs storing or migrating — every existing /r/ URL still renders.
 */
export function missLevelsFromCells(cells: number[]): number[] {
  const out: number[] = [];
  let cleared = 0;
  for (const c of cells) {
    if (c === 6) out.push(cleared + 1);
    else cleared++;
  }
  return out;
}

export type Cluster = { pos: number; n: number; levels: number[] };

/**
 * Merge notches that would otherwise overlap. Losing two lives on the same
 * level is common, and at 1% apart they'd render as one smudge; merged, they
 * become a single notch labelled ✕2.
 */
export const CLUSTER_PCT = 4.5;
export function clusterMisses(levels: number[]): Cluster[] {
  const out: Cluster[] = [];
  for (const lv of [...levels].sort((a, b) => a - b)) {
    const p = climbPos(lv);
    const last = out[out.length - 1];
    if (last && p - last.pos < CLUSTER_PCT) {
      last.levels.push(lv);
      last.n++;
      last.pos = last.levels.reduce((s, l) => s + climbPos(l), 0) / last.n;
    } else {
      out.push({ pos: p, n: 1, levels: [lv] });
    }
  }
  return out;
}

/**
 * "6, 11 and 12" — and "5 (x3)" when a run died repeatedly on the same level,
 * which is common and reads as a typo if listed as "5, 5 and 5".
 */
export function listLevels(a: number[]): string {
  if (!a.length) return "";
  const runs: { lv: number; n: number }[] = [];
  for (const lv of [...a].sort((x, y) => x - y)) {
    const last = runs[runs.length - 1];
    if (last && last.lv === lv) last.n++;
    else runs.push({ lv, n: 1 });
  }
  const parts = runs.map((r) => (r.n > 1 ? `${r.lv} (\u00d7${r.n})` : String(r.lv)));
  if (parts.length < 2) return parts[0];
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

/** How many distinct levels a run died on — drives level/levels pluralisation. */
export function distinctLevels(a: number[]): number {
  return new Set(a).size;
}

/** One sentence for screen readers, replacing "15 coloured squares". */
export function climbLabel(level: number, missLevels: number[], who = "They"): string {
  const lost = missLevels.length;
  return (
    `${who} reached level ${level} of ${MAX_LEVEL}. ` +
    (lost
      ? `${lost} ${lost > 1 ? "lives" : "life"} lost, at level${distinctLevels(missLevels) > 1 ? "s" : ""} ${listLevels(missLevels)}.`
      : `No lives lost.`)
  );
}

/** Server-rendered track markup (used by /r/[id]; the client mirrors this). */
export function climbTrackHtml(level: number, missLevels: number[], who = "They"): string {
  const pos = climbPos(level).toFixed(2);
  const clusters = clusterMisses(missLevels);
  const marks = clusters
    .map((c) => `<span style="--pos:${c.pos.toFixed(2)}%">✕${c.n > 1 ? c.n : ""}</span>`)
    .join("");
  const notches = clusters
    .map((c) => `<i class="rc-notch" style="--pos:${c.pos.toFixed(2)}%"></i>`)
    .join("");
  const avg = climbPos(AVG_LEVEL).toFixed(2);
  return (
    `<div class="rc-marks" aria-hidden="true">${marks}</div>` +
    `<div class="rc-track" role="img" aria-label="${climbLabel(level, missLevels, who)}">` +
    `<i class="rc-fill" style="--pos:${pos}%"></i>` +
    `<i class="rc-avg" style="--pos:${avg}%"></i>` +
    `<i class="rc-head" style="--pos:${pos}%"></i>${notches}</div>` +
    `<div class="rc-scale" aria-hidden="true"><span class="rc-s-a">1</span>` +
    `<span class="rc-s-avg" style="--pos:${avg}%">avg ${AVG_LEVEL}</span>` +
    `<span class="rc-s-b">${MAX_LEVEL}</span></div>`
  );
}

/**
 * Styles for the track. Shared verbatim between index.html and the
 * server-rendered pages so the same run can never look like two things.
 * Reads --daily, which every page shell already sets to the day's accent hue.
 */
export const CLIMB_CSS = `
.rc-marks{position:relative;height:14px}
.rc-marks span{position:absolute;bottom:0;left:clamp(6px,var(--pos),calc(100% - 6px));
  transform:translateX(-50%);font-size:.68rem;font-weight:800;line-height:1;
  color:var(--miss);white-space:nowrap;font-variant-numeric:tabular-nums}
.rc-track{position:relative;height:var(--rc-h,30px);background:var(--surface);
  border:1px solid var(--line);border-radius:999px;overflow:hidden}
.rc-track i{position:absolute;top:0;bottom:0;display:block}
.rc-fill{left:0;width:var(--pos);border-radius:999px 0 0 999px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--daily) 45%,var(--ink)) 0%,var(--daily) 100%)}
.rc-fill::after{content:"";position:absolute;inset:0;
  background:repeating-linear-gradient(90deg,transparent 0 15px,rgba(244,242,236,.10) 15px 16px)}
/* Near-white cap: where the run stopped stays legible with no colour perception
   at all, which matters because --daily is a different random hue every day. */
.rc-head{width:4px;border-radius:2px;left:clamp(4px,var(--pos),calc(100% - 4px));
  transform:translateX(-50%);background:var(--text);box-shadow:0 0 0 1px rgba(14,14,18,.55)}
/* A life lost is a gap cut through the climb in the page colour — a hole reads
   on every hue and in greyscale, where a red mark on a red day would vanish. */
.rc-notch{width:5px;left:clamp(4px,var(--pos),calc(100% - 4px));transform:translateX(-50%);
  background:var(--ink);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--miss) 70%,transparent)}
.rc-avg{width:0;border-left:1px dashed var(--muted);opacity:.7;
  left:clamp(1px,var(--pos),calc(100% - 1px))}
.rc-ghost{width:0;left:clamp(5px,var(--pos),calc(100% - 5px));transform:translateX(-50%);
  border-left:2px dotted var(--text);opacity:.45}
.rc-ghost[hidden]{display:none!important}
.rc-scale{position:relative;height:15px;margin-top:5px}
.rc-scale span{position:absolute;top:0;font-size:.66rem;font-weight:600;color:var(--muted);
  letter-spacing:.04em;white-space:nowrap}
.rc-s-a{left:0}.rc-s-b{right:0}
.rc-s-avg{left:clamp(0px,var(--pos),calc(100% - 34px));transform:translateX(-50%)}
.rc-key{margin-top:10px;padding-top:9px;border-top:1px solid var(--line);
  font-size:.7rem;line-height:1.45;color:var(--muted)}
.rc-key b{color:var(--miss);font-weight:800}
@media (prefers-reduced-motion:no-preference){
  .rc-fill{animation:rcGrow .5s cubic-bezier(.22,.9,.3,1) both}
  @keyframes rcGrow{from{width:0}to{width:var(--pos)}}
}
@media (forced-colors:active){
  .rc-track{border:1px solid CanvasText}
  .rc-fill{background:Highlight;forced-color-adjust:none}
  .rc-head,.rc-notch{background:CanvasText;forced-color-adjust:none}
}`;
