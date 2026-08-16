# HUEMAN — The Daily Color Game

One color puzzle a day. Same for everyone on Earth. Spot the odd shade before the clock runs out and find out how good your eyes really are.

No words, no downloads, no excuses.

A [Puzzle Page](https://puzzlepage.app) game — play more daily games or create your own at puzzlepage.app.

## Play

Live at **https://huemangame.com**, or open `index.html` in any browser.

## Features

- **Beat the clock** — every level has a shrinking time limit (11.6s at level 1, down to a 5s floor). Running out of time costs a life, same as a wrong tap. Your total time appears in your result and share card.
- **Wordle-style sharing** — emoji grid of your run (one square per level, hue-matched; ⬛ = miss) with your level, time, percentile, and the game link. Uses the native share sheet on mobile, clipboard on desktop.
- **Get notified** — 🔔 in the header offers browser alerts for the daily drop and a downloadable `.ics` daily calendar reminder that syncs to phone, computer, and email.
- **Streaks & stats** — played, best level, current and max streak, saved on-device.

## Two boards: Daily and Overdrive

The free game is unchanged and always will be: one ranked run a day, three lives, standard clock, no account. What's new is a second board sitting beside it.

| | **🌍 Daily** | **⚡ Overdrive** |
|---|---|---|
| Who's on it | Everyone's **first** run of the day | Everyone's **best** run of the day |
| Lives / clock | Always 3 lives, standard clock | Whatever that run used |
| Extra runs | Impossible | Yes, funded by credits |
| Can money move a row? | **No** | It buys attempts, not position |

A free player's single run is entered on **both** boards automatically. That's the load-bearing detail: someone who never spends a cent can still top Overdrive, and nothing bought can displace anyone on Daily. Attempt counts are shown publicly on Overdrive (`⚡3`), so a bought-in score is never mistaken for a one-shot.

Server-side, `scores` is the Daily board — written once per player per day and then frozen (a later run can update a display name, never a score). `scores_od` is Overdrive, best-run-wins.

## Credits

Credits buy extra attempts at the same puzzle everyone else got. They never make the odd tile easier to see.

| Spend | Cost | Effect |
|---|---|---|
| Extra run | 3 credits | A fresh ranked attempt at today's puzzle |
| Extra life | 2 credits | Start with 4 lives (or 5 for 4 credits) |
| Slow clock | 2 credits | 40% more time on every level of that run |

Every wallet is created with **3 free credits**, so a player's first extra run always costs nothing.

| Pack | Price | Per credit | Extra runs |
|---|---|---|---|
| 10 credits | $1.99 | 19.9¢ | 3 |
| 30 credits | $4.99 | 16.6¢ | 10 |
| 100 credits | $12.99 | 13.0¢ | 33 |
| 500 credits | $39.99 | 8.0¢ | 166 |

Prices are anchored to two market reference points: the $0.99–$1.99 impulse band casual games use for "keep playing", and the ~$40/yr that NYT Games, Puzzmo Plus and GeoGuessr Pro all converge on for a daily-puzzle habit. Nothing is priced below $1.99 because fixed processing fees eat ~30% of a $0.99 charge.

Packs and spend costs live in one place — [`api/_lib/credits.ts`](api/_lib/credits.ts). Changing a price is a code change.

### Payment setup

Checkout uses the official [`stripe`](https://www.npmjs.com/package/stripe) SDK with **inline `price_data`**, so there is nothing to create in the Stripe dashboard — no products, no price objects. Point it at any existing Stripe account and the packs above become the catalogue.

Set these on the Vercel project (Production + Preview):

| Variable | Required | What it does |
|---|---|---|
| `STRIPE_SECRET_KEY` | to sell credits | Opens the store. Without it the store shows a "not switched on yet" notice, free credits still work, and the daily game is untouched. |
| `STRIPE_WEBHOOK_SECRET` | to sell credits | Signing secret for the webhook below. Credits are **only** ever granted here — never from the browser's return trip. |
| `HUEMAN_RUN_SECRET` | optional | Signs Overdrive run tokens. Falls back to `DATABASE_URL` if unset. |

Then add one webhook endpoint in Stripe pointing at `https://huemangame.com/api/stripe-webhook`, subscribed to `checkout.session.completed` and `checkout.session.async_payment_succeeded`.

Redelivery is safe: purchases are keyed on the Checkout Session id in `credit_ledger`, and a repeat delivery inserts nothing and credits nothing.

## Tests

```bash
npm test
```

`test/schema.test.mjs` runs the real DDL — read straight out of `api/_lib/db.ts`, so it can't test a stale copy — against an in-process Postgres and asserts the money-critical semantics: the welcome grant applies once, a replayed webhook credits once, a debit can never go negative, the Daily board is frozen after the first run, and a free single run can top Overdrive. `test/signatures.test.mjs` covers run-token verification (tampering, expiry, wrong secret) and asserts the webhook feeds Stripe's verifier correctly — including that a re-serialized body fails, which is why the route disables the body parser.

`npm run typecheck` type-checks the API.

## How the daily puzzle works

There is no build or publish step. The puzzle is derived deterministically in the browser from the UTC date:

1. `DAY = days since 2026-06-11 (UTC) + 1` — the puzzle number.
2. The RNG is seeded with `mulberry32(DAY * 7919 + 13)`, so every player on Earth gets the identical sequence of colors, grids, and odd-tile positions for that day.
3. At midnight UTC the seed changes and a new puzzle exists automatically. An in-page watcher detects the rollover, fires a notification (if enabled), and reloads to the new puzzle once your run is finished.

The site is static and deploys on Vercel from `main` — as long as it's served, a new puzzle "publishes" itself every day with zero maintenance.
