# Security policy

## Report a problem privately

Do not open a public issue for a security problem.

Report it through a GitHub private security advisory:

1. Go to the [Security tab](https://github.com/3b-digital/3b-mailbox/security) of the repository.
2. Select **Report a vulnerability**.
3. Describe the problem, the steps to reproduce it and the effect.

Use made-up data. Do not send real email content, email addresses, client IDs or access tokens.

We aim to reply within 7 days. We will tell you when we have a fix and agree a date to publish the advisory. We will credit you if you want.

## Scope

In scope:

- The code in this repository: the app in `site/app/`, the landing page and the dev server.
- Problems that could expose a user's Gmail data or access token, for example cross-site scripting, a weak Content Security Policy, a token written to storage, or a request to a host other than Google.
- Problems in the copy that the maintainer hosts, when it is live.

Out of scope:

- Google services, Google sign-in and the Gmail API. Report these to Google.
- Copies that other people host.
- Problems that need a device or browser that an attacker already controls.
- Missing security headers on hosts we do not control.

## Bug bounty

There is no bug bounty. This is a free project with no budget. We are grateful for every report.

## Supported versions

Only the latest release gets security fixes.
