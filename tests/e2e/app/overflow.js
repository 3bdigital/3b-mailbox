// Measures horizontal overflow and names the elements that cause it, so a CI failure says why.

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{scrollWidth: number, clientWidth: number, culprits: string[]}>}
 */
export async function measureOverflow(page) {
  return page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const culprits = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > clientWidth + 0.5) {
        const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].map((c) => `.${c}`).join('')}`;
        culprits.push(`${name} right=${Math.round(r.right)} width=${Math.round(r.width)}`);
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth,
      culprits: culprits.slice(0, 12),
    };
  });
}
