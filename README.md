# HUEMAN — The Daily Color Game

One color puzzle a day. Same for everyone on Earth. Spot the odd shade before the clock runs out and find out how good your eyes really are.

No words, no downloads, no excuses.

A [Puzzle Page](https://puzzlepage.app) game — play more daily games or create your own at puzzlepage.app.

## Play

Live at **https://huemangame.com**, or open `index.html` in any browser.

## Features

- **Beat the clock** — every level has a shrinking time limit (11.6s at level 1, down to a 5s floor). Running out of time costs a life, same as a wrong tap. Your total time appears in your result and share card.
- **Wordle-style sharing** — a fixed ten-cell progress bar in the day's accent hue, with your level out of 60, time, percentile, where you lost lives, and the game link. Uses the native share sheet on mobile, clipboard on desktop.
- **Get notified** — 🔔 in the header offers browser alerts for the daily drop and a downloadable `.ics` daily calendar reminder that syncs to phone, computer, and email.
- **Streaks & stats** — played, best level, current and max streak, saved on-device.

## How a run is displayed — the climb

A finished run used to render as a row of hue-matched emoji squares. That artifact had a fundamental problem: **the hue carried no information.** Six of the seven glyphs (🟥🟧🟨🟩🟦🟪) all meant "cleared a level" — the colour was a fresh random hue per level, unrelated to difficulty, speed, or anything the player did. The only glyph that meant something, ⬛ for a life lost, was the faintest thing in the row. Noise was loud, signal was quiet. The square count never equalled the score either (one square per *attempt*, so a Level 12 run showed up to 15), and a strong run ran past sixty glyphs.

The replacement follows from the shape of the data. Levels cleared is unbounded (1–60); lives lost is always at most a handful. So the unbounded thing is drawn **continuously** — a track filled to the level reached — and the bounded thing **discretely**, as notches cut out of that track. The footprint is constant whether you scored 3 or 60.

- **Non-linear scale** (`γ = 0.55`). On a linear track the median run (~level 9) fills 15% and reads as failure, which is both discouraging and untrue — late levels cost far more than early ones. The curve puts the average player just past a third.
- **Hue is never load-bearing.** Where the run stopped is a near-white cap (17:1 against the track); a life lost is a *gap* cut in the page colour. Both read in greyscale and under any colour vision deficiency — which matters, because `--daily` is a different random hue every day and the FAQ explicitly promises CVD playability.
- **Screen readers get one sentence** ("Reached level 12 of 60… Lost 3 lives, at levels 6, 11 and 12"), not fifteen announced squares.

`api/_lib/climb.ts` is the single source of truth, shared by the game, `/r/` pages, the OG image and the canvas player card. `index.html` is a standalone static file with no build step, so it carries its own copy of the track CSS — `npm run sync:climb` writes one into the other, and `npm test` fails if they drift.

The pasted share text stays text-only emoji (that's the viral loop) but becomes a **fixed ten-cell bar**: constant length for any run, obviously a progress bar, with `Level 12 of 60` above it acting as its own legend. Nothing needed migrating — the display derives from data already stored, so every existing `/r/` link still renders.

## Two boards: Daily and Unlimited

The free game is unchanged and always will be: one ranked run a day, three lives, standard clock, no account. What's new is a second board sitting beside it.

| | **🌍 Daily** | **⚡ Unlimited** |
|---|---|---|
| Who's on it | Everyone's **first** run of the day | Everyone's **best** run of the day |
| Lives / clock | Always 3 lives, standard clock | Whatever that run used |
| Extra runs | Impossible | Yes, funded by credits |
| Can money move a row? | **No** | It buys attempts, not position |

A free player's single run is entered on **both** boards automatically. That's the load-bearing detail: someone who never spends a cent can still top Unlimited, and nothing bought can displace anyone on Daily. Attempt counts are shown publicly on Unlimited (`⚡3`), so a bought-in score is never mistaken for a one-shot.

Server-side, `scores` is the Daily board — written once per player per day and then frozen (a later run can update a display name, never a score). `scores_unlimited` is Unlimited, best-run-wins. It shipped as `scores_od` when the board was called Overdrive; `ensureSchema` renames it in place, and `/api/leaderboard` still answers to `board=overdrive` for cached clients.

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

## Ads

The site runs Google AdSense (publisher `ca-pub-7140062618355569`). The loader sits in `<head>` on every surface — `index.html` for the game, and `api/_lib/page.ts`'s shell for `/r/`, `/archive` and `/learn` — plus `ads.txt` at the root, which Google requires to confirm who is authorised to sell the inventory.

The script is `async`, so it can never block first paint or the first tap, and the game is fully playable if it is blocked or fails to load — verified with an ad blocker's effect simulated by the domain not yet being approved.

Two deliberate constraints on where ad units may go, once the site is approved:

- **Never adjacent to the board.** The game is a grid of tappable tiles under time pressure. An ad unit near it would collect accidental clicks, which is both a bad experience and an AdSense policy violation ("publishers may not implement ads in a way that results in accidental clicks"). Ad units belong below the fold, in the about/FAQ region, or between content blocks on `/learn` and `/archive`.
- **Never inside a paid flow.** No ads in the credit store, the checkout return screen, or the Unlimited card.

Note that adding ads made the previous "no ads" copy in the FAQ, the Product Hunt block and `llms.txt` untrue; all three were rewritten rather than left to be spotted by a player.

## Practice rounds

**One free practice round a day**, on top of the daily puzzle itself. Practice uses random colors rather than the day's puzzle and has never been ranked — it doesn't touch streaks, stats, or either board. The cap exists so "one more go" has somewhere to land: past it, the game offers an Unlimited run instead of an endless free loop that makes the ranked day feel pointless.

Tracked in `localStorage` (`hm_prac`), like streaks and history. A determined player can clear site data and practice again — the same trade the whole no-account model already makes, and not worth an account to close.

## Receipts and email

Email is **optional** at checkout. When given, three things happen:

1. Stripe sends its own payment receipt (`receipt_email` on the payment intent).
2. We send a credits email through Puzzle Page's Resend account containing the credit count and — the part that actually matters — **the restore code**. Credits live in one browser; that code is the only way back to them.
3. The address is recorded in the `subscribers` table.

Consent for the daily list is a **separate checkbox**, stored as `subscribers.marketing`. Paying for credits gets you a transactional receipt because you asked for it by paying; it does not put you on a mailing list. The upsert only ever ratchets consent up, so a later purchase without the tick can't silently unsubscribe someone.

None of it can fail a purchase: credits are granted first, both email functions swallow their own errors, and the whole block is skipped on webhook redelivery so a Stripe retry can't mail the same person twice.

| Variable | Required | What it does |
|---|---|---|
| `RESEND_API_KEY` | for receipt emails | Puzzle Page's Resend key. Without it, purchases still work and Stripe still receipts; only the credits/restore-code email is skipped. |
| `EMAIL_FROM` | optional | Defaults to `HUEMAN <credits@puzzlepage.app>`. Must be on a Resend-verified domain — `puzzlepage.app` is verified. |

### Payment setup

Checkout uses the official [`stripe`](https://www.npmjs.com/package/stripe) SDK with **inline `price_data`**, so there is nothing to create in the Stripe dashboard — no products, no price objects. Point it at any existing Stripe account and the packs above become the catalogue.

Set these on the Vercel project (Production + Preview):

| Variable | Required | What it does |
|---|---|---|
| `STRIPE_SECRET_KEY` | to sell credits | Opens the store. Without it the store shows a "not switched on yet" notice, free credits still work, and the daily game is untouched. |
| `STRIPE_WEBHOOK_SECRET` | to sell credits | Signing secret for the webhook below. Credits are **only** ever granted here — never from the browser's return trip. |
| `HUEMAN_RUN_SECRET` | optional | Signs Unlimited run tokens. Falls back to `DATABASE_URL` if unset. |

Then add one webhook endpoint in Stripe pointing at `https://huemangame.com/api/stripe-webhook`, subscribed to `checkout.session.completed` and `checkout.session.async_payment_succeeded`.

Redelivery is safe: purchases are keyed on the Checkout Session id in `credit_ledger`, and a repeat delivery inserts nothing and credits nothing.

## Tests

```bash
npm test
```

`test/schema.test.mjs` runs the real DDL — read straight out of `api/_lib/db.ts`, so it can't test a stale copy — against an in-process Postgres and asserts the money-critical semantics: the welcome grant applies once, a replayed webhook credits once, a debit can never go negative, the Daily board is frozen after the first run, and a free single run can top Unlimited. `test/signatures.test.mjs` covers run-token verification (tampering, expiry, wrong secret) and asserts the webhook feeds Stripe's verifier correctly — including that a re-serialized body fails, which is why the route disables the body parser.

`npm run typecheck` type-checks the API.

## How the daily puzzle works

There is no build or publish step. The puzzle is derived deterministically in the browser from the UTC date:

1. `DAY = days since 2026-06-11 (UTC) + 1` — the puzzle number.
2. The RNG is seeded with `mulberry32(DAY * 7919 + 13)`, so every player on Earth gets the identical sequence of colors, grids, and odd-tile positions for that day.
3. At midnight UTC the seed changes and a new puzzle exists automatically. An in-page watcher detects the rollover, fires a notification (if enabled), and reloads to the new puzzle once your run is finished.

The site is static and deploys on Vercel from `main` — as long as it's served, a new puzzle "publishes" itself every day with zero maintenance.
