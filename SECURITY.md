# Security Policy

## Supported Version

Security fixes are applied to the latest `main` branch.

## Reporting a Vulnerability

Please do not disclose exploitable vulnerabilities in a public issue. Use GitHub's private vulnerability reporting feature for this repository.

Include the affected route or module, reproduction steps, impact, and a suggested mitigation when available. Do not include production credentials or personal data.

## Secrets

SearchOps Hub expects all credentials to be supplied through server-side environment variables. Never commit:

- `.env` files
- PostgreSQL connection strings
- Google OAuth Client Secrets or access/refresh tokens
- AI provider API keys
- `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, or registration access codes

Production deployments should use HTTPS, persistent PostgreSQL, strong random secrets, restricted registration, and a dedicated Google Cloud OAuth project.

## Data Boundaries

- OAuth tokens are encrypted with AES-256-GCM before storage.
- Tenant-owned records are filtered by `tenant_id`.
- Page crawling is restricted to the bound site and blocks private-network targets.
- AI requests contain public page content and aggregated SEO evidence, not passwords or OAuth tokens.
- The application does not automatically publish changes to connected websites.
