# Contributing

Thank you for your help. This page tells you how to report a problem, suggest a change and send a pull request.

## Before you start

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). It lists the modules and the rules for all code.
- For a large change, open an issue first so we can agree the approach.
- Never put email content, email addresses, filter criteria from a real account, client IDs or access tokens in an issue, a pull request, a test or a screenshot. Use made-up data.

## Report a problem or suggest a feature

Use the issue templates on GitHub. For a security problem, do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Set up for development

You need Node.js 22 or later.

```sh
npm install
npm run dev
```

The dev server prints its address. Open `app/?demo` to use the app with made-up data.

## Rules for code

- No runtime dependencies. Dev dependencies only, and only when they add clear value.
- The app talks only to `accounts.google.com` and `gmail.googleapis.com`. No analytics, no fonts or scripts from other sites.
- Never store the access token. Never log message content.
- Plain JavaScript ES modules with JSDoc types and `// @ts-check` in `core/` and `gmail/`.
- Pure logic goes in `site/app/js/core/` with unit tests.
- Use the design tokens in `site/app/css/tokens.css`. Do not add new colour values.

## Rules for text

All text that users see follows these rules:

- Plain English, UK spelling, active voice and short sentences.
- No em dashes and no curly quotes.
- No marketing words.

## Accessibility

Every change must keep WCAG 2.2 AA conformance. We aim for AAA where we can (7:1 text contrast, 44 by 44 pixel targets). Check with the keyboard only, and add or update axe-core checks in `tests/e2e/`.

## Before you send a pull request

```sh
npm run check
npm run test:e2e
```

- Keep each pull request to one change.
- Add tests for new logic and for bugs you fix.
- Describe what you tested, including assistive technology if you used it.

## Licence

By contributing, you agree that your contribution is licensed under [AGPL-3.0-only](LICENSE).
