// @ts-check
// Suggested filter catalogue. See docs/TEMPLATES.md for the research behind every template.
//
// This module is self-contained on purpose: it does not import other core modules.
// It uses system label ID literals (INBOX, UNREAD, STARRED, IMPORTANT, SPAM, CATEGORY_*).
//
// Rules that every template follows (tested in tests/unit/core/templates.test.js):
// - Criteria use only operators that match incoming mail (no label:, in:, is:, date operators,
//   star operators or category:).
// - Criteria stay well under the 1,400 character safe cap.
// - Defaults are label only. Skipping the inbox and marking as read are opt-in.
// - No template deletes mail, forwards mail, marks mail as important or never-spam.

/** @typedef {import('../types.js').Template} Template */
/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').FilterCriteria} FilterCriteria */
/** @typedef {import('../types.js').Label} Label */

/** Safe cap for the criteria of one filter, in characters. Mirrors LIMITS.criteriaCharsSafe. */
const CRITERIA_CAP = 1400;

/** Placeholder prefix for labels that do not exist yet. The executor swaps it for the real ID. */
const NEW_LABEL_PREFIX = 'new:';

/**
 * Terms that keep codes, security alerts and money mail in the inbox when a template that
 * archives or marks as read is turned on. Added to negatedQuery ("Doesn't have").
 */
const SAFETY_TERMS =
  '"verification code" OR "security code" OR "one-time" OR passcode OR "sign-in" OR ' +
  '"new login" OR "security alert" OR "password reset" OR "unusual activity" OR ' +
  'invoice OR receipt OR "payment due" OR "direct debit"';

/** System label IDs. Anything else in addLabelIds is a user label (or a "new:" placeholder). */
const SYSTEM_LABEL_ID =
  /^(INBOX|UNREAD|STARRED|IMPORTANT|SPAM|TRASH|SENT|DRAFT|CHAT|CATEGORY_[A-Z]+)$/;

/** Label names that Gmail reserves. A user label cannot use them. */
const RESERVED_LABEL_NAMES = new Set([
  'inbox',
  'spam',
  'trash',
  'bin',
  'unread',
  'starred',
  'important',
  'sent',
  'draft',
  'drafts',
  'chat',
  'chats',
  'all mail',
  'scheduled',
  'snoozed',
  'outbox',
]);

export const TEMPLATE_GROUPS = [
  'Lists and newsletters',
  'Shopping and receipts',
  'Deliveries',
  'Money and banking',
  'Security and accounts',
  'Travel',
  'Home and bills',
  'Government and health',
  'Calendar and work',
  'Developer',
  'Social and events',
  'Jobs',
  'School and family',
  'Housekeeping',
];

const COMMON_CAUTION =
  'A label is not proof that a message is genuine. Check the full sender address before you click a link.';

const PHISHING_CAUTION =
  'Criminals copy the names and words these senders use. This filter only adds a label. Do not use it to mark mail as important or to stop it going to spam.';

/**
 * Builds the option list for a template from a few flags, so that every template offers
 * the same options with the same keys and wording.
 * @param {{labelName: string, archive?: boolean, markRead?: boolean, star?: boolean}} defaults
 * @param {{skip?: boolean, read?: boolean, star?: boolean, senders?: boolean, listId?: boolean, safety?: boolean}} flags
 * @returns {Template['options']}
 */
function buildOptions(defaults, flags) {
  /** @type {Template['options']} */
  const options = [
    {
      key: 'labelName',
      label: 'Label name',
      type: 'text',
      default: defaults.labelName,
      help: 'Use "/" to nest a label, for example Finance/Banking. Short names are easier to scan.',
    },
  ];
  if (flags.skip) {
    options.push({
      key: 'skipInbox',
      label: 'Skip the inbox (archive)',
      type: 'boolean',
      default: Boolean(defaults.archive),
      help: 'Mail goes straight to the label. You can still find it in All Mail and in search.',
    });
  }
  if (flags.read) {
    options.push({
      key: 'markRead',
      label: 'Mark as read',
      type: 'boolean',
      default: Boolean(defaults.markRead),
      help: 'Together with skip the inbox, you will not see this mail unless you open the label.',
    });
  }
  if (flags.skip || flags.read) {
    options.push({
      key: 'keepSafetyMail',
      label: 'Keep codes, security alerts and bills in the inbox',
      type: 'boolean',
      default: flags.safety !== false,
      help: 'When you skip the inbox or mark as read, mail that mentions sign-in codes, security alerts, invoices or payments still reaches your inbox.',
    });
  }
  if (flags.star) {
    options.push({
      key: 'star',
      label: 'Star it',
      type: 'boolean',
      default: Boolean(defaults.star),
    });
  }
  if (flags.senders) {
    options.push({
      key: 'extraSenders',
      label: 'Also match these senders',
      type: 'text',
      default: '',
      help: 'Domains or addresses, separated by commas or spaces, for example myschool.sch.uk.',
    });
  }
  if (flags.listId) {
    options.push({
      key: 'listId',
      label: 'Only this list',
      type: 'text',
      default: '',
      help: 'The list ID from "Show original", for example parents.myschool.sch.uk. Leave empty to match all lists below.',
    });
  }
  return options;
}

/**
 * @param {object} t
 * @param {string} t.id
 * @param {string} t.name
 * @param {string} t.group
 * @param {string} t.description
 * @param {string} t.rationale
 * @param {FilterCriteria} t.criteria
 * @param {{labelName: string, archive?: boolean, markRead?: boolean, star?: boolean}} t.defaults
 * @param {{skip?: boolean, read?: boolean, star?: boolean, senders?: boolean, listId?: boolean, safety?: boolean}} [t.flags]
 * @param {'low'|'medium'|'high'} t.risk
 * @param {string[]} [t.cautions]
 * @param {string[]} [t.regions]
 * @returns {Template}
 */
function define(t) {
  const flags = t.flags || {};
  return {
    id: t.id,
    name: t.name,
    group: t.group,
    description: t.description,
    rationale: t.rationale,
    criteria: t.criteria,
    defaults: {
      labelName: t.defaults.labelName,
      archive: Boolean(t.defaults.archive),
      markRead: Boolean(t.defaults.markRead),
      star: Boolean(t.defaults.star),
      important: null,
      neverSpam: false,
      category: null,
    },
    options: buildOptions(t.defaults, flags),
    risk: t.risk,
    cautions: t.cautions || [],
    regions: t.regions || [],
  };
}

const G = {
  lists: TEMPLATE_GROUPS[0],
  shopping: TEMPLATE_GROUPS[1],
  deliveries: TEMPLATE_GROUPS[2],
  money: TEMPLATE_GROUPS[3],
  security: TEMPLATE_GROUPS[4],
  travel: TEMPLATE_GROUPS[5],
  home: TEMPLATE_GROUPS[6],
  government: TEMPLATE_GROUPS[7],
  work: TEMPLATE_GROUPS[8],
  developer: TEMPLATE_GROUPS[9],
  social: TEMPLATE_GROUPS[10],
  jobs: TEMPLATE_GROUPS[11],
  school: TEMPLATE_GROUPS[12],
  housekeeping: TEMPLATE_GROUPS[13],
};

const GB = ['GB'];

/** @type {Template[]} */
export const TEMPLATES = [
  // Lists and newsletters
  define({
    id: 'has-unsubscribe',
    name: 'Has an unsubscribe link',
    group: G.lists,
    description:
      'Labels any message that mentions "unsubscribe" or a link to manage email preferences.',
    rationale:
      'Gmail has no operator for the List-Unsubscribe header, so the word in the body is the best signal a filter can use. One broad label gives you a single place to review bulk mail and unsubscribe from senders you no longer want.',
    criteria: {
      query:
        'unsubscribe OR "manage your preferences" OR "update your preferences" OR "email preferences" OR "opt out of"',
    },
    defaults: { labelName: 'has-unsubscribe' },
    flags: { skip: true, read: true },
    risk: 'high',
    cautions: [
      'Many receipts, bank alerts, delivery updates and security messages carry an unsubscribe footer, so they get this label too.',
      'If you skip the inbox, keep "Keep codes, security alerts and bills in the inbox" turned on.',
    ],
  }),
  define({
    id: 'newsletters',
    name: 'Newsletters',
    group: G.lists,
    description:
      'Newsletters sent through Substack, beehiiv, Buttondown, Ghost and Medium, and mail with a "view in browser" link.',
    rationale:
      'Newsletters are reading, not tasks. A label lets you read them in one sitting instead of letting them break up your inbox.',
    criteria: {
      query:
        'from:(substack.com OR beehiiv.com OR buttondown.email OR ghost.io OR medium.com) OR "view in browser" OR "view this email in your browser" OR "view it in your browser"',
    },
    defaults: { labelName: 'Newsletters' },
    flags: { skip: true, read: true, senders: true },
    risk: 'medium',
    cautions: ['Some shops and services also use a "view in browser" link in order emails.'],
  }),
  define({
    id: 'marketing',
    name: 'Marketing and offers',
    group: G.lists,
    description:
      'Bulk mail with an unsubscribe footer that also uses sales words such as "shop now", "promo code" or "sale ends".',
    rationale:
      'Two signals together (an unsubscribe footer and sales wording) are far more precise than either one alone.',
    criteria: {
      query:
        'unsubscribe ("shop now" OR "limited time" OR "sale ends" OR "promo code" OR "discount code" OR "use code" OR "exclusive offer" OR "free delivery" OR "black friday")',
    },
    defaults: { labelName: 'Marketing' },
    flags: { skip: true, read: true },
    risk: 'medium',
    cautions: ['Order confirmations sometimes advertise offers in the footer.'],
  }),
  define({
    id: 'surveys',
    name: 'Surveys and review requests',
    group: G.lists,
    description: 'Requests to rate a purchase, fill in a survey or leave a review.',
    rationale: 'These rarely need action. A label keeps them out of the way of real requests.',
    criteria: {
      subject:
        'survey OR "how did we do" OR "rate your" OR "leave a review" OR "your feedback" OR "tell us what you think"',
    },
    defaults: { labelName: 'Surveys' },
    flags: { skip: true, read: true },
    risk: 'low',
  }),
  define({
    id: 'group-lists',
    name: 'Group mailing lists',
    group: G.lists,
    description: 'Mail from Google Groups and groups.io lists, matched by the List-Id header.',
    rationale:
      'The list: operator matches the List-Id header, which stays the same even when the sender changes. That makes it the most stable way to file list mail.',
    criteria: { query: 'list:googlegroups.com OR list:groups.io' },
    defaults: { labelName: 'Lists' },
    flags: { skip: true, read: true, listId: true },
    risk: 'low',
    cautions: [
      'Workspace groups on your own domain use your domain in the List-Id. Put that list ID in "Only this list".',
    ],
  }),

  // Shopping and receipts
  define({
    id: 'receipts',
    name: 'Invoices and receipts',
    group: G.shopping,
    description:
      'Invoices, receipts, order and payment confirmations, VAT invoices, and attachments named invoice or receipt.',
    rationale:
      'One label for proof of purchase makes returns, warranty claims, expenses and Self Assessment much quicker. Subject words are more precise than body words, which also appear in marketing.',
    criteria: {
      query:
        'subject:(invoice OR receipt OR "order confirmation" OR "order confirmed" OR "payment received" OR "payment confirmation" OR "VAT invoice" OR "tax invoice" OR "proof of purchase" OR "purchase confirmation") OR filename:invoice OR filename:receipt',
    },
    defaults: { labelName: 'Receipts' },
    flags: { skip: true, read: true, star: true, senders: true, safety: false },
    risk: 'low',
    cautions: [
      'Fake invoices are a common scam. Do not open unexpected invoice attachments.',
      COMMON_CAUTION,
    ],
  }),
  define({
    id: 'amazon-uk',
    name: 'Amazon UK orders',
    group: G.shopping,
    description:
      'Order, dispatch, return and payment messages from Amazon.co.uk, not Amazon marketing.',
    rationale:
      'Matching the exact service addresses keeps marketing out. A broad from:amazon.co.uk would also catch offers and recommendations.',
    criteria: {
      from: 'auto-confirm@amazon.co.uk OR shipment-tracking@amazon.co.uk OR order-update@amazon.co.uk OR return@amazon.co.uk OR payments-messages@amazon.co.uk OR digital-no-reply@amazon.co.uk',
    },
    defaults: { labelName: 'Shopping/Amazon' },
    flags: { skip: true, read: true },
    risk: 'low',
    cautions: ['Amazon is one of the most copied brands in scam email.'],
    regions: GB,
  }),
  define({
    id: 'marketplaces',
    name: 'Marketplaces',
    group: G.shopping,
    description: 'eBay, Etsy, Vinted and Depop.',
    rationale:
      'Buying and selling on marketplaces creates a lot of mail. One label keeps sales, offers and messages together.',
    criteria: {
      from: 'ebay.com OR ebay.co.uk OR etsy.com OR vinted.com OR vinted.co.uk OR depop.com',
    },
    defaults: { labelName: 'Shopping/Marketplaces' },
    flags: { skip: true, read: true, senders: true },
    risk: 'low',
    cautions: [
      'Buyer messages also come from these senders. Do not skip the inbox while you are selling.',
    ],
  }),
  define({
    id: 'app-stores',
    name: 'App and game store receipts',
    group: G.shopping,
    description: 'Receipts from the Apple App Store, Google Play and Steam.',
    rationale:
      'Store receipts are the quickest way to spot subscriptions you forgot about or purchases you did not make.',
    criteria: {
      from: 'no_reply@email.apple.com OR googleplay-noreply@google.com OR noreply@steampowered.com',
    },
    defaults: { labelName: 'Receipts/Apps' },
    flags: { skip: true, read: true },
    risk: 'low',
    cautions: ['Fake "your subscription has renewed" emails are a common scam.'],
  }),
  define({
    id: 'refunds-returns',
    name: 'Refunds and returns',
    group: G.shopping,
    description: 'Return labels, return requests and refund messages.',
    rationale:
      'Returns have deadlines. A separate label makes it easy to check that every refund arrived.',
    criteria: {
      subject:
        'refund OR "return label" OR "returns label" OR "return request" OR "return received" OR "refund processed"',
    },
    defaults: { labelName: 'Shopping/Returns' },
    flags: { star: true },
    risk: 'low',
    cautions: [
      'Refund scams are common, for example fake "tax refund" emails. HMRC does not tell you about refunds by email.',
    ],
  }),
  define({
    id: 'subscriptions',
    name: 'Trials, renewals and price changes',
    group: G.shopping,
    description:
      'Free trials ending, subscription renewals, auto-renew notices and price increases.',
    rationale:
      'These messages tell you when money is about to leave your account. Filing them together helps you cancel in time.',
    criteria: {
      subject:
        '"free trial" OR "trial ends" OR "trial ending" OR "subscription renewal" OR "will renew" OR "auto-renew" OR "renewal reminder" OR "price increase" OR "price change"',
    },
    defaults: { labelName: 'Subscriptions' },
    flags: { star: true },
    risk: 'low',
  }),

  // Deliveries
  define({
    id: 'delivery-updates',
    name: 'Delivery updates',
    group: G.deliveries,
    description:
      'Dispatched, shipped, out for delivery and delivered messages from any shop or courier.',
    rationale:
      'Delivery mail is short-lived. Subject phrases catch it from any shop without a long sender list.',
    criteria: {
      subject:
        '"out for delivery" OR "has been delivered" OR "was delivered" OR dispatched OR shipped OR "on its way" OR "delivery update" OR "tracking number" OR "track your parcel" OR "track your order"',
    },
    defaults: { labelName: 'Deliveries' },
    flags: { skip: true, read: true },
    risk: 'medium',
    cautions: [
      'Fake "missed delivery" and "redelivery fee" messages are among the most common scams in the UK. Couriers do not ask for a fee by email link.',
      'If you skip the inbox you may miss a "we could not deliver" message.',
    ],
  }),
  define({
    id: 'uk-couriers',
    name: 'UK couriers',
    group: G.deliveries,
    description: 'Royal Mail, Parcelforce, Evri, DPD, Yodel, InPost and DHL UK.',
    rationale: 'Courier mail comes from a small set of domains, so a sender list is precise.',
    criteria: {
      from: 'royalmail.com OR parcelforce.com OR evri.com OR dpd.co.uk OR dpdlocal.co.uk OR yodel.co.uk OR inpost.co.uk OR dhl.co.uk',
    },
    defaults: { labelName: 'Deliveries' },
    flags: { skip: true, read: true, senders: true },
    risk: 'low',
    cautions: [
      'Scammers use lookalike domains such as tracking-evri.com. Genuine Evri mail comes from evri.com.',
    ],
    regions: GB,
  }),
  define({
    id: 'global-couriers',
    name: 'International couriers',
    group: G.deliveries,
    description: 'UPS, FedEx, DHL, USPS and AfterShip tracking mail.',
    rationale: 'Courier mail comes from a small set of domains, so a sender list is precise.',
    criteria: { from: 'ups.com OR fedex.com OR dhl.com OR usps.com OR aftership.com' },
    defaults: { labelName: 'Deliveries' },
    flags: { skip: true, read: true, senders: true },
    risk: 'low',
    cautions: ['Fake customs fee messages often copy these brands.'],
  }),

  // Money and banking
  define({
    id: 'uk-banks',
    name: 'UK banks and cards',
    group: G.money,
    description:
      'Monzo, Starling, Revolut, HSBC, first direct, Barclays, Barclaycard, NatWest, RBS, Lloyds, Halifax, Bank of Scotland, Santander, Nationwide, TSB, Chase UK, Metro Bank, Virgin Money, Co-op Bank, Amex and Capital One.',
    rationale:
      'A sender list based on domains is much harder to fool than words such as "bank" or "account", which scammers use all the time.',
    criteria: {
      from: 'monzo.com OR starlingbank.com OR revolut.com OR hsbc.co.uk OR firstdirect.com OR barclays.co.uk OR barclaycard.co.uk OR natwest.com OR rbs.co.uk OR lloydsbank.co.uk OR halifax.co.uk OR bankofscotland.co.uk OR santander.co.uk OR nationwide.co.uk OR tsb.co.uk OR chase.co.uk OR metrobankonline.co.uk OR virginmoney.com OR co-operativebank.co.uk OR americanexpress.com OR capitalone.co.uk',
    },
    defaults: { labelName: 'Finance/Banking' },
    flags: { star: true, senders: true },
    risk: 'medium',
    cautions: [PHISHING_CAUTION, 'Banks never ask for your PIN or full password by email.'],
    regions: GB,
  }),
  define({
    id: 'statements',
    name: 'Statements',
    group: G.money,
    description: 'Messages that say a statement, e-statement or annual summary is ready.',
    rationale:
      'Statements are records. A label makes them easy to find at tax time without hunting through every bank.',
    criteria: {
      subject:
        'statement OR "e-statement" OR estatement OR "annual summary" OR "statement is ready" OR "statement is available"',
    },
    defaults: { labelName: 'Finance/Statements' },
    flags: { skip: true, read: true, safety: false },
    risk: 'low',
    cautions: [PHISHING_CAUTION],
  }),
  define({
    id: 'payment-services',
    name: 'Payment services',
    group: G.money,
    description: 'PayPal, Wise, Klarna, Clearpay, Stripe, Square and GoCardless.',
    rationale: 'Payment notices from these services are receipts and alerts in one place.',
    criteria: {
      from: 'paypal.com OR paypal.co.uk OR wise.com OR klarna.com OR clearpay.co.uk OR stripe.com OR squareup.com OR gocardless.com',
    },
    defaults: { labelName: 'Finance/Payments' },
    flags: { star: true, senders: true },
    risk: 'medium',
    cautions: [PHISHING_CAUTION, 'PayPal is one of the most copied brands in scam email.'],
  }),
  define({
    id: 'payslips',
    name: 'Payslips and P60s',
    group: G.money,
    description: 'Payslips, pay advice, P60, P45 and P11D documents.',
    rationale:
      'You need these for mortgages, tax checks and benefit claims. One label keeps every year in one place.',
    criteria: {
      subject: 'payslip OR "pay slip" OR "pay advice" OR P60 OR P45 OR P11D',
    },
    defaults: { labelName: 'Finance/Payslips' },
    flags: { star: true },
    risk: 'low',
    regions: GB,
  }),

  // Security and accounts
  define({
    id: 'one-time-codes',
    name: 'One-time codes',
    group: G.security,
    description: 'Verification codes, one-time passwords and sign-in codes.',
    rationale:
      'A label makes codes easy to find and easy to clean up later. They stay in the inbox, because a hidden code delays your sign-in and can hide an attacker who is trying to sign in as you.',
    criteria: {
      subject:
        '"verification code" OR "security code" OR "one-time code" OR "one-time password" OR "one time passcode" OR passcode OR "login code" OR "sign-in code" OR "confirmation code" OR "your code" OR OTP',
    },
    defaults: { labelName: 'Security/Codes' },
    flags: { star: true },
    risk: 'medium',
    cautions: [
      'This template never skips the inbox or marks as read. A code you did not ask for can be the first sign that someone has your password.',
      'Never share a code with anyone who contacts you.',
    ],
  }),
  define({
    id: 'security-alerts',
    name: 'Security alerts',
    group: G.security,
    description:
      'New sign-in, unusual activity, password change, new device and two-step verification alerts from any service.',
    rationale:
      'A label makes alerts easy to review. They stay in the inbox: attackers who take over an account often add filters that hide these alerts.',
    criteria: {
      subject:
        '"security alert" OR "new sign-in" OR "new login" OR "sign-in attempt" OR "unusual activity" OR "suspicious activity" OR "password changed" OR "password was changed" OR "password reset" OR "reset your password" OR "new device" OR "two-factor" OR "2-step verification" OR "recovery email" OR "recovery phone"',
    },
    defaults: { labelName: 'Security/Alerts' },
    flags: { star: true },
    risk: 'medium',
    cautions: [
      'Fake security alerts are a common way to steal passwords. Open the service yourself instead of using a link in the message.',
      'Never skip the inbox, mark as read or delete security alerts.',
    ],
  }),
  define({
    id: 'google-account',
    name: 'Google account alerts',
    group: G.security,
    description: 'Security and account messages from Google accounts.',
    rationale:
      'This single address sends Google sign-in alerts and recovery messages. Matching the full address is precise.',
    criteria: { from: 'no-reply@accounts.google.com' },
    defaults: { labelName: 'Security/Google' },
    flags: { star: true },
    risk: 'low',
    cautions: ['Never skip the inbox or delete these messages.'],
  }),
  define({
    id: 'breach-notices',
    name: 'Data breach notices',
    group: G.security,
    description: 'Have I Been Pwned alerts and messages about a data breach or security incident.',
    rationale:
      'A breach notice usually means you should change a password. A label makes sure you can find it again.',
    criteria: {
      query:
        'from:haveibeenpwned.com OR subject:("data breach" OR "security incident" OR "data security incident" OR "unauthorised access" OR "unauthorized access")',
    },
    defaults: { labelName: 'Security/Breaches' },
    flags: { star: true },
    risk: 'low',
    cautions: [COMMON_CAUTION],
  }),

  // Travel
  define({
    id: 'travel-bookings',
    name: 'Travel bookings',
    group: G.travel,
    description:
      'Booking confirmations, booking references, itineraries, e-tickets and boarding passes from any company.',
    rationale:
      'Subject phrases catch bookings from airlines, hotels, rail and ferries without a long sender list. You need these quickly, often on a phone with a poor signal.',
    criteria: {
      subject:
        '"booking confirmation" OR "booking confirmed" OR "booking reference" OR itinerary OR "e-ticket" OR eticket OR "boarding pass" OR "online check-in" OR "reservation confirmed" OR "reservation confirmation" OR "your trip"',
    },
    defaults: { labelName: 'Travel' },
    flags: { star: true },
    risk: 'low',
  }),
  define({
    id: 'travel-sites',
    name: 'Booking sites',
    group: G.travel,
    description: 'Booking.com, Airbnb, Expedia, Hotels.com, Trip.com, Vrbo and Hostelworld.',
    rationale:
      'Booking sites send confirmations, changes and host messages from their own domains.',
    criteria: {
      from: 'booking.com OR airbnb.com OR expedia.com OR expedia.co.uk OR hotels.com OR trip.com OR vrbo.com OR hostelworld.com',
    },
    defaults: { labelName: 'Travel' },
    flags: { skip: true, read: true, senders: true },
    risk: 'low',
    cautions: [
      'Hosts message you through these senders. Do not skip the inbox around a trip.',
      'Fake booking messages that ask you to "confirm your card" are common.',
    ],
  }),
  define({
    id: 'uk-airlines',
    name: 'UK and Irish airlines',
    group: G.travel,
    description:
      'British Airways, easyJet, Ryanair, Jet2, TUI, Virgin Atlantic, Loganair and Aer Lingus.',
    rationale:
      'Flight changes and check-in reminders matter. A sender list files them without matching every travel newsletter.',
    criteria: {
      from: 'ba.com OR britishairways.com OR easyjet.com OR ryanair.com OR jet2.com OR jet2holidays.com OR tui.co.uk OR virginatlantic.com OR loganair.co.uk OR aerlingus.com',
    },
    defaults: { labelName: 'Travel/Flights' },
    flags: { star: true, senders: true },
    risk: 'low',
    regions: GB,
  }),
  define({
    id: 'uk-rail',
    name: 'UK rail, Tube and coach',
    group: G.travel,
    description:
      'Trainline, National Rail, TfL, train operators, Eurostar, National Express and Megabus.',
    rationale:
      'Tickets, delay repay claims and contactless journey statements come from a known set of domains.',
    criteria: {
      from: 'thetrainline.com OR trainline.com OR nationalrail.co.uk OR tfl.gov.uk OR lner.co.uk OR gwr.com OR avantiwestcoast.co.uk OR crosscountrytrains.co.uk OR tpexpress.co.uk OR northernrailway.co.uk OR scotrail.co.uk OR southwesternrailway.com OR southernrailway.com OR thameslinkrailway.com OR greateranglia.co.uk OR eurostar.com OR nationalexpress.com OR megabus.com',
    },
    defaults: { labelName: 'Travel/Rail' },
    flags: { skip: true, read: true, senders: true },
    risk: 'low',
    regions: GB,
  }),

  // Home and bills
  define({
    id: 'bills',
    name: 'Bills and direct debits',
    group: G.home,
    description:
      'New bills, payment due notices, direct debit notices and meter reading requests from any company.',
    rationale: 'Bills have due dates. A label gives you one place to check what you owe.',
    criteria: {
      subject:
        '"your bill" OR "bill is ready" OR "new bill" OR "latest bill" OR "direct debit" OR "payment due" OR "amount due" OR "meter reading"',
    },
    defaults: { labelName: 'Bills' },
    flags: { star: true },
    risk: 'low',
    cautions: [COMMON_CAUTION],
  }),
  define({
    id: 'uk-utilities',
    name: 'UK energy and water',
    group: G.home,
    description:
      'Octopus, British Gas, EDF, E.ON, OVO, ScottishPower, So Energy, Utilita and the main water companies.',
    rationale:
      'Energy and water mail includes bills, tariff changes and smart meter notices. Sender domains are precise.',
    criteria: {
      from: 'octopus.energy OR octoenergy.com OR britishgas.co.uk OR edfenergy.com OR eonenergy.com OR eonnext.com OR ovoenergy.com OR scottishpower.co.uk OR so.energy OR utilita.co.uk OR thameswater.co.uk OR severntrent.co.uk OR unitedutilities.com OR anglianwater.co.uk OR yorkshirewater.com OR southernwater.co.uk OR wessexwater.co.uk OR dwrcymru.com',
    },
    defaults: { labelName: 'Bills/Utilities' },
    flags: { skip: true, read: true, senders: true },
    risk: 'low',
    cautions: [
      'Fake energy rebate emails are common. Your supplier will not ask for card details by email.',
    ],
    regions: GB,
  }),
  define({
    id: 'uk-telecoms',
    name: 'UK phone, broadband and TV',
    group: G.home,
    description:
      'BT, EE, Sky, Virgin Media, Vodafone, O2, Three, giffgaff, TalkTalk, Plusnet, Hyperoptic and TV Licensing.',
    rationale: 'These providers send bills and contract notices from their own domains.',
    criteria: {
      from: 'bt.com OR ee.co.uk OR sky.com OR virginmedia.com OR vodafone.co.uk OR o2.co.uk OR three.co.uk OR giffgaff.com OR talktalk.co.uk OR plus.net OR hyperoptic.com OR tvlicensing.co.uk',
    },
    defaults: { labelName: 'Bills/Telecoms' },
    flags: { skip: true, read: true, senders: true },
    risk: 'low',
    cautions: ['Fake TV Licensing refund emails are a common scam.'],
    regions: GB,
  }),
  define({
    id: 'insurance',
    name: 'Insurance documents',
    group: G.home,
    description: 'Policy documents, renewal notices, renewal quotes and certificates of insurance.',
    rationale:
      'Renewal notices are the moment to compare prices. A label stops them getting lost, and keeps documents you may need for a claim.',
    criteria: {
      subject:
        '"policy documents" OR "insurance renewal" OR "renewal notice" OR "renewal quote" OR "certificate of insurance" OR "your policy" OR "policy schedule"',
    },
    defaults: { labelName: 'Insurance' },
    flags: { star: true },
    risk: 'low',
  }),

  // Government and health
  define({
    id: 'gov-uk',
    name: 'UK government (gov.uk)',
    group: G.government,
    description:
      'Mail from any gov.uk address, including GOV.UK Notify, HMRC, DVLA, councils and other public bodies.',
    rationale:
      'UK public services must email from a gov.uk address, so the domain is a strong and simple signal.',
    criteria: { from: 'gov.uk' },
    defaults: { labelName: 'Government' },
    flags: { star: true },
    risk: 'medium',
    cautions: [PHISHING_CAUTION, 'Report suspicious email to report@phishing.gov.uk (NCSC).'],
    regions: GB,
  }),
  define({
    id: 'hmrc',
    name: 'HMRC',
    group: G.government,
    description: 'Mail from hmrc.gov.uk addresses: Self Assessment, tax code and PAYE messages.',
    rationale:
      'Genuine HMRC email comes from an address ending in hmrc.gov.uk. Matching the domain, not tax words, avoids labelling scam "tax refund" mail as HMRC.',
    criteria: { from: 'hmrc.gov.uk' },
    defaults: { labelName: 'Government/HMRC' },
    flags: { star: true },
    risk: 'medium',
    cautions: [
      'HMRC does not tell you about tax refunds by email or ask for bank details. Forward suspicious HMRC email to phishing@hmrc.gov.uk.',
      PHISHING_CAUTION,
    ],
    regions: GB,
  }),
  define({
    id: 'driving',
    name: 'DVLA and DVSA',
    group: G.government,
    description: 'Vehicle tax, driving licence and MOT messages from the DVLA and DVSA.',
    rationale: 'Vehicle tax and MOT dates carry fines if you miss them.',
    criteria: { from: 'dvla.gov.uk OR dvsa.gov.uk' },
    defaults: { labelName: 'Government/Driving' },
    flags: { star: true, senders: true },
    risk: 'medium',
    cautions: [
      'Fake "vehicle tax unpaid" emails are common. DVLA does not ask for bank details by email.',
      'Some reminders come through GOV.UK Notify (notifications.service.gov.uk). The gov.uk template catches those.',
    ],
    regions: GB,
  }),
  define({
    id: 'council',
    name: 'Council tax and bins',
    group: G.government,
    description: 'Council tax, business rates and bin collection mail from a gov.uk address.',
    rationale:
      'Councils use their own gov.uk domains. Requiring a gov.uk sender stops scam "council tax refund" mail getting this label.',
    criteria: {
      query:
        'from:gov.uk subject:("council tax" OR "business rates" OR "bin collection" OR "waste collection" OR "recycling collection")',
    },
    defaults: { labelName: 'Government/Council' },
    flags: { star: true },
    risk: 'low',
    cautions: [PHISHING_CAUTION],
    regions: GB,
  }),
  define({
    id: 'nhs',
    name: 'NHS',
    group: G.government,
    description: 'Mail from nhs.uk and nhs.net addresses: GP surgeries, hospitals and the NHS App.',
    rationale:
      'NHS bodies use nhs.uk and nhs.net. Health mail is personal and time-sensitive, so it deserves its own label.',
    criteria: { from: 'nhs.uk OR nhs.net' },
    defaults: { labelName: 'Health/NHS' },
    flags: { star: true, senders: true },
    risk: 'medium',
    cautions: [
      'Some GP surgeries send messages through other systems. Add their sender in "Also match these senders".',
      PHISHING_CAUTION,
    ],
    regions: GB,
  }),
  define({
    id: 'appointments',
    name: 'Appointments and prescriptions',
    group: G.government,
    description:
      'Appointment confirmations and reminders, and repeat prescription messages, from any sender.',
    rationale: 'Missing an appointment can cost money or a place on a waiting list.',
    criteria: {
      subject:
        '"appointment confirmation" OR "appointment reminder" OR "appointment confirmed" OR "your appointment" OR "prescription is ready" OR "repeat prescription"',
    },
    defaults: { labelName: 'Appointments' },
    flags: { star: true },
    risk: 'low',
  }),

  // Calendar and work
  define({
    id: 'calendar-invites',
    name: 'Calendar invitations',
    group: G.work,
    description:
      'Messages with a calendar file (.ics or .vcs) attached: invitations, updates and replies.',
    rationale:
      'Every standard calendar invitation carries an .ics file, whichever calendar app sent it. That is more reliable than subject words.',
    criteria: { query: 'filename:ics OR filename:vcs' },
    defaults: { labelName: 'Calendar' },
    flags: { star: true },
    risk: 'low',
  }),
  define({
    id: 'calendar-replies',
    name: 'Calendar replies',
    group: G.work,
    description: 'Accepted, declined and tentative replies to your invitations.',
    rationale:
      'Replies are status updates, not tasks. Calendar already shows who is coming, so these are the safest mail to file away.',
    criteria: {
      query: 'filename:ics subject:(accepted OR declined OR tentative OR "tentatively accepted")',
    },
    defaults: { labelName: 'Calendar/Replies' },
    flags: { skip: true, read: true, safety: false },
    risk: 'low',
    cautions: [
      'A reply can include a note from the guest. Turn on skip the inbox only if you rarely get notes.',
    ],
  }),
  define({
    id: 'shared-docs',
    name: 'Shared files and comments',
    group: G.work,
    description: 'Google Drive share notices and Google Docs comment notifications.',
    rationale:
      'Share and comment mail from Google Workspace comes from a few fixed addresses, so the match is precise.',
    criteria: {
      from: 'drive-shares-dm-noreply@google.com OR drive-shares-noreply@google.com OR comments-noreply@docs.google.com',
    },
    defaults: { labelName: 'Docs' },
    flags: { skip: true, read: true, safety: false },
    risk: 'low',
    cautions: [
      'Scammers share files from real Google accounts to send phishing links. Be careful with files from people you do not know.',
    ],
  }),
  define({
    id: 'auto-replies',
    name: 'Out of office replies',
    group: G.work,
    description: 'Automatic replies and out of office messages.',
    rationale: 'These are useful to know about but rarely need action.',
    criteria: {
      subject:
        '"out of office" OR "automatic reply" OR "auto reply" OR "auto-reply" OR autoreply OR "away from the office"',
    },
    defaults: { labelName: 'Auto-replies' },
    flags: { skip: true, read: true, safety: false },
    risk: 'low',
  }),

  // Developer
  define({
    id: 'github',
    name: 'GitHub notifications',
    group: G.developer,
    description: 'All notifications from GitHub.',
    rationale: 'GitHub sends every notification from one address, so the match is exact.',
    criteria: { from: 'notifications@github.com' },
    defaults: { labelName: 'Dev/GitHub' },
    flags: { skip: true, read: true, safety: false },
    risk: 'low',
    cautions: [
      'If you skip the inbox, add the "GitHub: needs you" template so that review requests still stand out.',
    ],
  }),
  define({
    id: 'github-needs-you',
    name: 'GitHub: needs you',
    group: G.developer,
    description: 'GitHub notifications where you are mentioned, assigned or asked for a review.',
    rationale:
      'GitHub adds a reason address in Cc (for example review_requested@noreply.github.com). Matching it separates work for you from general activity.',
    criteria: {
      query:
        'from:notifications@github.com (cc:mention@noreply.github.com OR cc:team_mention@noreply.github.com OR cc:review_requested@noreply.github.com OR cc:assign@noreply.github.com)',
    },
    defaults: { labelName: 'Dev/GitHub/Needs you' },
    flags: { star: true },
    risk: 'low',
  }),
  define({
    id: 'github-ci',
    name: 'GitHub Actions results',
    group: G.developer,
    description: 'Results of GitHub Actions workflow runs that you started.',
    rationale: 'GitHub marks these with the ci_activity reason address in Cc.',
    criteria: { query: 'from:notifications@github.com cc:ci_activity@noreply.github.com' },
    defaults: { labelName: 'Dev/CI' },
    flags: { skip: true, read: true, safety: false },
    risk: 'low',
  }),
  define({
    id: 'gitlab',
    name: 'GitLab notifications',
    group: G.developer,
    description:
      'Notifications from GitLab.com. Add your own GitLab server for self-managed instances.',
    rationale: 'GitLab.com sends notifications from its own domain.',
    criteria: { from: 'gitlab.com' },
    defaults: { labelName: 'Dev/GitLab' },
    flags: { skip: true, read: true, senders: true, safety: false },
    risk: 'low',
  }),
  define({
    id: 'ci-alerts',
    name: 'CI, hosting and error alerts',
    group: G.developer,
    description: 'CircleCI, Travis CI, Buildkite, Sentry, Vercel, Netlify, Render and UptimeRobot.',
    rationale:
      'Build and error alerts are noisy, but you need to find them fast when something breaks.',
    criteria: {
      from: 'circleci.com OR travis-ci.com OR buildkite.com OR sentry.io OR vercel.com OR netlify.com OR render.com OR uptimerobot.com',
    },
    defaults: { labelName: 'Dev/Alerts' },
    flags: { star: true, senders: true },
    risk: 'low',
    cautions: ['Do not skip the inbox for alerts about live services.'],
  }),
  define({
    id: 'domains',
    name: 'Domains and DNS',
    group: G.developer,
    description:
      'Domain registrars and DNS hosts: Namecheap, GoDaddy, Cloudflare, Porkbun, Gandi, 123 Reg, IONOS and Squarespace.',
    rationale:
      'A missed renewal notice can cost you a domain and every email address on it. A label makes renewals easy to check.',
    criteria: {
      from: 'namecheap.com OR godaddy.com OR cloudflare.com OR porkbun.com OR gandi.net OR 123-reg.co.uk OR ionos.co.uk OR ionos.com OR squarespace.com',
    },
    defaults: { labelName: 'Dev/Domains' },
    flags: { star: true, senders: true },
    risk: 'low',
    cautions: [
      'Fake "your domain is expiring" emails are common. Renew through the registrar website, not a link.',
    ],
  }),

  // Social and events
  define({
    id: 'social',
    name: 'Social networks',
    group: G.social,
    description:
      'Facebook, Instagram, LinkedIn, X, TikTok, Reddit, Pinterest, YouTube, Discord, Nextdoor, Strava, Threads and Bluesky.',
    rationale:
      'Social notifications are frequent and rarely urgent. A label lets you check them when it suits you.',
    criteria: {
      from: 'facebookmail.com OR instagram.com OR mail.instagram.com OR linkedin.com OR x.com OR twitter.com OR tiktok.com OR reddit.com OR redditmail.com OR pinterest.com OR youtube.com OR discord.com OR nextdoor.com OR nextdoor.co.uk OR strava.com OR threads.net OR bsky.app',
    },
    defaults: { labelName: 'Social' },
    flags: { skip: true, read: true },
    risk: 'low',
    cautions: [
      'Account security mail from these networks also comes from these senders. Keep "Keep codes, security alerts and bills in the inbox" on.',
    ],
  }),
  define({
    id: 'events',
    name: 'Events and tickets',
    group: G.social,
    description: 'Eventbrite, Ticketmaster, See Tickets, DICE, Skiddle, AXS and Meetup.',
    rationale: 'Tickets are needed on the day. A label finds them fast at the door.',
    criteria: {
      from: 'eventbrite.com OR eventbrite.co.uk OR ticketmaster.com OR ticketmaster.co.uk OR seetickets.com OR dice.fm OR skiddle.com OR axs.com OR meetup.com',
    },
    defaults: { labelName: 'Events' },
    flags: { star: true, senders: true },
    risk: 'low',
  }),

  // Jobs
  define({
    id: 'job-alerts',
    name: 'Job alerts',
    group: G.jobs,
    description:
      'Job alert mail from LinkedIn, Indeed, Glassdoor and ZipRecruiter, and any "job alert" subject.',
    rationale: 'Job alerts arrive daily. A label lets you review them in one go.',
    criteria: {
      query:
        'from:(jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com OR indeed.com OR indeedemail.com OR glassdoor.com OR ziprecruiter.com) OR subject:("job alert" OR "new jobs" OR "jobs for you")',
    },
    defaults: { labelName: 'Jobs' },
    flags: { skip: true, read: true, senders: true },
    risk: 'low',
    cautions: [
      'Recruiters who write to you directly are not caught by this filter, so their mail stays in the inbox.',
    ],
  }),
  define({
    id: 'uk-job-boards',
    name: 'UK job boards',
    group: G.jobs,
    description:
      'Reed, Totaljobs, CV-Library, CWJobs, Adzuna, Civil Service Jobs, NHS Jobs and jobs.ac.uk.',
    rationale: 'UK job boards send alerts and application updates from their own domains.',
    criteria: {
      from: 'reed.co.uk OR totaljobs.com OR cv-library.co.uk OR cwjobs.co.uk OR adzuna.co.uk OR civilservicejobs.service.gov.uk OR jobs.nhs.uk OR jobs.ac.uk',
    },
    defaults: { labelName: 'Jobs' },
    flags: { skip: true, read: true, senders: true },
    risk: 'low',
    regions: GB,
  }),
  define({
    id: 'job-applications',
    name: 'Job applications',
    group: G.jobs,
    description: 'Application received, application update and interview invitation messages.',
    rationale: 'Applications need replies. A starred label keeps them separate from daily alerts.',
    criteria: {
      subject:
        '"your application" OR "application received" OR "thank you for applying" OR "application update" OR "interview invitation"',
    },
    defaults: { labelName: 'Jobs/Applications' },
    flags: { star: true },
    risk: 'low',
    cautions: ['Fake job offers that ask for money or ID documents are common.'],
  }),

  // School and family
  define({
    id: 'school',
    name: 'School and nursery',
    group: G.school,
    description:
      'UK school domains (sch.uk) and school apps: ParentMail, ParentPay, Arbor, Schoolcomms, Groupcall, ClassDojo, Seesaw, Tapestry, Studybugs, Satchel One, Bromcom and Scopay.',
    rationale:
      'School mail comes from many systems. Grouping them means trips, payments and absences are in one place. Add your school domain if it does not end in sch.uk.',
    criteria: {
      from: 'sch.uk OR parentmail.co.uk OR parentpay.com OR arbor-education.com OR schoolcomms.com OR groupcall.com OR classdojo.com OR seesaw.me OR tapestry.info OR studybugs.com OR teamsatchel.com OR bromcom.com OR scopay.com',
    },
    defaults: { labelName: 'School' },
    flags: { star: true, senders: true },
    risk: 'low',
    cautions: ['School mail often needs action by a date. Do not skip the inbox.'],
    regions: GB,
  }),

  // Housekeeping
  define({
    id: 'no-reply',
    name: 'Automated no-reply mail',
    group: G.housekeeping,
    description: 'Mail from no-reply and do-not-reply addresses.',
    rationale:
      'A no-reply address means a machine sent the message. A label separates automated mail from people.',
    criteria: { from: 'noreply OR no-reply OR donotreply OR do-not-reply OR no_reply' },
    defaults: { labelName: 'Automated' },
    flags: { skip: true, read: true },
    risk: 'high',
    cautions: [
      'Sign-in codes, security alerts, receipts and bills all come from no-reply addresses. If you skip the inbox, keep "Keep codes, security alerts and bills in the inbox" turned on.',
    ],
  }),
  define({
    id: 'large-attachments',
    name: 'Large attachments',
    group: G.housekeeping,
    description: 'Messages over 10 MB with an attachment.',
    rationale:
      'Large mail uses up your Google storage. A label makes it easy to find and clear out later.',
    criteria: { hasAttachment: true, size: 10485760, sizeComparison: 'larger' },
    defaults: { labelName: 'Large attachments' },
    flags: {},
    risk: 'low',
  }),
  define({
    id: 'bounces',
    name: 'Bounces and delivery failures',
    group: G.housekeeping,
    description: 'Mail that could not be delivered: mailer-daemon and postmaster messages.',
    rationale:
      'A bounce means someone did not get your message. A label means you can check them, without them cluttering the inbox.',
    criteria: {
      query:
        'from:(mailer-daemon OR postmaster) OR subject:("delivery status notification" OR undeliverable OR "mail delivery failed" OR "delivery has failed" OR "returned mail")',
    },
    defaults: { labelName: 'Bounces' },
    flags: { star: true },
    risk: 'low',
    cautions: [
      'A sudden flood of bounces for mail you did not send can mean someone is spoofing your address.',
    ],
  }),
];

/* ---------------------------------------------------------------------------------------------
 * instantiate
 * ------------------------------------------------------------------------------------------- */

/**
 * Cleans a label name: trims, collapses repeated slashes and spaces, removes leading and
 * trailing slashes.
 * @param {string} name
 * @returns {string}
 */
function cleanLabelName(name) {
  return String(name || '')
    .split('/')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('/');
}

/**
 * Splits a user's "extra senders" text into safe sender tokens. Anything that is not a
 * plausible domain or address character is dropped, so a user cannot inject operators.
 * @param {string} text
 * @returns {string[]}
 */
function parseSenders(text) {
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const raw of String(text).split(/[\s,;]+/)) {
    const token = raw
      .replace(/^from:/i, '')
      .replace(/^@/, '')
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9][a-z0-9._%+'-]*(@[a-z0-9-]+(\.[a-z0-9-]+)*)?$/.test(token)) continue;
    if (token === 'or' || token === 'and' || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * The length of the criteria as one Gmail search string. Mirrors core/limits.js criteriaToSearch.
 * @param {FilterCriteria} c
 * @returns {number}
 */
function searchLength(c) {
  const parts = [];
  if (c.from) parts.push(`from:(${c.from})`);
  if (c.to) parts.push(`to:(${c.to})`);
  if (c.subject) parts.push(`subject:(${c.subject})`);
  if (c.query) parts.push(c.query);
  if (c.negatedQuery) parts.push(`-{${c.negatedQuery}}`);
  if (c.hasAttachment) parts.push('has:attachment');
  if (c.size && c.sizeComparison === 'larger') parts.push(`larger:${c.size}`);
  if (c.size && c.sizeComparison === 'smaller') parts.push(`smaller:${c.size}`);
  return parts.join(' ').length;
}

/**
 * Wraps a query in brackets when it holds a top-level OR, so it can be combined safely.
 * @param {string} q
 * @returns {string}
 */
function group(q) {
  return /\sOR\s/.test(q) ? `(${q})` : q;
}

/**
 * Resolves a label name against the account's labels. Returns the label ID to use and the
 * names that must be created first (parents before children).
 * @param {string} name
 * @param {Label[]} labels
 * @returns {{id: string, toCreate: string[]}}
 */
function resolveLabel(name, labels) {
  const userLabels = (labels || []).filter((l) => l && l.type !== 'system');
  const byLower = new Map(userLabels.map((l) => [l.name.toLowerCase(), l]));
  const parts = name.split('/');
  const toCreate = [];
  let path = '';
  let id = '';
  for (let i = 0; i < parts.length; i += 1) {
    const candidate = path ? `${path}/${parts[i]}` : parts[i];
    const existing = byLower.get(candidate.toLowerCase());
    if (existing) {
      // Keep the existing spelling so that children nest under the parent the user already has.
      path = existing.name;
      id = existing.id;
    } else {
      path = candidate;
      toCreate.push(path);
      id = NEW_LABEL_PREFIX + path;
    }
  }
  return { id, toCreate };
}

/**
 * Turns a template and the user's choices into a Gmail API filter.
 * @param {Template} template
 * @param {Record<string, any>} [options]  Values keyed by option key. Missing keys use the defaults.
 * @param {Label[]} [labels]               The account's labels, used to resolve the label by name.
 * @returns {{filter: Filter, labelsToCreate: string[]}}
 */
export function instantiate(template, options = {}, labels = []) {
  if (!template || !template.criteria) throw new Error('This template is not valid.');
  /** @type {Record<string, any>} */
  const values = {};
  for (const opt of template.options || []) {
    values[opt.key] =
      options && Object.prototype.hasOwnProperty.call(options, opt.key)
        ? options[opt.key]
        : opt.default;
  }
  const d = template.defaults || {};
  const offered = new Set((template.options || []).map((o) => o.key));
  const pick = (key, fallback) => (offered.has(key) ? values[key] : fallback);

  /** @type {FilterCriteria} */
  const criteria = { ...template.criteria };

  const listId = String(pick('listId', '') || '')
    .trim()
    .toLowerCase();
  if (listId) {
    if (!/^[a-z0-9][a-z0-9._@-]*$/.test(listId)) {
      throw new Error('The list ID can only use letters, numbers, dots, dashes and @.');
    }
    criteria.query = `list:${listId}`;
  }

  const extra = parseSenders(pick('extraSenders', ''));
  if (extra.length) {
    const joined = extra.join(' OR ');
    if (criteria.from) {
      criteria.from = `${criteria.from} OR ${joined}`;
    } else if (criteria.query) {
      criteria.query = `${group(criteria.query)} OR from:(${joined})`;
    } else {
      criteria.from = joined;
    }
  }

  const archive = Boolean(pick('skipInbox', d.archive));
  const markRead = Boolean(pick('markRead', d.markRead));
  const star = Boolean(pick('star', d.star));
  const keepSafety = Boolean(pick('keepSafetyMail', false));
  if ((archive || markRead) && keepSafety) {
    criteria.negatedQuery = criteria.negatedQuery
      ? `${group(criteria.negatedQuery)} OR ${SAFETY_TERMS}`
      : SAFETY_TERMS;
  }

  if (searchLength(criteria) > CRITERIA_CAP) {
    throw new Error(
      `This filter would be too long for Gmail (over ${CRITERIA_CAP} characters). Remove some extra senders.`,
    );
  }

  const labelName = cleanLabelName(pick('labelName', d.labelName)) || cleanLabelName(d.labelName);
  if (!labelName) throw new Error('Please give the label a name.');
  if (RESERVED_LABEL_NAMES.has(labelName.toLowerCase())) {
    throw new Error(`"${labelName}" is a name Gmail keeps for itself. Please choose another name.`);
  }
  const { id: labelId, toCreate } = resolveLabel(labelName, labels);

  const add = [labelId];
  const remove = [];
  if (star) add.push('STARRED');
  if (d.important === 'always') add.push('IMPORTANT');
  if (d.important === 'never') remove.push('IMPORTANT');
  if (d.category) add.push(d.category);
  if (archive) remove.push('INBOX');
  if (markRead) remove.push('UNREAD');
  if (d.neverSpam) remove.push('SPAM');

  /** @type {import('../types.js').FilterAction} */
  const action = { addLabelIds: add };
  if (remove.length) action.removeLabelIds = remove;

  return { filter: { criteria: compact(criteria), action }, labelsToCreate: toCreate };
}

/**
 * Removes empty criteria fields so the result matches what the Gmail API returns.
 * @param {FilterCriteria} c
 * @returns {FilterCriteria}
 */
function compact(c) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, value] of Object.entries(c)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    out[key] = value;
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------
 * matchExisting
 * ------------------------------------------------------------------------------------------- */

/**
 * Normalises a from, to or subject value: lower case, outer brackets removed, alternatives sorted.
 * @param {string} value
 * @returns {string}
 */
function normaliseList(value) {
  if (!value) return '';
  let v = String(value).trim().toLowerCase();
  while (v.startsWith('(') && v.endsWith(')') && balanced(v.slice(1, -1)))
    v = v.slice(1, -1).trim();
  if (v.startsWith('{') && v.endsWith('}') && balanced(v.slice(1, -1))) v = v.slice(1, -1).trim();
  const parts = v
    .split(/\s+or\s+|\s*\|\s*/)
    .map((p) => p.trim().replace(/^@/, ''))
    .filter(Boolean);
  return [...new Set(parts)].sort().join(' or ');
}

/**
 * @param {string} s
 * @returns {boolean} True when brackets in s are balanced (so outer brackets can be removed).
 */
function balanced(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/**
 * @param {string} q
 * @returns {string}
 */
function normaliseQuery(q) {
  if (!q) return '';
  let v = String(q).replace(/\s+/g, ' ').trim();
  while (v.startsWith('(') && v.endsWith(')') && balanced(v.slice(1, -1)))
    v = v.slice(1, -1).trim();
  // OR is case-sensitive in Gmail; everything else is not.
  return v
    .split(' ')
    .map((w) => (w === 'OR' ? 'OR' : w.toLowerCase()))
    .join(' ');
}

/**
 * @param {FilterCriteria} c
 * @returns {string}
 */
function criteriaKey(c) {
  const x = c || {};
  return JSON.stringify([
    normaliseList(x.from),
    normaliseList(x.to),
    normaliseList(x.subject),
    normaliseQuery(x.query),
    normaliseQuery(x.negatedQuery),
    Boolean(x.hasAttachment),
    Boolean(x.excludeChats),
    x.size && x.sizeComparison && x.sizeComparison !== 'unspecified' ? x.size : 0,
    x.size && x.sizeComparison !== 'unspecified' ? x.sizeComparison || '' : '',
  ]);
}

/**
 * Finds an existing filter that already does this template's job: the same criteria (ignoring
 * case, spacing, bracket style and the order of alternatives), with or without the safety
 * exclusion that instantiate adds, and an action that adds at least one user label.
 * @param {Template} template
 * @param {Filter[]} filters
 * @returns {Filter|null}
 */
export function matchExisting(template, filters) {
  if (!template || !Array.isArray(filters)) return null;
  const plain = criteriaKey(template.criteria);
  const withSafety = criteriaKey({
    ...template.criteria,
    negatedQuery: template.criteria.negatedQuery
      ? `${group(template.criteria.negatedQuery)} OR ${SAFETY_TERMS}`
      : SAFETY_TERMS,
  });
  for (const f of filters) {
    if (!f || !f.criteria) continue;
    const key = criteriaKey(f.criteria);
    if (key !== plain && key !== withSafety) continue;
    const adds = (f.action && f.action.addLabelIds) || [];
    if (adds.some((id) => !SYSTEM_LABEL_ID.test(id))) return f;
  }
  return null;
}
