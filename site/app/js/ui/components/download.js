// "Download for Gmail" in no sign-in mode: the new mailFilters.xml file and the exact steps to put
// it back in Gmail. Gmail import adds filters and never deletes, so the old ones go first.

import { toGmailXml } from '../../core/backup.js';
import { download, h, plural } from '../dom.js';
import { openDialog } from './dialog.js';
import { announce, toast } from './toast.js';
import { button, notice } from './widgets.js';

/** The file names for the two downloads. Gmail import accepts any name. */
export const NEW_FILE_NAME = 'mailFilters-new.xml';
export const ORIGINAL_FILE_NAME = 'mailFilters-original.xml';

/**
 * Opens the dialog.
 * @param {any} ctx
 */
export function downloadDialog(ctx) {
  const s = ctx.state.get();
  const xml = toGmailXml(s.filters, s.labelsById);
  const entries = (xml.match(/<entry>/g) ?? []).length;
  const done = h('p', { class: 'download-done', role: 'status' });

  const downloadNew = button({
    label: 'Download the new file',
    variant: 'primary',
    icon: 'download',
    onClick: () => {
      const now = ctx.state.get();
      download(NEW_FILE_NAME, toGmailXml(now.filters, now.labelsById), 'application/xml');
      ctx.markDownloaded();
      done.textContent = `Downloaded ${NEW_FILE_NAME}.`;
      toast(`Downloaded ${plural(now.filters.length, 'filter')} for Gmail.`, { tone: 'success' });
    },
  });
  const downloadOriginal = button({
    label: 'Download the original file again',
    icon: 'download',
    size: 'sm',
    onClick: () => {
      download(ORIGINAL_FILE_NAME, ctx.file?.text ?? '', 'application/xml');
      announce(`Downloaded ${ORIGINAL_FILE_NAME}.`);
    },
  });
  const close = button({ label: 'Close', variant: 'secondary' });

  const d = openDialog({
    title: 'Put your filters back in Gmail',
    description:
      'Gmail import adds filters. It never deletes them. So you delete the old filters first, then import the new file.',
    size: 'md',
    initialFocus: 'heading',
    content: [
      h('p', {
        text:
          entries === s.filters.length
            ? `The new file has ${plural(s.filters.length, 'filter')}.`
            : `The new file has ${plural(s.filters.length, 'filter')}. Gmail allows one label for each filter in a file, so some filters are split. Gmail gets ${plural(entries, 'filter')}.`,
      }),
      h(
        'ol',
        { class: 'gmail-steps' },
        h(
          'li',
          null,
          h('p', {
            text: 'Keep your original file as a backup. If something goes wrong, you can import it again.',
          }),
          ctx.file && downloadOriginal,
        ),
        h(
          'li',
          null,
          h('p', { text: `Download the new file. It is called ${NEW_FILE_NAME}.` }),
          downloadNew,
          done,
        ),
        h(
          'li',
          null,
          h('p', {
            text: 'In Gmail, open Settings, then See all settings, then Filters and blocked addresses. Tick the box to select all your filters, then choose Delete.',
          }),
        ),
        h(
          'li',
          null,
          h('p', {
            text: `At the bottom, choose Import filters. Choose ${NEW_FILE_NAME}, then Open file. Tick nothing else. Choose Create filters.`,
          }),
        ),
      ),
      notice({
        tone: 'info',
        children: [
          h('p', {
            text: 'Gmail matches labels by name. If a label does not exist, Gmail makes it.',
          }),
          h('p', {
            text: 'Forwarding works only to addresses you have already verified in Gmail.',
          }),
        ],
      }),
    ],
    footer: close,
  });
  close.addEventListener('click', () => d.close());
  return d;
}
