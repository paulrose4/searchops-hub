const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRegistrationPolicy,
  normalizeAllowedDomains,
} = require("../src/registration-access");

test("keeps local development registration open without a configured policy", () => {
  const policy = createRegistrationPolicy();
  assert.equal(policy.restricted, false);
  assert.equal(policy.allows({ email: "person@example.com" }), true);
});

test("fails closed in production when registration rules are missing", () => {
  const policy = createRegistrationPolicy({ closedByDefault: true });
  assert.equal(policy.restricted, true);
  assert.equal(policy.configured, false);
  assert.equal(policy.allows({ email: "person@example.com" }), false);
});

test("requires the exact server-side registration access code", () => {
  const policy = createRegistrationPolicy({ accessCode: "internal-secret" });
  assert.equal(
    policy.allows({ email: "person@gmail.com", submittedAccessCode: "wrong" }),
    false,
  );
  assert.equal(
    policy.allows({
      email: "person@gmail.com",
      submittedAccessCode: "internal-secret",
    }),
    true,
  );
});

test("supports an optional employee email-domain allowlist", () => {
  const policy = createRegistrationPolicy({
    accessCode: "internal-secret",
    allowedDomains: "@example.com, staff.example.cn",
  });
  assert.deepEqual(normalizeAllowedDomains("@Example.com; staff.example.cn"), [
    "example.com",
    "staff.example.cn",
  ]);
  assert.equal(
    policy.allows({
      email: "person@example.com",
      submittedAccessCode: "internal-secret",
    }),
    true,
  );
  assert.equal(
    policy.allows({
      email: "person@gmail.com",
      submittedAccessCode: "internal-secret",
    }),
    false,
  );
});