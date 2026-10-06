# Gmail Butler: project plan (draft v0.1)

Status: planning only. Nothing is deployed. Open questions are in section 12.

## 1. Goal

A free, open-source web app (also an installable PWA) that gives a clear, fast and accessible way to manage Gmail filters. It runs fully in the browser. It has no back end, no database, no analytics and no telemetry. The maintainer gets no data about who uses it.

Later scope (not in v1): signatures, out-of-office, labels manager, inbox-zero tools.

## 2. Verified platform facts (Gmail API and limits)

These facts drive the design. Items marked VERIFY need a live test on Jack's Gmail and Workspace accounts before we hard-code them.

| Fact | Value | Source / status |
|---|---|---|
| Filter API methods | `create`, `delete`, `get`, `list`. There is no `update` or `patch`. An edit is "create new, then delete old". | Gmail API reference |
| Filter criteria fields | `from`, `to`, `subject`, `query`, `negatedQuery`, `hasAttachment`, `excludeChats`, `size`, `sizeComparison` (`larger` / `smaller`) | Gmail API reference |
| Filter action fields | `addLabelIds`, `removeLabelIds`, `forward` | Gmail API reference |
| Action mapping | Archive = remove `INBOX`. Mark read = remove `UNREAD`. Star = add `STARRED`. Delete = add `TRASH`. Never spam = remove `SPAM`. Important = add/remove `IMPORTANT`. Category = add `CATEGORY_*`. Label = add user label ID. | Gmail API guide. VERIFY each one live |
| Max filters per account | 1,000 | Google Workspace "Gmail settings size limits" page |
| Max filter criteria length | About 1,469 to 1,488 characters (error: "The specified filter is too long"). Google does not publish an exact number. | Third-party tests. VERIFY. We will use a safe cap of 1,400 until we measure it |
| Filters from API on old mail | A new filter acts only on new mail. The Gmail UI "also apply to matching conversations" option does not exist in the filter API. To apply to old mail we must call `messages.batchModify`, which needs a further scope. | Gmail API behaviour. VERIFY |
| Forwarding in filters | The `forward` address must already be a verified forwarding address. `forwardingAddresses.create` is only for service accounts with domain-wide authority, so normal users must add new addresses in the Gmail UI. Workspace admins can block auto-forwarding. | Gmail API reference |
| Scope for filters | `gmail.settings.basic` (read and write filters). This is a RESTRICTED scope. Listing and creating labels needs `gmail.labels` as well. | Google OAuth scope list. VERIFY `gmail.labels` classification |
| Scope for forwarding list | `gmail.settings.basic` reads forwarding addresses. `gmail.settings.sharing` is for creating them (not usable by us). | Gmail API reference |
| Quota | `filters.create` = 5 quota units. Per-user limit is 15,000 units per minute (one source says 250 units per user per second since May 2026). On HTTP 429 we back off and use `Retry-After`. | Gmail API quota page. VERIFY current figure |
| Labels limit | Up to 10,000 labels (needs confirmation) | VERIFY |
| OAuth "Testing" mode | Max 100 test users. Refresh tokens expire after 7 days. Users see an "unverified app" warning. | Google Cloud help |
| Browser token model | Google Identity Services `initTokenClient` gives an access token (about 1 hour). It never gives a refresh token. Good for privacy: nothing long-lived to steal. | GIS reference |
| Export/import XML | The Gmail UI can export and import filters as `mailFilters.xml` (Atom with `apps:property` items such as `hasTheWord`, `shouldArchive`, `shouldTrash`). Import adds filters. It does not replace or delete old ones. | Gmail help |

## 3. Architecture

Static files only: HTML, CSS, JavaScript ES modules. No build step at runtime. Anyone can host it on GitHub Pages, Cloudflare Pages, Netlify, a NAS, or open it from `localhost`.

```
Browser
  |-- index.html + /app (ES modules, CSS, icons, manifest, service worker)
  |-- Google Identity Services script (accounts.google.com)  -> access token in memory only
  |-- fetch() to gmail.googleapis.com (direct, no proxy)
  |-- localStorage: UI preferences, undo journal, user's own client ID (all optional)
```

Three ways to use it:

1. Bring your own client ID (recommended, maximum privacy). The user makes a free Google Cloud project, enables the Gmail API, creates an OAuth "Web application" client ID for their own origin, and pastes it into the app. For Workspace, they set the consent screen to "Internal", so there is no verification and no warning. For a personal Gmail, they keep "Testing" mode and add themselves as the only test user. Because GIS gives no refresh token, the 7-day refresh-token expiry does not affect us. We give a step-by-step guide with screenshots.
2. Jack's hosted instance on GitHub Pages with Jack's client ID. This is easy for users, but `gmail.settings.basic` is restricted. Above 100 users, Google requires restricted-scope verification and possibly a paid security assessment (CASA). Google says the assessment applies to apps that access restricted data "from or through a third-party server". A browser-only app may be exempt, but we must confirm with Google. Also, the maintainer's Cloud console then shows user counts and API metrics (no identities, no mail content).
3. Offline XML mode (no Google sign-in at all). The user exports `mailFilters.xml` from Gmail, opens it in the app, edits, consolidates, and downloads a new XML file to import. The app tells the user to delete the old filters first. Zero OAuth, zero network calls to Google. Good for a try-before-you-commit path.

A demo mode with fake data loads with no sign-in, so people can try the UI first.

### Settings storage

No server storage. Recommendation: `localStorage` plus "export settings as a JSON file". I advise against a dummy filter (it shows in Gmail, counts against the 1,000 limit, has the length cap), a dummy signature (visible to recipients if selected), or a draft (needs the restricted `gmail.compose` scope and shows in Drafts on every device). If we need cross-device sync later, the safest Gmail-native option is a label-only marker, but I do not think we need it.

### Security controls

- Access token lives in memory only. It is never written to storage.
- Strict Content Security Policy: `connect-src` only `gmail.googleapis.com` and `accounts.google.com`. No third-party scripts except GIS.
- Subresource Integrity on any vendored files. No CDN for app code.
- The service worker caches the app shell only. It never caches API responses.
- Request the minimum scope. Ask for extra scopes only when the user turns on a feature that needs them (incremental auth).
- "Sign out" revokes the token with `google.accounts.oauth2.revoke`.

## 4. Features for v1 (filters)

### 4.1 Overview and summary
- Dashboard: count of filters against the 1,000 limit, a gauge for each filter's criteria length, labels used, forwarding filters, filters that delete mail.
- Group by action (label, archive, delete, forward), by sender domain, by label.
- Plain-English summary for each filter: "Mail from @amazon.co.uk: skip inbox, label Receipts".
- Search and sort over all filters.

### 4.2 Health checks
- Exact duplicates and near-duplicates.
- Conflicts (for example one filter adds a label and another deletes the same mail).
- Filters that point to labels that no longer exist.
- Filters that forward to an address that is no longer verified.
- Risky filters (delete, forward) shown with a clear warning.
- Filters near the length cap.

### 4.3 Bulk management
- Multi-select with keyboard and touch.
- Bulk delete, duplicate, export (JSON and Gmail XML).
- Bulk change of destination: replace label A with label B in all selected filters, or add/remove an action across many filters.
- Every bulk change shows a preview diff before it runs.
- Safe write order: create new filter first, then delete old one. If create fails, nothing is lost.
- Undo journal: we keep the JSON of every deleted filter in `localStorage` so the user can restore it. Full backup download before any bulk change.
- Throttled queue with backoff for quota errors, plus a progress bar.

### 4.4 Easy creation
- Form builder with plain fields (from, to, subject, has words, does not have, attachment, size).
- Raw query editor with Gmail operator help and autocomplete (`from:`, `list:`, `has:`, `category:`, `larger:`, `older_than:` and so on).
- Live character counter against the cap.
- Optional "preview matching mail" and "apply to existing mail". These need an extra restricted scope (`gmail.readonly` for preview, `gmail.modify` for apply). Off by default. VERIFY whether `gmail.metadata` allows the `q` search parameter (I believe it does not).

### 4.5 Suggested filters (templates)
- Has unsubscribe link: `list:` or `"unsubscribe"` -> label `has-unsubscribe`.
- Invoices and receipts: subject or body words (invoice, receipt, order confirmation, payment received, VAT) plus common sender domains -> label `Receipts`.
- Newsletters, social notifications, calendar invites (`filename:ics` / `has:invite`?), shipping and delivery, one-time codes, security alerts, bank statements, travel bookings.
- Each template is editable before creation. Jack can add personal ones. UK-friendly word lists (VAT, HMRC, Royal Mail, Evri).

### 4.6 Consolidation
- Find filters with the same action set (same labels added and removed, same forward).
- Merge their criteria into one `query` with OR. Gmail supports `{a b}` and `OR` for alternatives, for example `from:(a@x.com OR b@y.com)` or `{from:a@x.com subject:"invoice"}`.
- Rules: do not merge when `negatedQuery`, size or attachment criteria differ, unless the result is still logically equal. Split a merged filter in two if it goes over the cap.
- Show before and after, plus the net reduction in filter count.

### 4.7 Quota guard
- Hard block: the app cannot create filter 1,001 or a criteria string over the cap.
- Warnings at 80% and 95% of each limit.
- The quota numbers live in one config file so we can update them.

## 5. Design system and UI

- Recommendation: our own small design system made of CSS custom properties (design tokens) and native HTML elements (`dialog`, `details`, popover, form controls), with no runtime framework. Optional: Web Awesome (the Shoelace successor, web components, MIT free tier) if we want ready-made accessible components. See question 6.
- Light, dark and high-contrast themes. Follows system setting by default.
- Mobile first. Bottom navigation on phones, side navigation on desktop.
- Motion is small and respects `prefers-reduced-motion`.
- System font stack or one self-hosted variable font (no Google Fonts call, for privacy).

## 6. Accessibility (beyond WCAG 2.2 AA)

- Target: WCAG 2.2 AA in full, plus AAA where it is practical: 7:1 text contrast, 44x44 px targets, no time limits (we warn before the 1-hour token ends and let the user renew without losing work), section headings, help on every form.
- Full keyboard use with visible focus. Skip link. Shortcut keys (can be turned off, WCAG 2.1.4).
- Screen readers: test with VoiceOver (macOS and iOS), NVDA (Windows) and TalkBack.
- `forced-colors` support (Windows High Contrast), 400% zoom, text spacing override, `prefers-contrast`.
- Live regions for bulk progress. Plain-English text (reading age about 12). Never use colour alone to show status.
- Automated: axe-core in Playwright on every page and state. Manual checklist per release.
- Publish an accessibility statement.

## 7. Code, dependencies and tooling

- Runtime dependencies: zero (only the Google GIS script loaded from Google). If we choose Web Awesome, we vendor a pinned copy.
- Dev dependencies only: Vitest, Playwright, @axe-core/playwright, ESLint, Prettier, Lighthouse CI, `fast-xml-parser` maybe for XML (or native `DOMParser`, which is enough).
- JSDoc types with `// @ts-check` and `tsc --noEmit` for type checking without a build step.
- Dependabot for npm and GitHub Actions. CodeQL scan. Secret scanning. Branch protection on `main`.
- Conventional commits. Release Please (or a simple manual tag) to maintain the CHANGELOG.

### Proposed layout

```
/app            the PWA (index.html, js/, css/, icons/, manifest.webmanifest, sw.js)
/app/js/gmail   API client, quota queue, mock server for tests
/app/js/core    pure logic: query parser, summariser, consolidation, limits, XML import/export
/site           GitHub Pages promo site (or same origin as /app, see question 3)
/tests/unit     Vitest
/tests/e2e      Playwright (mocked Gmail API)
/docs           setup guide, privacy policy, accessibility statement
```

## 8. Testing

- Unit (Vitest): query parser and builder, consolidation, duplicate and conflict detection, limit checks, XML round trip, label ID mapping. Target 90%+ line coverage on `/core`.
- E2E (Playwright, Chromium, WebKit, Firefox): a mock Gmail API with fixtures (empty account, 50 filters, 999 filters, very long criteria, Workspace with forwarding blocked).
- Accessibility: axe on each view, keyboard-only flows.
- Lighthouse CI: PWA, performance, accessibility, best practice budgets.
- Live tests (manual, by Jack): a script of steps on a personal Gmail and a Workspace account. All test filters use the label prefix `zz-butler-test/` so cleanup is simple. We also use the live run to measure the real criteria length cap.
- CI runs all automated tests on every pull request. Nothing deploys unless CI is green, and nothing deploys until Jack approves.

## 9. Hosting and cost

- GitHub Pages: free for public repos. Cloudflare Pages: free tier. Both serve static files over HTTPS, which the PWA and OAuth need.
- Google Cloud project and Gmail API: free at this usage.
- Cost to Jack: GBP 0, unless Google requires a paid security assessment for the hosted instance (option 2 above).

## 10. Privacy

- Privacy policy in plain English: what the app reads (filters, labels, forwarding addresses), where it goes (only between the user's browser and Google), what is stored (UI preferences and undo journal in the user's own browser), what the maintainer receives (nothing).
- No cookies, no analytics, no error reporting service, no fonts or scripts from third parties except Google sign-in.
- Google API Services User Data Policy "Limited Use" statement (needed if we seek verification).
- Clear "delete all local data" button.

## 11. Delivery plan (parallel worktrees)

| Phase | Work | Can run in parallel |
|---|---|---|
| 0 | Repo setup: licence, README, CI, Dependabot, lint, test harness, design tokens | No |
| 1 | `core` logic (parser, summariser, limits, XML) with unit tests | Yes, with phase 1b |
| 1b | Mock Gmail API and API client with quota queue | Yes |
| 1c | Design system and app shell (PWA, themes, nav) | Yes |
| 2 | Overview, health checks, bulk actions | Yes, by feature |
| 3 | Creation builder, templates, consolidation | Yes, by feature |
| 4 | Promo site, setup guide, privacy policy, accessibility statement | Yes |
| 5 | Live tests on Gmail and Workspace with Jack | No |
| 6 | Deploy (only after Jack approves) | No |

## 12. Open questions for Jack

See the chat reply. Answers will be recorded here.

## 13. Further ideas

- Offline XML mode and demo mode (section 3).
- "Explain this filter" and "why did this mail get filtered" tools.
- Filter version history in a downloadable JSON file, with diff between snapshots.
- Share filter templates as a URL fragment (data stays in the link, never on a server).
- Sender-based quick filters from a pasted list of addresses.
- Later: labels manager (rename, colour, nest, merge), signatures, OOO scheduler.

## Sources

- Google Workspace Admin Help, Gmail settings size limits: https://knowledge.workspace.google.com/admin/gmail/gmail-settings-size-limits
- Filter length tests: https://www.spudart.org/blog/character-limit-for-gmail-filter/
- Gmail API scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- forwardingAddresses.create: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.settings.forwardingAddresses/create
- Filters delete method: https://developers.google.com/gmail/api/v1/reference/users/settings/filters/delete
- Gmail API quota: https://developers.google.com/workspace/gmail/api/reference/quota
- Restricted scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- OAuth testing mode and production readiness: https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- GIS JS reference: https://developers.google.com/identity/oauth2/web/reference/js-reference
- Gmail filter XML export/import: https://tdx.maine.edu/TDClient/2624/Portal/KB/ArticleDet?ID=137185
