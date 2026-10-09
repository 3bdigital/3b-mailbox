# Suggested filter templates

This page explains the suggested filter catalogue in `site/app/js/core/templates.js`: what Gmail filters can and cannot match, the best practices every template follows, notes on each template, and a list of things to check on a live account. Sources are at the end. Numbers in square brackets, such as [1], point to that list.

Status: researched in October 2026. Google's own help pages could not be fetched directly during the research, so some facts rest on search snippets of those pages and on third-party guides. Anything not confirmed by Google is marked VERIFY.

## 1. How Gmail filter criteria work

### 1.1 A filter is a saved search that runs on arrival

The Gmail API says a filter's `query` and `negatedQuery` take any query in Gmail's advanced search syntax [2]. The filter then checks each new message as it arrives. A filter made through the API acts only on new mail; it does not touch mail you already have (see PLAN.md, section 2).

The best test of a filter is to run its criteria in the Gmail search box first. If the search does not find the message, the filter will not catch it either [8].

### 1.2 Operators that never match incoming mail

Some operators look at the state of a message in your mailbox, not at the message itself. A new message has no state yet when the filter runs, so these never match on arrival:

- `label:` and `has:userlabels` / `has:nouserlabels`: labels are added by filters, so the message has none yet [8].
- `in:` (for example `in:inbox`, `in:anywhere`) and `is:` (`is:unread`, `is:starred`, `is:important`, `is:snoozed`): these are mailbox states, often set later by you or by another filter [8].
- Star operators such as `has:yellow-star`.
- Date operators `after:`, `before:`, `older:`, `newer:`, `older_than:` and `newer_than:`. A relative window such as `older_than:3d` becomes fixed at the time the filter is saved, so it does not roll forward [9]. An absolute date is pointless on new mail.

Gmail's own filter form warns about this group. As far as we know, the warning reads roughly: "Filter searches containing label:, in:, is:, date range (e.g. before: or after:) or stars criteria (e.g. has:yellow-star) are not recommended as they will never match incoming mail." We could not fetch the page to quote it exactly (VERIFY).

No template uses any of these. The unit test has a denylist, and an allowlist taken from Google's operator table [3][4] of operators that look at the message itself: `from:`, `to:`, `cc:`, `bcc:`, `subject:`, `list:`, `filename:`, `has:` (attachment types only), `larger:`, `smaller:` and `deliveredto:`.

### 1.3 `category:` is unclear

`category:promotions` and the other tabs work in search. Third-party guides show filters built on them [10], but Gmail sorts mail into tabs with its own model, and one guide says tab sorting and filters can interfere with each other [11]. We could not confirm that Gmail has already given a message its category when a filter runs. Status: VERIFY. No template depends on `category:` in its criteria, and the test blocks it.

Adding a category as a filter action (for example add `CATEGORY_PROMOTIONS`) is a different matter. The Gmail API supports it [2]. No template does it by default, but `instantiate` supports a `category` default.

### 1.4 `list:` matches the List-Id header

`list:` searches the List-Id header that mailing list software adds [12][13]. "Filter messages like these" on a list message fills in `list:` followed by that message's List-Id [12]. The List-Id is more stable than the From address, which can change [12]. Use the ID part (for example `parents.myschool.sch.uk`), not the description, because a list owner can change the description [12].

We did not find a source that says whether `list:googlegroups.com` matches every list whose ID ends in `googlegroups.com`. Status: VERIFY. The "Group mailing lists" template offers a field for an exact list ID.

### 1.5 There is no `has:unsubscribe`

Gmail has no search operator for the List-Unsubscribe header, and no `has:unsubscribe` or `body:` operator [1]. The header is hidden from the reader [14]. The unsubscribe link that Gmail shows next to the sender comes from that header, and Gmail only shows it after its own checks [14]. A filter can only match the visible text, so the "Has an unsubscribe link" template matches the word `unsubscribe` and a few common phrases such as "manage your preferences". This is the same method that common guides recommend [15]. It catches most bulk mail, and also some mail you need (receipts, bank alerts and delivery updates often have an unsubscribe footer). That is why it labels only, by default.

### 1.6 Words, punctuation and stems

- Gmail matches whole words only. A search for `benefits` does not find `benefit` or `benef` [16]. There are no wildcards inside words, and filters do not accept regular expressions [17][16].
- Special characters such as brackets, currency symbols, `&`, `#` and `*` are not searchable [16]. So a phrase such as `"20% off"` cannot match the `%`. Templates avoid punctuation that matters to the meaning.
- As far as we can tell, punctuation inside a phrase acts like a space, so `"e-ticket"` and `"one-time"` are phrases of two words (VERIFY). Templates add the joined form as well where it is common (`eticket`, `estatement`).
- Capitals do not matter, except in the operators `OR` and `AROUND`, which must be in capitals [18]. Lower-case `or` is just a word. The test checks this.
- Gmail may match close word forms for plain words; putting `+` before a word forces an exact match, for example `+unicorn` does not match `unicorns` [19]. Google does not publish whether plain searches use stemming (VERIFY). Templates list plural and past forms where they matter (`statement`, `dispatched`, `shipped`).
- A quoted phrase must appear in that order [19].

### 1.7 Senders: domains, not display names

- `from:` matches all or part of a sender's name or address [20]. That means `from:"HMRC"` also matches a scammer whose display name is "HMRC Refunds".
- The display name is the easiest part of an email to fake. An attacker can send from a real account they control, so SPF, DKIM and DMARC all pass for their own domain, while the display name shows a brand you trust. Many mail apps show only the name [21].
- So templates match on the domain or the full service address. This is much harder to fake, because Gmail checks domain authentication. It is still not proof: lookalike domains such as `tracking-evri.com` and `evri-notes.com` are used in real Evri scams [22].
- `from:amazon.co.uk` matches any address that contains `amazon.co.uk` as a whole part of the address, including subdomains such as `marketplace.amazon.co.uk`. As far as we can tell, a lookalike that contains the whole domain, such as `amazon.co.uk.example.net`, would also match, because the domain parts are separate words. Hyphenated lookalikes such as `amazon-co-uk.example` may or may not match. Status: VERIFY. In any case, a label is never proof that a message is genuine.
- To keep marketing out, some templates use exact service addresses instead of the whole domain (Amazon UK orders, Google account alerts, GitHub).

### 1.8 Length and count limits

- A filter's criteria can be about 1,469 to 1,488 characters before Gmail says "The specified filter is too long" [6]. Google does not publish the figure. This project uses a safe cap of 1,400 (PLAN.md, section 2).
- Every template is under 1,000 characters on its own, and under 1,400 with every option turned on. The test checks both. `instantiate` refuses to build a filter over 1,400 characters, for example when a user adds many extra senders.
- An account can have up to 1,000 filters [5].

## 2. Best practices that every template follows

1. **Label only by default.** No template skips the inbox or marks mail as read unless you turn that on. A label is safe: it never hides mail. Skipping the inbox removes the INBOX label; the mail is still in All Mail and in search [23].
2. **Never delete.** No template offers delete (TRASH). Mail in the bin is gone for good after 30 days, and recovery is rare [23]. Auto-delete is also a common tool of attackers (below).
3. **Never forward.** Forwarding sends your mail to someone else, and a forwarding filter is a classic sign of a hacked account [7].
4. **Security mail stays in the inbox.** Codes and security alerts never offer skip the inbox or mark as read. Attackers who take over an account often add filters that hide or delete security alerts and password reset mail so the owner does not notice [7][24]. A code you did not ask for can be the first sign that someone has your password.
5. **A safety net when you archive.** Templates that offer skip the inbox or mark as read also offer "Keep codes, security alerts and bills in the inbox". It is on by default. When you turn on skip the inbox or mark as read, it adds this to "Doesn't have": `"verification code" OR "security code" OR "one-time" OR passcode OR "sign-in" OR "new login" OR "security alert" OR "password reset" OR "unusual activity" OR invoice OR receipt OR "payment due" OR "direct debit"`. It is off by default only where the template's own mail is the kind it protects (receipts, statements), or where the sender cannot send those messages (GitHub, calendar replies).
6. **No "important" or "never spam" based on words.** Phishing mail copies the words banks, HMRC, couriers and the NHS use. A filter that marks such mail as important, or stops it going to spam, would help a scam reach you. No template sets IMPORTANT or removes SPAM. Finance and government templates match on sender domains and carry a phishing caution.
7. **Short, nested labels.** Labels use "/" to nest, for example `Finance/Banking` [25]. Top-level names are short single words so that the label list stays easy to scan on a phone. `instantiate` creates parents before children (`Dev`, then `Dev/GitHub`, then `Dev/GitHub/Needs you`). If a parent already exists with different capitals (for example `finance`), the new child uses the existing spelling so that it nests under it. The requested `has-unsubscribe` label keeps its exact name.
8. **Precise criteria.** Subject words are preferred over body words, because body words appear in footers and marketing. Two signals together (an unsubscribe footer and sales words) are preferred over one.
9. **Easy to extend.** Sender-list templates offer "Also match these senders". The input is cleaned: only characters that can appear in a domain or address are kept, so a user cannot add operators by mistake.
10. **Review regularly.** Check your filters every few months and delete any you do not recognise, especially ones that forward, delete, archive or mark as read [7][24].

### Where to report scams (UK)

- Forward suspicious email to the NCSC at report@phishing.gov.uk [26].
- Forward suspicious HMRC email to phishing@hmrc.gov.uk [27].
- Evri asks for scam reports at phishing@evri.com [22].
- If you have lost money, tell your bank and report it to Action Fraud [26].

## 3. Template notes

Risk means: low, safe even with every option on; medium, the criteria may catch some mail you need, or the brand is a common phishing target; high, the criteria are broad and the template offers skip the inbox.

### Lists and newsletters

| Template                | Label             | Risk   | Notes                                                                                                                                                                                             |
| ----------------------- | ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Has an unsubscribe link | `has-unsubscribe` | high   | Requested by the maintainer. Matches the word "unsubscribe" and preference phrases in the message. Catches many receipts and alerts too, which is why it labels only and has the safety net.      |
| Newsletters             | `Newsletters`     | medium | Substack, beehiiv, Buttondown, Ghost, Medium, plus "view in browser" phrases. Newsletters sent through Mailchimp and similar tools use the sender's own domain, so the phrases catch those.       |
| Marketing and offers    | `Marketing`       | medium | Needs "unsubscribe" and a sales phrase. More precise than either signal alone.                                                                                                                    |
| Surveys                 | `Surveys`         | low    | Subject words only.                                                                                                                                                                               |
| Group mailing lists     | `Lists`           | low    | `list:googlegroups.com OR list:groups.io`. "Only this list" replaces it with one exact list ID, which is the best practice for any mailing list. VERIFY that a domain-only `list:` value matches. |

### Shopping and receipts

| Template                           | Label                   | Risk | Notes                                                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoices and receipts              | `Receipts`              | low  | Requested by the maintainer. Subject words (invoice, receipt, order and payment confirmation, VAT and tax invoice, proof of purchase) or an attachment named invoice or receipt. VERIFY `filename:invoice` against names such as `Invoice_123.pdf`. |
| Amazon UK orders                   | `Shopping/Amazon`       | low  | GB. Exact service addresses (auto-confirm, shipment-tracking, order-update, return, payments-messages, digital-no-reply), so marketing is not caught. VERIFY the addresses.                                                                         |
| Marketplaces                       | `Shopping/Marketplaces` | low  | eBay, Etsy, Vinted, Depop. Buyer messages come from these senders too.                                                                                                                                                                              |
| App and game store receipts        | `Receipts/Apps`         | low  | Apple, Google Play and Steam receipt addresses. VERIFY the addresses.                                                                                                                                                                               |
| Refunds and returns                | `Shopping/Returns`      | low  | Subject words. HMRC does not tell you about tax refunds by email [27].                                                                                                                                                                              |
| Trials, renewals and price changes | `Subscriptions`         | low  | Helps you cancel before you pay.                                                                                                                                                                                                                    |

### Deliveries

| Template               | Label        | Risk   | Notes                                                                                                                                       |
| ---------------------- | ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery updates       | `Deliveries` | medium | Subject phrases from any shop. Fake "missed delivery" and "redelivery fee" messages are a top UK scam [22].                                 |
| UK couriers            | `Deliveries` | low    | GB. Royal Mail, Parcelforce, Evri, DPD, DPD Local, Yodel, InPost, DHL UK. Genuine Evri mail comes from evri.com [22]. VERIFY other domains. |
| International couriers | `Deliveries` | low    | UPS, FedEx, DHL, USPS, AfterShip.                                                                                                           |

### Money and banking

| Template           | Label                | Risk   | Notes                                                                                                                                                        |
| ------------------ | -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UK banks and cards | `Finance/Banking`    | medium | GB. 21 bank and card domains, including Monzo and Starling. Domains only, never words. Banks sometimes send from a separate mail domain. VERIFY each domain. |
| Statements         | `Finance/Statements` | low    | Subject words.                                                                                                                                               |
| Payment services   | `Finance/Payments`   | medium | PayPal, Wise, Klarna, Clearpay, Stripe, Square, GoCardless. PayPal is a top phishing brand.                                                                  |
| Payslips and P60s  | `Finance/Payslips`   | low    | GB. Payslip, pay advice, P60, P45, P11D.                                                                                                                     |

### Security and accounts

| Template              | Label               | Risk   | Notes                                                                                                                                 |
| --------------------- | ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| One-time codes        | `Security/Codes`    | medium | Subject words. Never archives or marks as read. Offers a star only.                                                                   |
| Security alerts       | `Security/Alerts`   | medium | Subject words for sign-in, unusual activity, password and recovery changes. Never archives. Fake alerts are a common phishing method. |
| Google account alerts | `Security/Google`   | low    | Exact address `no-reply@accounts.google.com`.                                                                                         |
| Data breach notices   | `Security/Breaches` | low    | Have I Been Pwned and breach wording.                                                                                                 |

### Travel

| Template                | Label            | Risk | Notes                                                                                                                                                                         |
| ----------------------- | ---------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Travel bookings         | `Travel`         | low  | Subject phrases from any company. Trainline sends a booking confirmation and, separately, the ticket [28], so both end up here.                                               |
| Booking sites           | `Travel`         | low  | Booking.com, Airbnb, Expedia, Hotels.com, Trip.com, Vrbo, Hostelworld.                                                                                                        |
| UK and Irish airlines   | `Travel/Flights` | low  | GB. BA, easyJet, Ryanair, Jet2, TUI, Virgin Atlantic, Loganair, Aer Lingus.                                                                                                   |
| UK rail, Tube and coach | `Travel/Rail`    | low  | GB. Trainline, National Rail, TfL, the main train operators, Eurostar, National Express, Megabus. Trainline also sends from a subdomain such as `info.thetrainline.com` [28]. |

### Home and bills

| Template                   | Label             | Risk | Notes                                                                                                                                                                          |
| -------------------------- | ----------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bills and direct debits    | `Bills`           | low  | Subject words.                                                                                                                                                                 |
| UK energy and water        | `Bills/Utilities` | low  | GB. Octopus sends from several domains; the template includes octopus.energy and octoenergy.com [29]. Octopus also lists octoes.com, octopusev.com and octopusenergy.services. |
| UK phone, broadband and TV | `Bills/Telecoms`  | low  | GB. Includes TV Licensing, a common scam brand.                                                                                                                                |
| Insurance documents        | `Insurance`       | low  | Subject words.                                                                                                                                                                 |

### Government and health

| Template                       | Label                | Risk   | Notes                                                                                                                                                                                                        |
| ------------------------------ | -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UK government (gov.uk)         | `Government`         | medium | GB. `from:gov.uk`. UK services must email from a service.gov.uk address, for example `servicename@notifications.service.gov.uk` (GOV.UK Notify) [30]. Departments and councils use their own gov.uk domains. |
| HMRC                           | `Government/HMRC`    | medium | GB. Genuine HMRC email ends in `@hmrc.gov.uk`, but the address can be faked, and HMRC never emails about refunds or asks for bank details [27]. Matching tax words instead would label scams as HMRC.        |
| DVLA and DVSA                  | `Government/Driving` | medium | GB. DVLA does not ask for bank details by email [31]. Some reminders come through GOV.UK Notify, which the gov.uk template catches.                                                                          |
| Council tax and bins           | `Government/Council` | low    | GB. Needs a gov.uk sender and council subject words, so scam "council tax refund" mail does not get the label.                                                                                               |
| NHS                            | `Health/NHS`         | medium | GB. nhs.uk and nhs.net. Some GP surgeries send through other messaging systems; add those senders.                                                                                                           |
| Appointments and prescriptions | `Appointments`       | low    | Subject words, any sender.                                                                                                                                                                                   |

### Calendar and work

| Template                  | Label              | Risk | Notes                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calendar invitations      | `Calendar`         | low  | `filename:ics OR filename:vcs`. Standard invitations carry an .ics file [32][33]. There is no documented `has:invite` operator, so we do not use it.                                                                                                                                                                      |
| Calendar replies          | `Calendar/Replies` | low  | `filename:ics` and accepted, declined or tentative in the subject. Google Calendar replies carry `invite.ics` [33]. Google also documents a header method, `header:X-Google-Calendar-Notification:rsvpAccepted` and similar tokens [34]. It is only for Google Calendar, so it is not a template yet (VERIFY in filters). |
| Shared files and comments | `Docs`             | low  | Google Drive share and Docs comment addresses. VERIFY the addresses.                                                                                                                                                                                                                                                      |
| Out of office replies     | `Auto-replies`     | low  | Subject words.                                                                                                                                                                                                                                                                                                            |

### Developer

| Template                     | Label                  | Risk | Notes                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub notifications         | `Dev/GitHub`           | low  | `notifications@github.com`.                                                                                                                                                                                                                           |
| GitHub: needs you            | `Dev/GitHub/Needs you` | low  | GitHub puts a reason address in Cc, such as `mention@`, `review_requested@`, `assign@`, `team_mention@` [35]. Uses `cc:`, which Gmail documents as matching Cc and Bcc [18]. VERIFY on github.com (the docs found were for GitHub Enterprise Server). |
| GitHub Actions results       | `Dev/CI`               | low  | `cc:ci_activity@noreply.github.com` [35].                                                                                                                                                                                                             |
| GitLab notifications         | `Dev/GitLab`           | low  | `from:gitlab.com`. GitLab.com sends from a subdomain; VERIFY the match. Add a self-managed server in "Also match these senders".                                                                                                                      |
| CI, hosting and error alerts | `Dev/Alerts`           | low  | CircleCI, Travis CI, Buildkite, Sentry, Vercel, Netlify, Render, UptimeRobot. No skip the inbox option: these are about live services.                                                                                                                |
| Domains and DNS              | `Dev/Domains`          | low  | Registrars and DNS hosts. A missed renewal can lose every email address on a domain.                                                                                                                                                                  |

### Social and events

| Template           | Label    | Risk | Notes                                                                                                                        |
| ------------------ | -------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| Social networks    | `Social` | low  | 17 sender domains. Account security mail from these networks also comes from them, so the safety net matters if you archive. |
| Events and tickets | `Events` | low  | Eventbrite, Ticketmaster, See Tickets, DICE, Skiddle, AXS, Meetup.                                                           |

### Jobs

| Template         | Label               | Risk | Notes                                                                                                          |
| ---------------- | ------------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| Job alerts       | `Jobs`              | low  | LinkedIn job alert addresses (not all of LinkedIn), Indeed, Glassdoor, ZipRecruiter, and "job alert" subjects. |
| UK job boards    | `Jobs`              | low  | GB. Reed, Totaljobs, CV-Library, CWJobs, Adzuna, Civil Service Jobs, NHS Jobs, jobs.ac.uk.                     |
| Job applications | `Jobs/Applications` | low  | Subject words. Fake job offers that ask for money or ID are common.                                            |

### School and family

| Template           | Label    | Risk | Notes                                                                                                                                                                           |
| ------------------ | -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| School and nursery | `School` | low  | GB. `sch.uk` (used by many UK schools) plus common school apps. Many academies use other domains, so "Also match these senders" matters here. VERIFY each app's sending domain. |

### Housekeeping

| Template                      | Label               | Risk | Notes                                                                                                                                              |
| ----------------------------- | ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated no-reply mail       | `Automated`         | high | Matches no-reply style addresses. Codes, alerts, receipts and bills all come from these, so keep the safety net on if you archive.                 |
| Large attachments             | `Large attachments` | low  | Has an attachment and is larger than 10 MB. Gmail measures the size of the whole message, not the attachment [1].                                  |
| Bounces and delivery failures | `Bounces`           | low  | mailer-daemon and postmaster senders, and bounce subjects. A flood of bounces for mail you did not send can mean someone is spoofing your address. |

### Ideas not made into templates

- **Plus addresses.** Giving each shop `you+shopname@gmail.com` and filtering on `to:` shows who shares your address. This needs the user's own address, so it belongs in the form builder, not the catalogue.
- **VIP senders.** "Never send to spam" and "always important" for named people is useful, but only with exact addresses the user types, never with words.
- **Mail not addressed to you** (`-to:me`). Useful in Workspace, but Google does not say whether `to:` covers Cc, so it could mislabel mail where you are copied (VERIFY).

## 4. VERIFY on a live account

Test each item on both a personal Gmail account and a Google Workspace account. For each, run the criteria in the search box first, then create the filter and send a test message.

1. The exact wording of Gmail's warning about `label:`, `in:`, `is:`, date and star operators.
2. Whether `category:` works in filter criteria for new mail, and whether the category is set before the filter runs.
3. Whether a domain-only `list:` value (`list:googlegroups.com`) matches lists whose ID ends in that domain.
4. Whether `from:amazon.co.uk` matches subdomains (`marketplace.amazon.co.uk`) and lookalikes (`amazon.co.uk.example.net`, `amazon-co-uk.example`).
5. Whether plain words match plurals or other stems, and whether `+word` is still supported.
6. Whether `filename:invoice` matches `Invoice_123.pdf`, `invoice-2026.pdf` and `MyInvoice.pdf`.
7. Whether `cc:` works in a filter for GitHub's reason addresses, and that github.com uses `noreply.github.com`.
8. Whether `from:noreply` matches `no-reply@` and `noreply@` in the same way, and how hyphens in `from:` values are handled.
9. Whether `header:X-Google-Calendar-Notification:rsvpAccepted` works in a filter, not only in search.
10. Whether creating a label `A/B` through the API when `A` does not exist creates a nested label, or a top-level label named `A/B`. (`instantiate` creates `A` first either way.)
11. The sending domains of each UK sender in the catalogue, especially banks (which often use a separate mail domain), Amazon UK service addresses, Google Drive share addresses, GitLab.com, school apps and train operators.
12. That `larger:` in a filter uses the whole message size, and the exact byte value Gmail stores for 10 MB.
13. The criteria length limit (currently believed to be about 1,469 to 1,488 characters).

## 5. Sources

1. Leave Me Alone, "Gmail search operators" (notes that `body:` and `has:unsubscribe` do not exist): https://leavemealone.com/blog/gmail-search-operators/
2. Google for Developers, "Manage Gmail filters" (Gmail API guide): https://developers.google.com/workspace/gmail/api/guides/filter_settings
3. Google, "Refine searches in Gmail" (search operator table): https://support.google.com/mail/answer/7190
4. Mailmeteor, "Gmail search operators": https://mailmeteor.com/blog/gmail-search-operators
5. Google Workspace, "Gmail settings size limits" (cited in PLAN.md): https://knowledge.workspace.google.com/
6. Spudart, "Character limit for Gmail filter": https://www.spudart.org/blog/character-limit-for-gmail-filter/
7. Push Security, "What to do when you find a malicious mail filter in Google Workspace": https://pushsecurity.com/help/what-to-do-when-you-find-a-malicious-mail-filter-in-google-workspace
8. Inbox Zero, "Gmail filters not working? How to fix them": https://www.getinboxzero.com/blog/post/gmail-filters-not-working-troubleshooting-guide
9. Will Larson, "How to filter out old email from inbox": https://lethain.com/filter-old-gmail-messages/
10. Missive, "Using Gmail smart categories": https://missiveapp.com/docs/core-features/connected-accounts/email-accounts/gmail-google-workspace/using-gmail-smart-categories
11. Clarity Inbox, "Gmail filters not working": https://clarityinbox.com/apps/gmail/gmail-filters-not-working
12. Spam Resource, "Delivterms: List-ID": https://www.spamresource.com/2024/05/delivterms-list-id.html
13. Oklahoma Christian University, "Advanced searching in Gmail": https://support.oc.edu/hc/en-us/articles/203198653-Advanced-Searching-Gmail
14. Suped, "What is the unsubscribe header functionality on Gmail": https://www.suped.com/learn/email-deliverability/what-is-the-unsubscribe-header-functionality-on-gmail-and-other-email-services
15. Zapier, "Gmail filters": https://zapier.com/blog/gmail-filters/
16. York University, "How does Gmail search work?" (reproduces Google help text on whole words and special characters): https://google.info.yorku.ca/faq/ive-heard-gmail-search-is-really-powerful-how-does-it-work/
17. Hacker News discussion on partial and wildcard search in Gmail: https://news.ycombinator.com/item?id=3648369
18. Google, "Refine searches in Gmail" (OR and AROUND in capitals, cc: matches Cc and Bcc): https://support.google.com/mail/answer/7190?hl=en-GB
19. Educatius helpdesk, "Gmail search tools" (`+` for exact word, quotes for exact phrase): https://helpdesk.educatius.org/support/solutions/articles/1000024278
20. IONOS, "Gmail search operators" (`from:` takes a name or an address): https://www.ionos.co.uk/digitalguide/e-mail/technical-matters/gmail-search-operators/
21. Ironscales, "What is display name spoofing?": https://ironscales.com/glossary/display-name-spoofing
22. Evri, "Is this Evri text or email genuine?": https://www.evri.com/faqs/receiving-a-parcel/is-this-evri-text-email-genuine and MalwareTips, "customer@tracking-evri.com scam": https://malwaretips.com/blogs/customertracking-evri-com-scam/
23. Blocksender, "How to have emails skip the inbox": https://blocksender.io/how-to-have-emails-skip-the-inbox-archive/ and Digital Citizen, "How to recover missing emails in Gmail": https://www.digitalcitizen.life/how-to-recover-missing-emails-in-gmail/
24. gHacks, "Gmail: Google improves security of sensitive actions": https://www.ghacks.net/?p=201098
25. Hiver, "Gmail labels": https://hiverhq.com/blog/gmail-labels
26. National Cyber Security Centre, "Report suspicious emails": https://www.ncsc.gov.uk/information/report-suspicious-emails
27. CIPP, "Genuine HMRC contact and recognising phishing emails": https://www.cipp.org.uk/resources/news/phishingguidancehmrc.html
28. Trainline business support, "Print your own tickets": https://business.support.thetrainline.com/en/support/solutions/articles/78000000058-i-ve-bought-a-ticket-and-selected-print-your-own-how-do-i-print-it-
29. Octopus Energy, "What should I do if I think I've received a scam or phishing email?": https://octopus.energy/help-and-faqs/articles/what-should-i-do-if-i-think-i-ve-received-a-scam-or-phishing-email/
30. GOV.UK Service Manual, "Sending emails from your service": https://www.gov.uk/service-manual/technology/how-to-email-your-users
31. Which?, "Scammers are impersonating TV Licensing and the DVLA": https://www.which.co.uk/news/article/scammers-are-impersonating-tv-licensing-and-the-dvla-to-steal-your-details-aAagk1z9ZZPm
32. Brown University IT, "Google calendaring with outside collaborators": https://ithelp.brown.edu/kb/articles/pdf/google-calendaring-with-outside-collaborators
33. Jeff Su, "Newsletter 259" (filtering calendar replies by invite.ics): https://www.jeffsu.org/newsletter-259/
34. Google Calendar Help, "Filter and organise Calendar notifications in Gmail": https://support.google.com/calendar/answer/17366804
35. GitHub Docs, "Email notification headers": https://docs.github.com/en/enterprise-server@3.16/subscriptions-and-notifications/reference/email-notification-headers
