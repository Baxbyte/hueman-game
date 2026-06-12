# HUEMAN — The Daily Color Game

One color puzzle a day. Same for everyone on Earth. Spot the odd shade before the clock runs out and find out how good your eyes really are.

No words, no downloads, no excuses.

A [Puzzle Page](https://puzzlepage.app) game — play more daily games or create your own at puzzlepage.app.

## Play

Live at **https://hueman-game.vercel.app**, or open `index.html` in any browser.

## Features

- **Beat the clock** — every level has a shrinking time limit (11.6s at level 1, down to a 5s floor). Running out of time costs a life, same as a wrong tap. Your total time appears in your result and share card.
- **Wordle-style sharing** — emoji grid of your run (one square per level, hue-matched; ⬛ = miss) with your level, time, percentile, and the game link. Uses the native share sheet on mobile, clipboard on desktop.
- **Get notified** — 🔔 in the header offers browser alerts for the daily drop and a downloadable `.ics` daily calendar reminder that syncs to phone, computer, and email.
- **Streaks & stats** — played, best level, current and max streak, saved on-device.

## How the daily puzzle works

There is no build or publish step. The puzzle is derived deterministically in the browser from the UTC date:

1. `DAY = days since 2026-06-11 (UTC) + 1` — the puzzle number.
2. The RNG is seeded with `mulberry32(DAY * 7919 + 13)`, so every player on Earth gets the identical sequence of colors, grids, and odd-tile positions for that day.
3. At midnight UTC the seed changes and a new puzzle exists automatically. An in-page watcher detects the rollover, fires a notification (if enabled), and reloads to the new puzzle once your run is finished.

The site is static and deploys on Vercel from `main` — as long as it's served, a new puzzle "publishes" itself every day with zero maintenance.
