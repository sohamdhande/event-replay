# Contributing

Thank you for considering a contribution to `@mavericks78/event-replay`.

## Before you start

- Open an issue to discuss substantial features or breaking changes.
- Target Node.js 22 or newer.
- Keep the implementation in plain JavaScript (ES modules).
- Do not add runtime dependencies without explaining why they are needed.

## Development checks

```bash
npm run check
npm test
npm run test:coverage
node examples/counter.js
npm pack --dry-run
```

## Pull requests

- Include tests for new behavior and bug fixes (using `node:test` and `node:assert/strict`).
- Update `README.md` if the public API or package behavior changes.
- Keep each pull request focused on one change.
- Clearly describe the problem, the solution, and any compatibility impact.
