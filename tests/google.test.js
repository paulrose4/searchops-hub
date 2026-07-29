const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveReportingDates } = require("../src/google");

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
