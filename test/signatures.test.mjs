/* Exercises the two signature paths that money depends on:
   the run token that authorises an Unlimited run, and Stripe's webhook signature. */
import { createHmac } from "node:crypto";
import Stripe from "stripe";

process.env.HUEMAN_RUN_SECRET = "test-secret-for-verification-only";
const { mintRunToken, verifyRunToken } = await import("../api/_lib/token.ts");

const ok = [], bad = [];
const check = (n, c, d = "") => (c ? ok : bad).push(n + (d ? " — " + d : ""));
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

/* ---- run tokens ---- */
const claims = { pid: "player01aaaa", day: 66, n: 2, lives: 4, m: 140 };
const token = mintRunToken(claims);
const back = verifyRunToken(token);
check(
  "token: round-trips its claims",
  back && back.pid === claims.pid && back.day === 66 && back.n === 2 && back.lives === 4 && back.m === 140,
  JSON.stringify(back)
);

const [body, mac] = token.split(".");
// Re-encode the payload with more lives, keeping the original signature.
const forgedBody = Buffer.from(JSON.stringify({ ...claims, lives: 99, e: Date.now() + 6e5 }))
  .toString("base64url");
check("token: tampered payload is rejected", verifyRunToken(forgedBody + "." + mac) === null);
check("token: tampered signature is rejected", verifyRunToken(body + "." + mac.slice(0, -1) + "X") === null);
check("token: garbage is rejected", verifyRunToken("nonsense") === null && verifyRunToken(null) === null);

const expired = Buffer.from(JSON.stringify({ ...claims, e: Date.now() - 1000 })).toString("base64url");
const expiredSig = createHmac("sha256", process.env.HUEMAN_RUN_SECRET).update(expired).digest("base64url");
check("token: expired token is rejected", verifyRunToken(expired + "." + expiredSig) === null);

// A token minted under a different secret must not validate.
process.env.HUEMAN_RUN_SECRET = "a-completely-different-secret";
check("token: token from another secret is rejected", verifyRunToken(token) === null);
process.env.HUEMAN_RUN_SECRET = "test-secret-for-verification-only";
check("token: valid again under the right secret", verifyRunToken(token) !== null);

/* ---- Stripe webhook signatures --------------------------------------------
   Verification is the SDK's, so what's under test is that /api/stripe-webhook
   feeds it correctly: the RAW request bytes, and the header as sent. */
const stripe = new Stripe("sk_test_not_a_real_key");
const whsec = "whsec_testonly";
const event = { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } };
const payload = Buffer.from(JSON.stringify(event));
const header = (buf, opts = {}) =>
  stripe.webhooks.generateTestHeaderString({ payload: buf.toString(), secret: whsec, ...opts });

const parsed = stripe.webhooks.constructEvent(payload, header(payload), whsec);
check("webhook: a genuine signature passes and parses", parsed.type === "checkout.session.completed");

const modified = Buffer.from(JSON.stringify({ ...event, id: "evt_2" }));
check(
  "webhook: a modified body fails",
  throws(() => stripe.webhooks.constructEvent(modified, header(payload), whsec))
);
check(
  "webhook: the wrong secret fails",
  throws(() => stripe.webhooks.constructEvent(payload, header(payload), "whsec_wrong"))
);
check(
  "webhook: a stale timestamp fails (replay guard)",
  throws(() =>
    stripe.webhooks.constructEvent(
      payload,
      header(payload, { timestamp: Math.floor(Date.now() / 1000) - 3600 }),
      whsec
    )
  )
);
check(
  "webhook: a header with no signature fails",
  throws(() => stripe.webhooks.constructEvent(payload, `t=${Math.floor(Date.now() / 1000)}`, whsec))
);

/* The reason api/stripe-webhook.ts sets bodyParser:false. If the body were
   parsed and re-serialized, key order and spacing shift and the bytes Stripe
   signed no longer exist — every real webhook would fail. */
const reserialized = Buffer.from(JSON.stringify(JSON.parse(payload.toString()), null, 2));
check(
  "webhook: a re-serialized body fails (raw bytes are required)",
  throws(() => stripe.webhooks.constructEvent(reserialized, header(payload), whsec))
);

console.log(ok.map((s) => "  ✓ " + s).join("\n"));
if (bad.length) {
  console.log("\n" + bad.map((s) => "  ✗ " + s).join("\n"));
  process.exit(1);
}
console.log(`\n${ok.length}/${ok.length} signature checks passed`);
