import { describe, expect, it } from 'vitest';
import { DELETED_LABEL_ID, demoData, seededRandom } from '../../../site/app/js/gmail/demo-data.js';
import {
  demoData as reExported,
  createMockGmail,
  mockCriteriaString,
} from '../../../site/app/js/gmail/mock.js';

const data = demoData();
const userLabels = data.labels.filter((l) => l.type === 'user');
const labelIds = new Set(data.labels.map((l) => l.id));

/** Same normalisation core/ will use: order-independent action and criteria. */
const actionKey = (f) =>
  JSON.stringify([
    [...(f.action.addLabelIds ?? [])].sort(),
    [...(f.action.removeLabelIds ?? [])].sort(),
    f.action.forward ?? null,
  ]);
const criteriaKey = (f) => JSON.stringify(Object.entries(f.criteria).sort());

function groupBy(list, key) {
  const map = new Map();
  for (const item of list) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return [...map.values()];
}

describe('demoData', () => {
  it('is re-exported from mock.js', () => {
    expect(reExported).toBe(demoData);
  });

  it('is deterministic and returns a fresh copy each call', () => {
    const again = demoData();
    expect(again).toEqual(data);
    again.filters[0].criteria.from = 'changed';
    expect(demoData().filters[0].criteria.from).toBe('amazon.co.uk');
  });

  it('has the right size', () => {
    expect(data.filters.length).toBeGreaterThanOrEqual(55);
    expect(data.filters.length).toBeLessThanOrEqual(70);
    expect(userLabels).toHaveLength(25);
    expect(userLabels.some((l) => l.name.includes('/'))).toBe(true);
    expect(data.messages).toHaveLength(200);
    expect(data.forwardingAddresses).toHaveLength(3);
    expect(data.forwardingAddresses.filter((a) => a.verificationStatus === 'pending')).toHaveLength(
      1,
    );
  });

  it('has unique ids', () => {
    expect(new Set(data.filters.map((f) => f.id)).size).toBe(data.filters.length);
    expect(new Set(data.labels.map((l) => l.id)).size).toBe(data.labels.length);
    expect(new Set(data.messages.map((m) => m.id)).size).toBe(data.messages.length);
  });

  it('has about 10 forwarding filters to the 3 addresses', () => {
    const fwd = data.filters.filter((f) => f.action.forward);
    expect(fwd).toHaveLength(10);
    const targets = new Set(fwd.map((f) => f.action.forward));
    expect(targets).toEqual(new Set(data.forwardingAddresses.map((a) => a.forwardingEmail)));
  });

  it('has exactly one pair of exact duplicates', () => {
    const dupes = groupBy(data.filters, (f) => criteriaKey(f) + actionKey(f)).filter(
      (g) => g.length > 1,
    );
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toHaveLength(2);
  });

  it('has one pair with the same criteria and different actions', () => {
    const same = groupBy(data.filters, criteriaKey)
      .filter((g) => g.length > 1)
      .filter((g) => new Set(g.map(actionKey)).size > 1);
    expect(same).toHaveLength(1);
    expect(same[0].map((f) => f.criteria.from)).toEqual(['github.com', 'github.com']);
  });

  it('has a trash filter that conflicts with a label filter for the same sender', () => {
    const trash = data.filters.filter((f) => f.action.addLabelIds?.includes('TRASH'));
    expect(trash).toHaveLength(1);
    const domain = trash[0].criteria.from.split('@').pop();
    const other = data.filters.filter((f) => f !== trash[0] && f.criteria.from?.includes(domain));
    expect(other.some((f) => f.action.addLabelIds?.some((id) => id.startsWith('Label_')))).toBe(
      true,
    );
  });

  it('has one filter that uses a deleted label', () => {
    expect(labelIds.has(DELETED_LABEL_ID)).toBe(false);
    const missing = data.filters.filter((f) =>
      [...(f.action.addLabelIds ?? []), ...(f.action.removeLabelIds ?? [])].some(
        (id) => !labelIds.has(id),
      ),
    );
    expect(missing.map((f) => f.action.addLabelIds)).toEqual([[DELETED_LABEL_ID]]);
  });

  it('has one group of 4 merge candidates (same action, from: only), apart from the duplicates', () => {
    const groups = groupBy(data.filters, actionKey).filter((g) => g.length > 1);
    const merge = groups.filter((g) => new Set(g.map(criteriaKey)).size === g.length);
    expect(merge).toHaveLength(1);
    expect(merge[0]).toHaveLength(4);
    expect(merge[0].every((f) => Object.keys(f.criteria).join() === 'from')).toBe(true);
  });

  it("has one filter near the length limit, under Google's hard cap", () => {
    const lengths = data.filters.map((f) => mockCriteriaString(f.criteria).length);
    const near = lengths.filter((n) => n > 1300);
    expect(near).toHaveLength(1);
    expect(near[0]).toBeGreaterThan(1400);
    expect(near[0]).toBeLessThanOrEqual(1469);
  });

  it('has one filter with an unsafe is: operator', () => {
    expect(data.filters.filter((f) => /\bis:/.test(f.criteria.query ?? ''))).toHaveLength(1);
  });

  it('uses only fake personal addresses', () => {
    const personal = [
      ...data.forwardingAddresses.map((a) => a.forwardingEmail),
      ...data.messages.map((m) => m.to),
    ];
    for (const a of personal) expect(a).toMatch(/@example\.(com|org|net)$/);
    const people = data.messages.filter((m) => /^(Mum|Priya Shah|St Mary's)/.test(m.from));
    expect(people.length).toBeGreaterThan(0);
    for (const m of people) expect(m.from).toMatch(/@[a-z.-]*example\.(com|org|net)>$/);
  });

  it('has plausible UK senders and newsletters with unsubscribe text', () => {
    const froms = data.messages.map((m) => m.from).join('\n');
    for (const domain of [
      'amazon.co.uk',
      'royalmail.com',
      'hmrc.gov.uk',
      'octopus.energy',
      'monzo.com',
      'github.com',
    ]) {
      expect(froms).toContain(domain);
    }
    expect(data.messages.filter((m) => /unsubscribe/i.test(m.body)).length).toBeGreaterThan(20);
    for (const m of data.messages) {
      expect(Number.isNaN(Date.parse(m.date))).toBe(false);
      expect(m.id).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('loads into the mock, and every valid filter can be made again', async () => {
    const api = createMockGmail({ ...data, filters: [] });
    let made = 0;
    const errors = [];
    for (const f of data.filters) {
      try {
        await api.createFilter(f);
        made++;
      } catch (err) {
        errors.push(err.detail);
      }
    }
    // Only the duplicate, the deleted label and the pending forward fail.
    expect(errors.sort()).toEqual([
      'Filter already exists',
      `Invalid label: ${DELETED_LABEL_ID}`,
      'Unrecognized forwarding address',
    ]);
    expect(made).toBe(data.filters.length - 3);
  });
});

describe('seededRandom', () => {
  it('repeats for the same seed and stays in [0, 1)', () => {
    const a = seededRandom(1);
    const b = seededRandom(1);
    const xs = Array.from({ length: 100 }, () => a());
    expect(Array.from({ length: 100 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seededRandom(2)()).not.toBe(xs[0]);
  });
});
