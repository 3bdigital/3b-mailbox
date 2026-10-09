# Architecture and module contracts

Email Filter is static HTML, CSS and JavaScript ES modules. There is no build step and no runtime dependency. Everything under `site/` is published as-is.

```
site/
  index.html              Landing page: what it is, setup guide, privacy policy, accessibility statement (one page, anchors)
  assets/                 Images for the landing page
  app/
    index.html            The app (single page, hash routes)
    manifest.webmanifest
    sw.js                 Service worker: caches the app shell only, never API data
    icons/
    css/
      tokens.css          Design tokens (colour, type, space, radius, motion). Shared with the landing page.
      base.css            Reset, typography, focus, forced-colors, reduced motion
      components.css      Buttons, fields, cards, tables, dialogs, chips, meters, toasts
      app.css             App layout (shell, nav, views)
    js/
      types.js            Shared JSDoc types (Filter, Label, Plan, GmailApi, Template ...)
      core/               Pure logic. No DOM, no network. 100% unit tested.
      gmail/              Auth, API client, plan executor, mock API
      ui/                 Views and components (DOM)
      main.js             Bootstrap
tests/
  unit/                   Vitest (node environment; happy-dom where a test needs DOM)
  e2e/                    Playwright + axe, run against demo mode (mock API)
  fixtures/               Shared test data
scripts/serve.mjs         Zero-dependency static server, random free port by default
```

Import paths are relative, with the `.js` extension, so they work in the browser with no bundler.

## core/ (pure functions)

### core/actions.js

- `SYSTEM_LABELS`: object of the system label IDs (`INBOX`, `UNREAD`, `STARRED`, `TRASH`, `SPAM`, `IMPORTANT`, `CATEGORY_*`).
- `toFriendly(action: FilterAction): FriendlyAction`
- `toApi(friendly: FriendlyAction): FilterAction` (omits empty arrays and null forward)
- `emptyFriendly(): FriendlyAction`
- `actionKey(action: FilterAction): string`: canonical, order-independent key. Two actions with the same key do the same thing.
- `isRisky(action: FilterAction): {risky: boolean, reasons: string[]}`: trash, forward, archive + mark read together, never-spam.

### core/query.js

Gmail search syntax parser and serialiser.

- `tokenize(q: string): Token[]`
- `parse(q: string): Node` where Node is one of `{type:'and', items}`, `{type:'or', items}` (from `OR`, `|` or `{...}`), `{type:'not', item}` (from `-`), `{type:'term', value, quoted:boolean}`, `{type:'op', name, value: Node|string}` (`from:`, `subject:(...)` ...), `{type:'group', item}` (parentheses), `{type:'around', items:[a, b], distance}` (`a AROUND n b`). Or nodes from `{...}` carry `braces: true`. OR binds tighter than the implicit AND, as in Gmail.
- `serialize(node: Node): string`
- `OPERATORS`: array of `{name, description, example, filterSafe: boolean}`. `filterSafe:false` for operators that never match incoming mail in a filter: `label:`, `in:`, `is:`, `has:userlabels`, `has:nouserlabels`, `older_than:`, `newer_than:`, `older:`, `newer:`, `after:`, `before:`, `has:yellow-star` and other star types.
- `findUnsafeOperators(q: string): string[]`
- `orJoin(parts: string[]): string`: joins sub-queries with OR, adds brackets only where needed.
- `canonicalize(node)`, `normaliseQuery(q): string`: canonical form (lower case, no redundant brackets, AND/OR items sorted and de-duplicated). Used by analyse and consolidate. `walk(node, fn)` visits every node.

### core/limits.js

- `LIMITS`: `{ maxFilters: 1000, criteriaCharsSafe: 1400, criteriaCharsHard: 1469, maxLabels: 10000, warnRatio: 0.8, dangerRatio: 0.95 }`. One place to update when Google changes limits or our live tests measure them.
- `criteriaToSearch(criteria: FilterCriteria): string`: the equivalent single Gmail search string (`from:(...) to:(...) subject:(...) query -{negatedQuery} has:attachment larger:N`). Used for length checks and previews.
- `criteriaLength(criteria): number`
- `checkFilter(filter): Issue[]`: too long, empty criteria, unsafe operators, forward set.
- `accountUsage(filters, labels): {filters:{used,max,ratio,level}, labels:{used,max,ratio,level}}` where level is `'ok'|'warn'|'danger'|'full'`.
- `canAdd(filters, count = 1): boolean`

### core/summarise.js

- `describeCriteria(criteria, opts?): string`: plain English, for example "From amazon.co.uk with "invoice" in the subject".
- `describeAction(action, labelsById: Map<string, Label>): string`: for example "Skip the inbox, apply label Receipts".
- `describeFilter(filter, labelsById): {when: string, then: string, text: string}`
- `senderDomains(filter): string[]`: domains found in `from` or `from:` terms, for grouping.
- `groupFilters(filters, by: 'action'|'label'|'domain'|'risk', labelsById): Array<{key, title, filters}>`

### core/analyse.js

- `findDuplicates(filters): Issue[]`: same criteria and same action (after normalising case, whitespace, order).
- `findSameCriteria(filters): Issue[]`: same criteria, different actions (should usually be one filter).
- `findConflicts(filters): Issue[]`: same or overlapping criteria where one trashes and another labels or stars; one adds IMPORTANT and another removes it.
- `findMissingLabels(filters, labels): Issue[]`
- `findForwardingProblems(filters, forwardingAddresses): Issue[]`: forward to an address that is not `accepted`.
- `analyse({filters, labels, forwardingAddresses}): Issue[]`: all checks plus `checkFilter` for each filter, sorted by severity.

### core/consolidate.js

- `findMergeGroups(filters): Array<{key, filters: Filter[], reason: string}>`: filters with the same `actionKey` and compatible criteria (same `negatedQuery`, `hasAttachment`, `excludeChats`, `size`, `sizeComparison`). Groups with 2 or more filters only.
- `mergeCriteria(criteriaList: FilterCriteria[]): FilterCriteria`: when every filter uses only `from`, the result is `from: a OR b OR c` (same for `to` and `subject`). Otherwise each filter's positive part becomes one OR branch in `query`, for example `{(from:a subject:b) from:c}`. Shared fields stay as they are.
- `planMerge(group, opts?: {limit?: number}): Plan`: creates merged filter(s), deletes the originals. Splits into more than one merged filter when a result goes over `LIMITS.criteriaCharsSafe`.
- `planAllMerges(filters): Plan[]`

### core/bulk.js

- `planDelete(filters): Plan`
- `planDuplicate(filters): Plan`: creates copies (Gmail allows identical filters; the UI warns).
- `planReplaceLabel(filters, fromLabelId, toLabelId | {newLabelName}): Plan`: bulk destination change.
- `planAddAction(filters, patch: Partial<FriendlyAction>): Plan` and `planRemoveAction(filters, keys: string[]): Plan`
- `planEdit(previous: Filter, next: Filter): Plan`: one `replace` step.
- `planCreate(filters: Filter[], labelsToCreate?: string[]): Plan`
- Every planner checks `LIMITS` and throws `LimitError` (exported, with `code` `'too-many-filters'|'too-long'|'too-many-labels'`) when the plan would go over a hard limit.
- Every planner takes a last optional `opts: {total?: number, labelCount?: number}` (filters and user labels in the account now). Because the executor creates before it deletes, the filter check is on the peak: `total + creates (+1 while a replace runs)`.
- `PlanError` (exported) is thrown for a change that cannot make a valid filter: a filter with no id to change, or `planRemoveAction` leaving a filter with no action.
- `makePlan(title, steps, opts)` (exported) builds and checks a plan; consolidate uses it too.

### core/templates.js

- `TEMPLATES: Template[]`: the suggested filter catalogue (see docs/TEMPLATES.md for the research and best practices).
- `TEMPLATE_GROUPS: string[]`
- `instantiate(template, options, labels: Label[]): {filter: Filter, labelsToCreate: string[]}`: label IDs are resolved by name. Missing labels are listed for creation and the filter uses a placeholder ID `"new:<name>"` that the executor swaps for the real ID.
- `matchExisting(template, filters): Filter|null`: finds an existing filter that already does the same job.

### core/backup.js

- `toJson(filters, labels): string`: versioned backup `{app:'email-filter', version:1, exportedAt, filters, labels}`.
- `fromJson(text): {filters, labels}` with validation (throws `BackupError` with a plain message).
- `toGmailXml(filters, labelsById, opts?: {now, author})`: Gmail `mailFilters.xml` format, for import in Gmail's own settings. Gmail XML has one `label` property per entry, so a filter with several labels becomes several entries with the same criteria (the first has the other actions too). Sizes are written in bytes (`sizeUnit` `s_sb`).

### core/storage.js

- `createStore(backend = globalThis.localStorage, prefix = 'ef:')`: returns `{get(key, fallback), set(key, value), remove(key), clearAll()}`. Every call is in try/catch; works with no storage.
- Keys in use: `clientId`, `theme`, `density`, `journal` (undo journal), `dismissed` (dismissed hints), `tierWanted`.

### core/journal.js

- `createJournal(store, max = 200, opts?: {now})`: `{record(entry), list(), clear(), lastBatch()}`. The executor records one entry per delete or replace step: `{batch, title, time, op: 'delete'|'replace', filterId, previous, replacement?}`. Entries from one `runPlan` call share `batch`. `list()` is newest first; `lastBatch()` returns every entry of the most recent batch in the order recorded. The oldest entries are dropped past `max`.

## gmail/

### gmail/auth.js

- `SCOPES`: `{ basic: ['https://www.googleapis.com/auth/gmail.settings.basic', 'https://www.googleapis.com/auth/gmail.labels'], preview: [...basic, 'https://www.googleapis.com/auth/gmail.readonly'], apply: [...preview, 'https://www.googleapis.com/auth/gmail.modify'] }`
- `createAuth({clientId, loadScript?, now?})`: returns `{ signIn(tier): Promise<void>, upgrade(tier): Promise<void>, signOut(): Promise<void>, getToken(): string|null, hasTier(tier): boolean, expiresAt(): number|null, onChange(cb): () => void }`.
- Uses Google Identity Services `google.accounts.oauth2.initTokenClient` with `include_granted_scopes: true`. Token is held in memory only. `signOut` calls `google.accounts.oauth2.revoke`.
- `validateClientId(id): boolean` (pattern `^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$`).

### gmail/client.js

- `createGmailClient({getToken, fetch = globalThis.fetch, sleep?})`: implements `GmailApi` against `https://gmail.googleapis.com/gmail/v1/users/me/...`.
- Retries 429 and 5xx with exponential backoff and `Retry-After`. Max 5 tries.
- Errors are `GmailError {status, reason, message}` with plain English `message` (401 means sign in again; 403 insufficient scope names the tier needed; 400 "filter too long"; "Filter already exists").
- `searchMessages` uses `messages.list?q=` then `messages.get?format=metadata&metadataHeaders=From,Subject,Date`.
- `applyToExisting` pages through `messages.list` and calls `messages.batchModify` in chunks of 1000.

### gmail/executor.js

- `runPlan(plan, api: GmailApi, {onProgress?, journal?, signal?}): Promise<{done: number, failed: PlanStep|null, error: Error|null, created: Filter[]}>`
- Order: `createLabel` steps first (and swap `new:<name>` placeholders), then `create` and `replace` (create new, then delete old), then `delete`. Stops at the first failure and reports what finished. Writes to the journal before each delete.
- Writes run one at a time (Gmail is strict on settings writes).

### gmail/mock.js

- `createMockGmail({filters, labels, forwardingAddresses, messages, latencyMs = 0, failOn?})`: in-memory `GmailApi` used by demo mode and tests. Enforces the same limits and errors as Gmail (1,000 filters, length, duplicate filter, unknown label ID, unverified forward).
- `demoData()`: about 60 realistic filters (UK flavoured), 25 labels, 3 forwarding addresses (one pending), 200 messages for previews. Includes duplicates, a conflict, a missing label and merge candidates so every feature has something to show.

## ui/ (DOM)

- `ui/router.js`: hash routes `#/overview`, `#/filters`, `#/filters/new`, `#/filters/:id`, `#/suggestions`, `#/tidy`, `#/settings`, `#/setup`.
- `ui/state.js`: small store (`getState`, `setState`, `subscribe`) holding filters, labels, forwarding addresses, selection, issues, auth status.
- One module per view in `ui/views/`. Shared components in `ui/components/` (dialog, toast, confirm, meter, filter-card, label-picker, query-editor, plan-preview, progress).
- `main.js` picks the API: `?demo` or "Try the demo" uses `createMockGmail(demoData())`; otherwise `createGmailClient` with `createAuth`.

## Rules for all code

- No runtime dependencies. Dev dependencies only.
- JSDoc types on every export. `// @ts-check` at the top of core and gmail files.
- No network calls except `accounts.google.com` (sign-in script) and `gmail.googleapis.com`.
- Never store the access token. Never log message content.
- Plain English in every user-facing string (ASD-STE100 style: short sentences, active voice).
