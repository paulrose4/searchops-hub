const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRelayState,
  isPrivateRelayReturnUrl,
  openRelayPayload,
  readRelayState,
  resolveReportingDates,
  sealRelayPayload,
} = require("../src/google");

test("builds equal current and previous reporting periods", () => {
  const range = resolveReportingDates({ startDate: "2026-05-01", endDate: "2026-05-30" });
  assert.equal(range.period.days, 30);
  assert.equal(range.previousPeriod.days, 30);
  assert.equal(range.previousPeriod.end, "2026-04-30");
  assert.equal(range.previousPeriod.start, "2026-04-01");
});

test("clamps reporting ranges to supported lengths", () => {
  const range = resolveReportingDates({ startDate: "2024-01-01", endDate: "2026-01-01" });
  assert.equal(range.period.days, 180);
});

test("signs a short-lived OAuth relay state for a private callback", () => {
  const secret = "test-relay-secret-with-enough-entropy";
  const now = Date.now();
  const returnTo = "http://192.168.2.25:3210/auth/google/relay/callback";
  const state = createRelayState({ returnTo, csrf: "csrf-value" }, secret, now);
  assert.deepEqual(readRelayState(state, secret, { now: now + 1000 }), {
    v: 1,
    returnTo,
    csrf: "csrf-value",
    iat: now,
  });
  assert.throws(() => readRelayState(state + "x", secret, { now }));
  assert.throws(() => readRelayState(state, secret, { now: now + 16 * 60 * 1000 }));
});

test("rejects public OAuth relay destinations", () => {
  assert.equal(isPrivateRelayReturnUrl("https://example.com/auth/google/relay/callback"), false);
  assert.equal(isPrivateRelayReturnUrl("http://192.168.2.25:3210/auth/google/relay/callback"), true);
  assert.throws(() =>
    createRelayState(
      { returnTo: "https://example.com/auth/google/relay/callback", csrf: "csrf" },
      "relay-secret",
    ),
  );
});

test("encrypts OAuth tokens while they pass through the browser", () => {
  const secret = "test-relay-secret-with-enough-entropy";
  const value = {
    tokens: { access_token: "access-value", refresh_token: "refresh-value" },
    profile: { email: "employee@example.com" },
  };
  const sealed = sealRelayPayload(value, secret);
  assert.ok(!sealed.includes("access-value"));
  assert.deepEqual(openRelayPayload(sealed, secret), value);
  assert.throws(() => openRelayPayload(sealed, "wrong-secret"));
});
