/* Exercises the two signature paths that money depends on:
   the run token that authorises an Overdrive run, and Stripe's webhook signature. */
import { createHmac } from "node:crypto";

process.env.HUEMAN_RUN_SECRET = "test-secret-for-verification-only";
const { mintRunToken, verifyRunToken } = await import("../api/_lib/token.ts");
const { verifyStripeSignature: verify } = await import("../api/_lib/stripe-sig.ts");

const ok = [], bad = [];
const check = (n, c, d = "") => (c ? ok : bad).push(n + (d ? " — " + d : ""));

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

/* ---- Stripe webhook signatures ---- */
const whsec = "whsec_testonly";
const payload = Buffer.from(JSON.stringify({ type: "checkout.session.completed", id: "evt_1" }));
const t = Math.floor(Date.now() / 1000);
const sig = createHmac("sha256", whsec).update(Buffer.concat([Buffer.from(t + "."), payload])).digest("hex");

check("webhook: a genuine signature passes", verify(payload, `t=${t},v1=${sig}`, whsec) === true);
check(
  "webhook: a modified body fails",
  verify(Buffer.from(payload.toString().replace("evt_1", "evt_2")), `t=${t},v1=${sig}`, whsec) === false
);
check("webhook: the wrong secret fails", verify(payload, `t=${t},v1=${sig}`, "whsec_wrong") === false);

const oldT = t - 60 * 60;
const oldSig = createHmac("sha256", whsec).update(Buffer.concat([Buffer.from(oldT + "."), payload])).digest("hex");
check("webhook: a stale timestamp fails (replay guard)", verify(payload, `t=${oldT},v1=${oldSig}`, whsec) === false);

check(
  "webhook: accepts a rotation with several v1 signatures",
  verify(payload, `t=${t},v1=${"0".repeat(64)},v1=${sig}`, whsec) === true
);
check("webhook: a header with no signature fails", verify(payload, `t=${t}`, whsec) === false);

console.log(ok.map((s) => "  ✓ " + s).join("\n"));
if (bad.length) {
  console.log("\n" + bad.map((s) => "  ✗ " + s).join("\n"));
  process.exit(1);
}
console.log(`\n${ok.length}/${ok.length} signature checks passed`);
