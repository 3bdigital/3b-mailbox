# Live test script (Gmail and Google Workspace)

Run this on a personal Gmail account and on a Workspace account before each release. Automated tests use a mock API, so this script is the only check against real Google behaviour.

## Before you start

1. Download a backup of your filters from the app (Settings, Backup). Also export them in Gmail (Settings, Filters and blocked addresses, select all, Export).
2. All test filters use labels under `zz-3bm-test/`. To clean up, delete that label and the filters the app lists under it.
3. Record results in the table at the end, one row per account.

## A. Setup and sign-in

| #   | Step                                                                                                                            | Expected result                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A1  | Create a Google Cloud project, enable the Gmail API, set up the consent screen and a Web client as the landing page guide says. | Each screen matches the guide. Note any differences.                           |
| A2  | Open the app, paste the client ID, sign in with the basic tier.                                                                 | Google asks only for "settings" and "labels" permissions.                      |
| A3  | Personal Gmail in Testing mode: check the warning screen.                                                                       | "Google hasn't verified this app". You can continue.                           |
| A4  | Workspace with Audience "Internal": sign in.                                                                                    | No warning screen.                                                             |
| A5  | Wait 55 minutes.                                                                                                                | The app warns that the session ends soon and offers to renew. No work is lost. |
| A6  | Sign out. Then check myaccount.google.com/permissions.                                                                          | Access is removed.                                                             |
| A7  | On the consent screen, untick one permission.                                                                                   | The app says which permission is missing.                                      |

## B. Read

| #   | Step                                     | Expected result                                                      |
| --- | ---------------------------------------- | -------------------------------------------------------------------- |
| B1  | Load filters.                            | Count matches Gmail Settings. Each summary matches what Gmail shows. |
| B2  | Check labels, nested labels and colours. | All present.                                                         |
| B3  | Check forwarding addresses.              | Verified and pending addresses show the correct status.              |

## C. Write and verify Google's limits (VERIFY items)

| #   | Step                                                                                                                                              | Expected result                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| C1  | Create a filter for each action: archive, mark read, star, trash, never spam, always important, never important, each category, a label, forward. | Each one appears in Gmail with the same action. Record any action the API refuses.    |
| C2  | Settings, Diagnostics, "Measure the criteria length limit" (creates and deletes test filters).                                                    | Records the real maximum. Update `LIMITS.criteriaCharsHard` if it differs from 1,469. |
| C3  | Create a filter with `{(from:a@example.com subject:x) from:b@example.com}`.                                                                       | Gmail accepts it. Send test mail that matches each branch and check that both match.  |
| C4  | Create a filter with `category:promotions`.                                                                                                       | Record if Gmail accepts it and if it matches new mail.                                |
| C5  | Create a filter with `list:example.com`.                                                                                                          | Matches mail with a List-Id from that domain.                                         |
| C6  | Create a filter with `is:unread`.                                                                                                                 | The app warns before creation. Record what Gmail does.                                |
| C7  | Create the same filter twice.                                                                                                                     | The app warns. Record Google's error text.                                            |
| C8  | Forward to an address that is not verified.                                                                                                       | The app blocks it before the call.                                                    |
| C9  | Workspace with automatic forwarding turned off by the admin.                                                                                      | Record the error. The app explains it.                                                |
| C10 | Edit a filter.                                                                                                                                    | A new filter is created, then the old one is deleted. The journal holds the old one.  |
| C11 | Undo the edit from the journal.                                                                                                                   | The old filter comes back.                                                            |

## D. Bulk and consolidation

| #   | Step                                                             | Expected result                                                           |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| D1  | Select 10 test filters, change their label to another label.     | All 10 change. Progress shows. Filter count stays the same.               |
| D2  | Merge 4 test filters with the same action.                       | One filter replaces 4. Test mail to each old sender still gets the label. |
| D3  | Bulk delete 10 test filters, then restore them from the journal. | All 10 come back.                                                         |
| D4  | Create 30 filters in one plan.                                   | No quota errors. If Google sends 429, the app waits and continues.        |

## E. Opt-in tiers

| #   | Step                                                      | Expected result                                                                           |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| E1  | Turn on "Show matching mail".                             | Google asks for read access only now. Previews show sender, subject and date.             |
| E2  | Turn on "Apply to existing mail" and apply a test filter. | Existing matching mail gets the label. The app shows the count first and asks to confirm. |
| E3  | Turn the tiers off and sign in again.                     | Google asks for basic access only.                                                        |

## F. Devices and assistive technology

| #   | Step                                                               | Expected result                                 |
| --- | ------------------------------------------------------------------ | ----------------------------------------------- |
| F1  | iPhone Safari: Add to Home Screen, open, sign in.                  | Works. Sign-in popup returns to the app.        |
| F2  | Android Chrome: install.                                           | Works.                                          |
| F3  | VoiceOver (macOS and iOS): create, edit and bulk change a filter.  | All controls have names. Progress is announced. |
| F4  | Keyboard only on desktop.                                          | Every action works. Focus is always visible.    |
| F5  | 400% zoom and Windows High Contrast (or forced colours emulation). | No loss of content or function.                 |

## Results

| Account        | Date | App version | Pass | Notes and measured limits |
| -------------- | ---- | ----------- | ---- | ------------------------- |
| Personal Gmail |      |             |      |                           |
| Workspace      |      |             |      |                           |

## G. No sign-in mode (Gmail XML export and import)

| #   | Step                                                                                        | Expected result                                                                                  |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| G1  | Export all filters in Gmail. Open the file in the app.                                      | Filter count matches Gmail. No warnings, or every warning names a real Gmail feature.            |
| G2  | Note any property the app does not know (for example `cannedResponse` for "Send template"). | Add each one to `core/backup.js` so it is kept, not dropped.                                     |
| G3  | Check sizes in KB and MB, and filters with no size.                                         | Sizes match Gmail. 1 KB = 1,024 bytes, 1 MB = 1,048,576 bytes.                                   |
| G4  | Make a change, download, delete all filters in Gmail, import the new file.                  | Gmail creates the same filters plus the change. Note the exact wording of Gmail's import screen. |
| G5  | Import a file where one filter has two labels (the app writes two entries).                 | Gmail creates two filters, one for each label.                                                   |
| G6  | Import a file with a new nested label, for example `zz-3bm-test/new/child`.                 | Gmail creates the labels.                                                                        |
| G7  | Import a file with a category (`smartLabelToApply`) and a size in bytes (`s_sb`).           | Gmail accepts both.                                                                              |
| G8  | Import a file that forwards to an address that is not verified.                             | Record what Gmail does.                                                                          |

## H. Real Safari checks

| #   | Step                                                                             | Expected result                                                                                                      |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| H1  | Safari on Mac and iPhone: open Filters and the filter editor, use each dropdown. | Dropdowns look and work like the rest of the app. Note any "Refused to apply a stylesheet" message in Web Inspector. |
