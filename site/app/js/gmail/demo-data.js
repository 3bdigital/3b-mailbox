// @ts-check
// Fake, UK flavoured account data for demo mode and tests. Deterministic: same output every call.
// Company domains are real so the demo looks real. Personal addresses use example.com/org/net only.

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').FilterAction} FilterAction */
/** @typedef {import('../types.js').FilterCriteria} FilterCriteria */
/** @typedef {import('../types.js').Label} Label */
/** @typedef {import('../types.js').ForwardingAddress} ForwardingAddress */

/**
 * A message in the mock mailbox. Richer than MessagePreview so the mock search can match on it.
 * @typedef {object} DemoMessage
 * @property {string} id
 * @property {string} threadId
 * @property {string} from        "Name <address>"
 * @property {string} to
 * @property {string} subject
 * @property {string} date        ISO 8601.
 * @property {string} snippet
 * @property {string} body
 * @property {string[]} labelIds
 * @property {boolean} hasAttachment
 * @property {string} [list]      List-Id value, for list: searches.
 * @property {number} size        Bytes.
 */

/**
 * @typedef {object} DemoData
 * @property {Filter[]} filters
 * @property {Label[]} labels
 * @property {ForwardingAddress[]} forwardingAddresses
 * @property {DemoMessage[]} messages
 */

/** The demo user's own address. */
export const DEMO_USER = 'sam.jones@example.com';

/** "Now" for the demo mailbox. Messages are dated before this. */
export const DEMO_NOW = '2026-10-01T09:00:00.000Z';

/** The label ID that some filters still use, but that no longer exists. */
export const DELETED_LABEL_ID = 'Label_99';

/**
 * Small seeded PRNG (mulberry32). Same seed, same sequence.
 * @param {number} seed
 * @returns {() => number} Numbers in [0, 1).
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYSTEM_LABEL_IDS = [
  'INBOX',
  'SENT',
  'DRAFT',
  'SPAM',
  'TRASH',
  'UNREAD',
  'STARRED',
  'IMPORTANT',
  'CHAT',
  'CATEGORY_PERSONAL',
  'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
];

const USER_LABEL_NAMES = [
  'Finance',
  'Finance/Receipts',
  'Finance/Bank',
  'Finance/Bills',
  'Finance/Tax',
  'Shopping',
  'Shopping/Deliveries',
  'Travel',
  'Travel/Trains',
  'Work',
  'Work/GitHub',
  'Work/Meetings',
  'Newsletters',
  'Family',
  'School',
  'Health',
  'Home',
  'Home/Energy',
  'Home/Council',
  'Social',
  'Subscriptions',
  'Kids Clubs',
  'Car',
  'Charity',
  'Archive/Old',
];

/** Label IDs by name, for readable filter definitions below. */
const L = Object.fromEntries(USER_LABEL_NAMES.map((name, i) => [name, `Label_${i + 1}`]));

const PARTNER = 'partner@example.com';
const ACCOUNTANT = 'accounts@example.org';
const BOOKKEEPER = 'bookkeeper@example.net';

/**
 * Builds a "from:" list that lands just under Google's hard length limit.
 * The full search string is `from:(...)`, so we count those 7 characters too.
 */
function longFromList() {
  const shops = [
    'brightbox',
    'cornerhouse',
    'kettleandco',
    'thimble',
    'oakandash',
    'pebblemill',
    'harbourline',
    'fernleaf',
    'copperpot',
    'willowtree',
    'saltmarsh',
    'bramblewood',
    'quayside',
    'larkrise',
    'hollybush',
    'meadowsweet',
    'tinderbox',
    'bluebell',
    'foxglove',
    'ironbridge',
    'stonegate',
    'redkite',
    'millpond',
    'heathergate',
    'kingfisher',
    'lantern',
    'riverside',
    'thistle',
    'woodsmoke',
    'yarrow',
    'cobblestone',
    'driftwood',
    'elderflower',
    'goldcrest',
    'hawthorn',
    'juniper',
    'larch',
    'moorland',
    'nettlebed',
    'orchard',
    'primrose',
    'rowan',
    'sorrel',
    'teasel',
    'umber',
    'vervain',
    'wren',
  ];
  const target = 1445 - 'from:()'.length;
  /** @type {string[]} */
  const parts = [];
  for (const shop of shops) {
    const next = `offers@${shop}.example.co.uk`;
    const joined = [...parts, next].join(' OR ');
    if (joined.length > target) break;
    parts.push(next);
  }
  return parts.join(' OR ');
}

/**
 * @param {number} n
 * @param {FilterCriteria} criteria
 * @param {FilterAction} action
 * @returns {Filter}
 */
function f(n, criteria, action) {
  return { id: `ANe1Bmj${String(n).padStart(4, '0')}`, criteria, action };
}

/** @returns {Filter[]} */
function buildFilters() {
  const arch = 'INBOX';
  const read = 'UNREAD';
  return [
    // Exact duplicates (same criteria, same action).
    f(
      1,
      { from: 'amazon.co.uk' },
      { addLabelIds: [L['Finance/Receipts']], removeLabelIds: [arch] },
    ),
    f(
      2,
      { from: 'amazon.co.uk' },
      { addLabelIds: [L['Finance/Receipts']], removeLabelIds: [arch] },
    ),
    // Same criteria, different action.
    f(3, { from: 'github.com' }, { addLabelIds: [L['Work/GitHub']] }),
    f(4, { from: 'github.com' }, { removeLabelIds: [read] }),
    // Conflict: one trashes, one labels the same sender.
    f(5, { from: 'marketing@boots.com' }, { addLabelIds: ['TRASH'] }),
    f(6, { from: 'boots.com' }, { addLabelIds: [L.Shopping] }),
    // Points to a label that was deleted.
    f(
      7,
      { from: 'noreply@oldclub.example.org' },
      { addLabelIds: [DELETED_LABEL_ID], removeLabelIds: [arch] },
    ),
    // Merge candidates: same action, different senders.
    f(
      8,
      { from: 'newsletters@theguardian.com' },
      { addLabelIds: [L.Newsletters], removeLabelIds: [arch, read] },
    ),
    f(
      9,
      { from: 'hello@morningbrew.com' },
      { addLabelIds: [L.Newsletters], removeLabelIds: [arch, read] },
    ),
    f(
      10,
      { from: 'noreply@medium.com' },
      { addLabelIds: [L.Newsletters], removeLabelIds: [arch, read] },
    ),
    f(
      11,
      { from: 'weekly@substack.com' },
      { addLabelIds: [L.Newsletters], removeLabelIds: [arch, read] },
    ),
    // Near the length limit.
    f(12, { from: longFromList() }, { addLabelIds: [L.Subscriptions], removeLabelIds: [arch] }),
    // Unsafe operator: is: never matches incoming mail in a filter.
    f(13, { query: 'is:unread from:alerts@monzo.com' }, { addLabelIds: ['STARRED', 'IMPORTANT'] }),

    // Forwarding filters (10). The last one forwards to the pending address.
    f(14, { from: 'hmrc.gov.uk' }, { addLabelIds: [L['Finance/Tax']], forward: ACCOUNTANT }),
    f(
      15,
      { from: 'octopus.energy', subject: 'bill' },
      { addLabelIds: [L['Home/Energy']], forward: PARTNER },
    ),
    f(
      16,
      { from: 'office@stmarys-primary.example.org' },
      { addLabelIds: [L.School], forward: PARTNER },
    ),
    f(
      17,
      { from: 'nhs.net', subject: 'appointment' },
      { addLabelIds: [L.Health], forward: PARTNER },
    ),
    f(
      18,
      { from: 'bristol.gov.uk', subject: '"council tax"' },
      { addLabelIds: [L['Home/Council']], forward: PARTNER },
    ),
    f(
      19,
      { from: 'invoices@xero.com' },
      { addLabelIds: [L['Finance/Bills']], forward: ACCOUNTANT },
    ),
    f(
      20,
      { from: 'stripe.com', subject: 'receipt' },
      { addLabelIds: [L['Finance/Receipts']], forward: ACCOUNTANT },
    ),
    f(21, { from: 'companieshouse.gov.uk' }, { addLabelIds: [L.Finance], forward: ACCOUNTANT }),
    f(
      22,
      { from: 'leader@cubs-scouts.example.org' },
      { addLabelIds: [L['Kids Clubs']], forward: PARTNER },
    ),
    f(
      23,
      { from: 'payroll@acme-ltd.example.com' },
      { addLabelIds: [L['Finance/Bank']], forward: BOOKKEEPER },
    ),

    // Everyday filters, each with its own action.
    f(24, { from: 'royalmail.com' }, { addLabelIds: [L['Shopping/Deliveries']] }),
    f(
      25,
      { from: 'evri.com' },
      { addLabelIds: [L['Shopping/Deliveries']], removeLabelIds: [arch] },
    ),
    f(26, { from: 'dpd.co.uk' }, { addLabelIds: [L['Shopping/Deliveries'], 'IMPORTANT'] }),
    f(27, { from: 'monzo.com' }, { addLabelIds: [L['Finance/Bank']] }),
    f(
      28,
      { from: 'starlingbank.com' },
      { addLabelIds: [L['Finance/Bank']], removeLabelIds: [arch] },
    ),
    f(
      29,
      { from: 'nationwide.co.uk', subject: 'statement' },
      { addLabelIds: [L['Finance/Bank'], 'STARRED'] },
    ),
    f(30, { from: 'thameswater.co.uk' }, { addLabelIds: [L['Finance/Bills']] }),
    f(
      31,
      { from: 'bt.com', subject: 'bill' },
      { addLabelIds: [L['Finance/Bills']], removeLabelIds: [arch] },
    ),
    f(32, { from: 'ee.co.uk' }, { addLabelIds: [L['Finance/Bills']], removeLabelIds: [read] }),
    f(33, { from: 'trainline.com' }, { addLabelIds: [L['Travel/Trains']] }),
    f(34, { from: 'lner.co.uk' }, { addLabelIds: [L['Travel/Trains']], removeLabelIds: [arch] }),
    f(35, { from: 'easyjet.com' }, { addLabelIds: [L.Travel] }),
    f(36, { from: 'booking.com' }, { addLabelIds: [L.Travel], removeLabelIds: [arch] }),
    f(37, { from: 'airbnb.co.uk' }, { addLabelIds: [L.Travel, 'STARRED'] }),
    f(
      38,
      { from: 'notifications@github.com', subject: '"[acme/api]"' },
      { addLabelIds: [L['Work/GitHub']], removeLabelIds: [arch] },
    ),
    f(39, { from: 'calendar-notification@google.com' }, { addLabelIds: [L['Work/Meetings']] }),
    f(40, { query: 'filename:ics' }, { addLabelIds: [L['Work/Meetings'], 'IMPORTANT'] }),
    f(41, { from: 'acme-ltd.example.com' }, { addLabelIds: [L.Work] }),
    f(42, { from: 'mum@example.com OR dad@example.com' }, { addLabelIds: [L.Family, 'STARRED'] }),
    f(43, { from: 'grandma@example.com' }, { addLabelIds: [L.Family], removeLabelIds: ['SPAM'] }),
    f(44, { from: 'facebookmail.com' }, { addLabelIds: [L.Social], removeLabelIds: [arch] }),
    f(45, { from: 'linkedin.com' }, { addLabelIds: [L.Social], removeLabelIds: [arch, read] }),
    f(46, { from: 'instagram.com' }, { addLabelIds: ['CATEGORY_SOCIAL'] }),
    f(47, { from: 'netflix.com' }, { addLabelIds: [L.Subscriptions] }),
    f(48, { from: 'spotify.com' }, { addLabelIds: [L.Subscriptions], removeLabelIds: [read] }),
    f(
      49,
      { from: 'disneyplus.com' },
      { addLabelIds: [L.Subscriptions], removeLabelIds: [arch, read] },
    ),
    f(50, { from: 'dvla.gov.uk' }, { addLabelIds: [L.Car, 'IMPORTANT'] }),
    f(51, { from: 'admiral.com', subject: 'renewal' }, { addLabelIds: [L.Car, 'STARRED'] }),
    f(52, { from: 'justgiving.com' }, { addLabelIds: [L.Charity] }),
    f(53, { from: 'oxfam.org.uk' }, { addLabelIds: [L.Charity], removeLabelIds: [arch] }),
    f(54, { query: '"unsubscribe"' }, { addLabelIds: [L.Newsletters] }),
    f(55, { from: 'ocado.com' }, { addLabelIds: [L['Finance/Receipts']] }),
    f(
      56,
      { from: 'tesco.com', subject: 'receipt' },
      { addLabelIds: [L['Finance/Receipts']], removeLabelIds: [read] },
    ),
    f(57, { from: 'ebay.co.uk' }, { addLabelIds: [L.Shopping], removeLabelIds: [arch] }),
    f(58, { from: 'johnlewis.co.uk' }, { addLabelIds: [L.Shopping, 'CATEGORY_PROMOTIONS'] }),
    f(59, { from: 'vinted.co.uk' }, { addLabelIds: [L.Shopping], removeLabelIds: [read] }),
    f(
      60,
      { from: 'hello@octopus.energy' },
      { addLabelIds: [L['Home/Energy']], removeLabelIds: [arch] },
    ),
    f(61, { from: 'zoopla.co.uk OR rightmove.co.uk' }, { addLabelIds: [L.Home] }),
    f(
      62,
      { hasAttachment: true, size: 10485760, sizeComparison: 'larger' },
      { addLabelIds: [L['Archive/Old']] },
    ),
    f(
      63,
      { from: 'ticketmaster.co.uk', negatedQuery: 'receipt OR "your tickets"' },
      { addLabelIds: ['CATEGORY_PROMOTIONS'], removeLabelIds: [arch] },
    ),
    f(64, { to: 'sam.jones+shopping@example.com' }, { addLabelIds: [L.Shopping, 'STARRED'] }),
    f(
      65,
      { from: 'no-reply@accounts.google.com', subject: '"security alert"' },
      { addLabelIds: ['IMPORTANT'], removeLabelIds: ['SPAM'] },
    ),
    f(
      66,
      { from: 'deliveroo.co.uk', excludeChats: true },
      { addLabelIds: [L['Finance/Receipts'], 'CATEGORY_UPDATES'] },
    ),
  ];
}

/** @returns {Label[]} */
function buildLabels() {
  /** @type {Label[]} */
  const system = SYSTEM_LABEL_IDS.map((id) => ({
    id,
    name: id,
    type: 'system',
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  }));
  const colours = [
    { textColor: '#ffffff', backgroundColor: '#16a765' },
    { textColor: '#ffffff', backgroundColor: '#4986e7' },
    { textColor: '#000000', backgroundColor: '#fad165' },
    { textColor: '#ffffff', backgroundColor: '#a479e2' },
    { textColor: '#ffffff', backgroundColor: '#f691b2' },
  ];
  /** @type {Label[]} */
  const user = USER_LABEL_NAMES.map((name, i) => {
    /** @type {Label} */
    const label = {
      id: `Label_${i + 1}`,
      name,
      type: 'user',
      labelListVisibility: name === 'Archive/Old' ? 'labelHide' : 'labelShow',
      messageListVisibility: 'show',
    };
    if (i % 3 === 0) label.color = { ...colours[i % colours.length] };
    return label;
  });
  return [...system, ...user];
}

/** @returns {ForwardingAddress[]} */
function buildForwarding() {
  return [
    { forwardingEmail: PARTNER, verificationStatus: 'accepted' },
    { forwardingEmail: ACCOUNTANT, verificationStatus: 'accepted' },
    { forwardingEmail: BOOKKEEPER, verificationStatus: 'pending' },
  ];
}

/**
 * @typedef {object} Sender
 * @property {string} name
 * @property {string} email
 * @property {string[]} subjects
 * @property {string} snippet
 * @property {string} [category]
 * @property {string} [list]
 * @property {boolean} [newsletter]   Adds an "unsubscribe" footer.
 * @property {number} [attachment]   Chance of an attachment, 0 to 1.
 * @property {number} [weight]       How often this sender appears. Default 1.
 */

/** @type {Sender[]} */
const SENDERS = [
  {
    name: 'Amazon.co.uk',
    email: 'auto-confirm@amazon.co.uk',
    subjects: [
      'Your Amazon.co.uk order of "USB-C cable" has been dispatched',
      'Your Amazon.co.uk order confirmation',
      'Your refund for "Kettle descaler" is complete',
      'Your invoice is available',
    ],
    snippet: 'Thanks for your order. You can track your parcel in Your Orders.',
    category: 'CATEGORY_UPDATES',
    weight: 4,
  },
  {
    name: 'Royal Mail',
    email: 'no-reply@royalmail.com',
    subjects: [
      'Your parcel is on its way',
      'We tried to deliver your item',
      'Your item was delivered',
    ],
    snippet: 'Track your item with the reference number in this email.',
    category: 'CATEGORY_UPDATES',
    weight: 3,
  },
  {
    name: 'Evri',
    email: 'noreply@evri.com',
    subjects: ['Your parcel will arrive today', 'Your Evri parcel has been delivered'],
    snippet: 'Your courier will deliver between 10:00 and 14:00.',
    category: 'CATEGORY_UPDATES',
    weight: 2,
  },
  {
    name: 'HMRC',
    email: 'noreply@confirmation.tax.service.gov.uk',
    subjects: ['Your tax return has been received', 'You have a new message from HMRC'],
    snippet: 'Sign in to your personal tax account to read your message.',
    weight: 2,
  },
  {
    name: 'HM Revenue & Customs',
    email: 'noreply@hmrc.gov.uk',
    subjects: ['Self Assessment: payment reminder', 'Your Simple Assessment letter'],
    snippet: 'This is a reminder that a payment is due on 31 January.',
    attachment: 0.3,
  },
  {
    name: 'Octopus Energy',
    email: 'hello@octopus.energy',
    subjects: ['Your latest bill', 'Your meter reading is due', 'Your Octopus Energy statement'],
    snippet: 'Your bill for September is ready. Your balance is in credit.',
    attachment: 0.5,
    weight: 3,
  },
  {
    name: 'Monzo',
    email: 'alerts@monzo.com',
    subjects: ['Your monthly statement is ready', 'You received a payment', 'Pot target reached'],
    snippet: 'Your statement for last month is ready in the app.',
    weight: 3,
  },
  {
    name: 'Starling Bank',
    email: 'help@starlingbank.com',
    subjects: ['Your statement is ready', 'New device signed in'],
    snippet: 'Your account statement is now available.',
  },
  {
    name: 'Nationwide',
    email: 'online@nationwide.co.uk',
    subjects: ['Your annual statement', 'Your savings rate is changing'],
    snippet: 'Your statement is ready to view in the Banking app.',
    attachment: 0.4,
  },
  {
    name: 'GitHub',
    email: 'notifications@github.com',
    subjects: [
      '[acme/api] Fix flaky test in payments module (#412)',
      '[acme/api] Release v2.3.0',
      '[acme/web] Dependabot: bump vite from 7.1.2 to 7.1.3',
      '[acme/web] New issue: Dark mode contrast on settings page',
    ],
    snippet: 'You are receiving this because you were mentioned.',
    list: 'acme/api <api.acme.github.com>',
    weight: 6,
  },
  {
    name: 'Google Calendar',
    email: 'calendar-notification@google.com',
    subjects: [
      'Invitation: Sprint planning',
      'Updated invitation: 1:1 with Priya',
      'Reminder: Dentist',
    ],
    snippet: 'You have been invited to the following event.',
    attachment: 0.8,
    weight: 2,
  },
  {
    name: 'The Guardian',
    email: 'newsletters@theguardian.com',
    subjects: ["First Edition: Today's top stories", 'The Long Read', 'Down to Earth'],
    snippet: 'The stories you need to know about today.',
    list: 'first-edition <first-edition.theguardian.com>',
    newsletter: true,
    category: 'CATEGORY_PROMOTIONS',
    weight: 5,
  },
  {
    name: 'Morning Brew',
    email: 'hello@morningbrew.com',
    subjects: ['Markets are up, coffee is down', 'Your Thursday Brew'],
    snippet: 'Good morning. Here is what you need to know.',
    list: 'morningbrew <list.morningbrew.com>',
    newsletter: true,
    category: 'CATEGORY_PROMOTIONS',
    weight: 3,
  },
  {
    name: 'Medium Daily Digest',
    email: 'noreply@medium.com',
    subjects: ['Stories for you', 'Top picks from your reading list'],
    snippet: 'Based on your reading history.',
    list: 'digest <digest.medium.com>',
    newsletter: true,
    category: 'CATEGORY_PROMOTIONS',
    weight: 3,
  },
  {
    name: 'Weekly Notes',
    email: 'weekly@substack.com',
    subjects: ['Issue 88: Small tools, big wins', 'Issue 89: Quiet software'],
    snippet: 'This week: three ideas worth stealing.',
    list: 'weekly-notes <weekly.substack.com>',
    newsletter: true,
    weight: 2,
  },
  {
    name: 'Boots',
    email: 'marketing@boots.com',
    subjects: ['3 for 2 on gifts', 'Your Advantage Card points', 'Up to half price on skincare'],
    snippet: 'Offers picked for you this week.',
    newsletter: true,
    category: 'CATEGORY_PROMOTIONS',
    weight: 3,
  },
  {
    name: 'Boots Orders',
    email: 'orders@boots.com',
    subjects: ['Your Boots order is ready to collect'],
    snippet: 'Your order is ready at your chosen store.',
    category: 'CATEGORY_UPDATES',
  },
  {
    name: 'Trainline',
    email: 'noreply@trainline.com',
    subjects: ['Your e-ticket: London Kings Cross to York', 'Delay Repay: claim now'],
    snippet: 'Your tickets are attached. Show them on your phone.',
    attachment: 0.6,
    weight: 2,
  },
  {
    name: 'LNER',
    email: 'tickets@lner.co.uk',
    subjects: ['Your booking confirmation', 'Your journey tomorrow'],
    snippet: 'Thank you for booking with LNER.',
  },
  {
    name: 'easyJet',
    email: 'noreply@easyjet.com',
    subjects: ['Your booking: Bristol to Lisbon', 'Check in now for your flight'],
    snippet: 'Your flight details and boarding pass.',
    attachment: 0.3,
  },
  {
    name: 'Netflix',
    email: 'info@netflix.com',
    subjects: ['New on Netflix this week', 'Your payment was received'],
    snippet: 'Here is what is new this week.',
    newsletter: true,
    category: 'CATEGORY_PROMOTIONS',
    weight: 2,
  },
  {
    name: 'Spotify',
    email: 'no-reply@spotify.com',
    subjects: ['Your receipt from Spotify', 'Your Release Radar is ready'],
    snippet: 'Thanks for being Premium.',
    newsletter: true,
    weight: 2,
  },
  {
    name: 'Ocado',
    email: 'customerservices@ocado.com',
    subjects: ['Your Ocado receipt', 'Your delivery slot is confirmed'],
    snippet: 'Your order total and substitutions are below.',
    attachment: 0.5,
    weight: 2,
  },
  {
    name: 'Tesco',
    email: 'receipts@tesco.com',
    subjects: ['Your Tesco receipt', 'Your Clubcard vouchers are here'],
    snippet: 'Thank you for shopping with Tesco.',
    weight: 2,
  },
  {
    name: 'Bristol City Council',
    email: 'council.tax@bristol.gov.uk',
    subjects: ['Your council tax bill', 'Garden waste collection reminder'],
    snippet: 'Your council tax bill for this year is attached.',
    attachment: 0.7,
  },
  {
    name: 'NHS App',
    email: 'noreply@nhs.net',
    subjects: ['Your appointment is confirmed', 'Your prescription is ready'],
    snippet: 'Sign in to the NHS App for details.',
  },
  {
    name: "St Mary's Primary School",
    email: 'office@stmarys-primary.example.org',
    subjects: ['Newsletter: Autumn term', 'Trip consent form', 'Parents evening booking'],
    snippet: 'Dear parents and carers,',
    attachment: 0.6,
    weight: 2,
  },
  {
    name: 'Mum',
    email: 'mum@example.com',
    subjects: ['Sunday lunch?', 'Photos from the weekend', 'Re: Christmas plans'],
    snippet: 'Hello love, are you free on Sunday?',
    attachment: 0.4,
    category: 'CATEGORY_PERSONAL',
    weight: 2,
  },
  {
    name: 'Priya Shah',
    email: 'priya.shah@acme-ltd.example.com',
    subjects: ['Q4 roadmap draft', 'Re: Hiring plan', 'Notes from today'],
    snippet: 'Hi Sam, I have put my comments in the doc.',
    attachment: 0.3,
    category: 'CATEGORY_PERSONAL',
    weight: 3,
  },
  {
    name: 'LinkedIn',
    email: 'messages-noreply@linkedin.com',
    subjects: ['You appeared in 12 searches this week', 'New message from a recruiter'],
    snippet: 'See who is looking at your profile.',
    newsletter: true,
    category: 'CATEGORY_SOCIAL',
    weight: 2,
  },
  {
    name: 'Facebook',
    email: 'notification@facebookmail.com',
    subjects: ['You have 3 new notifications', 'Memories from 5 years ago'],
    snippet: 'See what your friends have shared.',
    newsletter: true,
    category: 'CATEGORY_SOCIAL',
  },
  {
    name: 'DVLA',
    email: 'noreply@dvla.gov.uk',
    subjects: ['Your vehicle tax is due', 'Your V5C has been updated'],
    snippet: 'Your vehicle tax runs out at the end of the month.',
  },
  {
    name: 'eBay',
    email: 'ebay@ebay.co.uk',
    subjects: ['Your item has sold', 'You have been outbid'],
    snippet: 'Good news. Your item sold.',
    newsletter: true,
    category: 'CATEGORY_UPDATES',
  },
  {
    name: 'John Lewis',
    email: 'news@johnlewis.co.uk',
    subjects: ['The Christmas shop is open', 'New in: home'],
    snippet: 'Discover our new collection.',
    newsletter: true,
    category: 'CATEGORY_PROMOTIONS',
  },
  {
    name: 'Xero',
    email: 'invoices@xero.com',
    subjects: ['Invoice INV-0042 from Acme Ltd', 'Payment received: INV-0039'],
    snippet: 'Please find your invoice attached.',
    attachment: 0.9,
  },
  {
    name: 'Google',
    email: 'no-reply@accounts.google.com',
    subjects: ['Security alert', 'Security alert: new sign-in on Windows'],
    snippet: 'A new sign-in to your Google Account was detected.',
  },
];

/**
 * @param {() => number} rand
 * @param {Sender[]} senders
 */
function pickSender(rand, senders) {
  const total = senders.reduce((sum, s) => sum + (s.weight ?? 1), 0);
  let r = rand() * total;
  for (const s of senders) {
    r -= s.weight ?? 1;
    if (r < 0) return s;
  }
  return senders[senders.length - 1];
}

/**
 * @param {number} i
 * @returns {string} 16 hex characters, like a Gmail message ID.
 */
function messageId(i) {
  const hi = (0x199a0000 + i * 977).toString(16).padStart(8, '0');
  const lo = Math.imul(i + 1, 2654435761) >>> 0;
  return `${hi}${lo.toString(16).padStart(8, '0')}`;
}

/** @returns {DemoMessage[]} */
function buildMessages() {
  const rand = seededRandom(20261001);
  let time = Date.parse(DEMO_NOW);
  /** @type {DemoMessage[]} */
  const out = [];
  for (let i = 0; i < 200; i++) {
    time -= Math.floor(rand() * 14 * 3600 * 1000) + 15 * 60 * 1000;
    const s = pickSender(rand, SENDERS);
    const subject = s.subjects[Math.floor(rand() * s.subjects.length)];
    const footer = s.newsletter
      ? '\n\nYou are receiving this email because you signed up. Unsubscribe or manage your preferences.'
      : '';
    const body = `${s.snippet}\n\n${subject}.${footer}`;
    const hasAttachment = rand() < (s.attachment ?? 0);
    /** @type {string[]} */
    const labelIds = ['INBOX'];
    if (rand() < 0.35) labelIds.push('UNREAD');
    if (rand() < 0.05) labelIds.push('STARRED');
    labelIds.push(s.category ?? 'CATEGORY_UPDATES');
    const id = messageId(i);
    /** @type {DemoMessage} */
    const message = {
      id,
      threadId: id,
      from: `${s.name} <${s.email}>`,
      to: DEMO_USER,
      subject,
      date: new Date(time).toISOString(),
      snippet: s.snippet,
      body,
      labelIds,
      hasAttachment,
      size: 4000 + Math.floor(rand() * 60000) + (hasAttachment ? 250000 : 0),
    };
    if (s.list) message.list = s.list;
    out.push(message);
  }
  return out;
}

/**
 * A fresh copy of the demo account. Same data on every call.
 * @returns {DemoData}
 */
export function demoData() {
  return {
    filters: buildFilters(),
    labels: buildLabels(),
    forwardingAddresses: buildForwarding(),
    messages: buildMessages(),
  };
}
