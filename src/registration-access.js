const crypto = require("node:crypto");

function normalizeAllowedDomains(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

function constantTimeEqual(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left)).digest();
  const rightDigest = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function createRegistrationPolicy({
  accessCode = "",
  allowedDomains = "",
  closedByDefault = false,
} = {}) {
  const configuredCode = String(accessCode || "");
  const domains = normalizeAllowedDomains(allowedDomains);
  const configured = Boolean(configuredCode || domains.length);

  return {
    configured,
    restricted: configured || closedByDefault,
    requiresAccessCode: Boolean(configuredCode),
    allowedDomains: domains,
    allows({ email = "", submittedAccessCode = "" } = {}) {
      if (!configured) return !closedByDefault;
      if (
        configuredCode &&
        !constantTimeEqual(submittedAccessCode, configuredCode)
      )
        return false;
      if (domains.length) {
        const domain = String(email).trim().toLowerCase().split("@")[1] || "";
        if (!domains.includes(domain)) return false;
      }
      return true;
    },
  };
}

module.exports = { createRegistrationPolicy, normalizeAllowedDomains };