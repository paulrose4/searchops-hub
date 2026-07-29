# Contributing

Thank you for contributing to SearchOps Hub.

## Development

```bash
npm ci
cp .env.example .env
npm run check
npm test
npm start
```

Use the local demo account documented in `README.md`. Do not use production datasets or credentials in fixtures, screenshots, tests, issues, or pull requests.

## Pull Requests

- Keep changes focused and explain user-visible behavior.
- Add or update tests for shared logic and security boundaries.
- Run `npm run check` and `npm test` before submitting.
- Use `example.com` for domains and clearly fictional data for demos.
- Never commit generated databases, `.env` files, OAuth tokens, API keys, or private reports.

## Documentation

User-facing workflows should include Chinese documentation. English documentation improvements are welcome.
