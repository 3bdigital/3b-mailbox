// "Show matching mail": needs the 'preview' tier. Shows up to 25 matches (from, subject, date).

import { criteriaToSearch, isEmptyCriteria } from '../../core/limits.js';
import { formatDate, h, plural } from '../dom.js';
import { openDialog } from './dialog.js';
import { ensureTier } from './permission.js';
import { button, emptyState, notice } from './widgets.js';

/** @typedef {import('../../types.js').FilterCriteria} FilterCriteria */

/**
 * @param {any} ctx
 * @param {FilterCriteria} criteria
 */
export async function showMatches(ctx, criteria) {
  if (isEmptyCriteria(criteria)) {
    const close = button({ label: 'Close', variant: 'primary' });
    const d = openDialog({
      title: 'Add search terms first',
      size: 'sm',
      content: h('p', { text: 'This filter has no search terms yet, so it would match all mail.' }),
      footer: close,
    });
    close.addEventListener('click', () => d.close());
    return;
  }
  const ok = await ensureTier(ctx, 'preview', {
    why: 'To show which emails this filter catches, Email Filter needs to search your mail.',
  });
  if (!ok) return;
  const q = criteriaToSearch(criteria);
  const close = button({ label: 'Close', variant: 'primary' });
  const status = h('p', { role: 'status', class: 'muted', text: 'Searching your mail...' });
  const d = openDialog({
    title: 'Matching mail',
    description: 'The newest emails that this filter would catch. Nothing is saved.',
    size: 'lg',
    content: [
      h(
        'p',
        { class: 'search-string' },
        h('span', { class: 'muted', text: 'Search: ' }),
        h('code', { text: q }),
      ),
      status,
    ],
    footer: close,
    initialFocus: 'heading',
  });
  close.addEventListener('click', () => d.close());
  try {
    const found = await ctx.api.searchMessages(q, 25);
    if (!d.el.open) return;
    status.textContent =
      found.length === 0
        ? 'No emails match.'
        : `${plural(found.length, 'email')} shown${found.length === 25 ? ' (the newest 25)' : ''}.`;
    if (found.length === 0) {
      d.body.append(
        emptyState({
          title: 'No emails match',
          text: 'This filter does not catch any mail you have now. It still acts on new mail that matches.',
          icon: 'mail',
        }),
      );
      return;
    }
    d.body.append(
      h(
        'div',
        { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Matching emails' },
        h(
          'table',
          { class: 'table' },
          h('caption', { class: 'visually-hidden', text: 'Emails that match this filter' }),
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { scope: 'col', text: 'From' }),
              h('th', { scope: 'col', text: 'Subject' }),
              h('th', { scope: 'col', text: 'Date' }),
            ),
          ),
          h(
            'tbody',
            null,
            found.map((m) =>
              h(
                'tr',
                null,
                h('td', { class: 'cell-from', text: m.from }),
                h('td', { text: m.subject || '(no subject)' }),
                h('td', { class: 'cell-date', text: formatDate(m.date) }),
              ),
            ),
          ),
        ),
      ),
    );
  } catch (err) {
    status.textContent = '';
    d.body.append(
      notice({
        tone: 'danger',
        role: 'alert',
        text: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
