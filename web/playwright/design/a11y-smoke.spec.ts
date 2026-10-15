/**
 * Scoped a11y smoke heuristic for design review, not a WCAG audit.
 *
 * Contrast compares computed text color against the nearest opaque ancestor
 * background, so gradients, images, transparency, opacity and pseudo-elements
 * are not handled. Target size ignores WCAG 2.2's spacing and inline-link
 * exceptions. A failure needs human review before it is called a violation.
 */
import {test, expect} from '../fixtures';
import {DESIGN_ROUTES, createDesignData, waitForDesignReady} from './routes';

// Runs in the browser via page.evaluate, so it must stay self-contained.
function audit() {
  const describe = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const testId = el.getAttribute('data-testid');
    if (testId) return `${tag}[data-testid="${testId}"]`;
    if (el.id) return `${tag}#${el.id}`;
    const classes = Array.from(el.classList)
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('');
    const label = (el.getAttribute('aria-label') || el.textContent || '')
      .trim()
      .slice(0, 30);
    return `${tag}${classes}${label ? ` "${label}"` : ''}`;
  };

  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})
    );
  };

  // Painting through a canvas normalizes any CSS color syntax to sRGB.
  const ctx = new OffscreenCanvas(1, 1).getContext('2d', {
    willReadFrequently: true,
  }) as OffscreenCanvasRenderingContext2D;
  const rgba = (color: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };

  const luminance = (c: number[]) => {
    const [r, g, b] = c.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const background = (start: Element) => {
    for (let el: Element | null = start; el; el = el.parentElement) {
      const c = rgba(getComputedStyle(el).backgroundColor);
      if (c[3] === 1) return c;
    }
    return [255, 255, 255, 1];
  };

  const targets = new Set<string>();
  document
    .querySelectorAll('a, button, input, select, [role=button]')
    .forEach((el) => {
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) {
        targets.add(
          `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
      }
    });

  const contrast = new Set<string>();
  const checked = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!el || checked.has(el) || !walker.currentNode.textContent?.trim()) {
      continue;
    }
    checked.add(el);
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    const bg = background(el);
    const fg = rgba(style.color);
    const text = [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
    const [hi, lo] = [luminance(text), luminance(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(style.fontSize);
    const large =
      size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      contrast.add(`${describe(el)} ${ratio.toFixed(2)}:1`);
    }
  }

  const width = document.documentElement.clientWidth;
  const overflows = (el: Element | null) =>
    !!el && el.getBoundingClientRect().right > width + 0.5;
  const overflow = Array.from(document.body.querySelectorAll('*'))
    .filter((el) => overflows(el) && !overflows(el.parentElement))
    .map(describe);

  return {
    targets: Array.from(targets),
    contrast: Array.from(contrast),
    overflow,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: width,
  };
}

test.describe('Design a11y smoke', () => {
  for (const route of DESIGN_ROUTES) {
    test(route.slug, async ({authenticatedPage, api}) => {
      const errors: string[] = [];
      authenticatedPage.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
      });
      authenticatedPage.on('pageerror', (err) =>
        errors.push(`pageerror: ${err.message}`),
      );

      await authenticatedPage.setViewportSize({width: 1280, height: 800});
      await authenticatedPage.goto(route.path(await createDesignData(api)));
      await waitForDesignReady(authenticatedPage);

      const wide = await authenticatedPage.evaluate(audit);
      expect.soft(errors, `${errors.length} console/page errors`).toEqual([]);
      expect
        .soft(
          wide.targets,
          `${wide.targets.length} interactive elements under 24x24 CSS px`,
        )
        .toEqual([]);
      expect
        .soft(
          wide.contrast,
          `${wide.contrast.length} text elements below WCAG AA contrast`,
        )
        .toEqual([]);

      await authenticatedPage.setViewportSize({width: 420, height: 800});
      await authenticatedPage.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      const narrow = await authenticatedPage.evaluate(audit);
      expect
        .soft(
          narrow.scrollWidth,
          `horizontal scroll at 420px; outermost overflowing elements:\n${narrow.overflow.join(
            '\n',
          )}`,
        )
        .toBeLessThanOrEqual(narrow.clientWidth);
    });
  }
});
