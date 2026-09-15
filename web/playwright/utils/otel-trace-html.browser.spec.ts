import {expect, test} from '@playwright/test';
import {renderTraceHtml} from './otel-trace-html';

/**
 * happy-dom (used by the vitest suite in otel-trace-html.test.ts) never
 * computes CSS layout and doesn't parse the inlined script as a browser
 * would. These tests render the same HTML in a real browser and assert on
 * measured geometry and script-execution behavior.
 */

function subpixelChildTrace(): string {
  return JSON.stringify({
    data: [
      {
        traceID: 'x',
        spans: [
          {
            spanID: 'parent',
            operationName: 'parent-op',
            startTime: 0,
            duration: 1_000_000_000,
            processID: 'p1',
            references: [],
          },
          {
            spanID: 'child',
            operationName: 'child-op',
            startTime: 0,
            duration: 1,
            processID: 'p1',
            references: [{refType: 'CHILD_OF', spanID: 'parent'}],
          },
        ],
        processes: {p1: {serviceName: 'svc'}},
      },
    ],
  });
}

test(
  'renders a subpixel-wide coverage segment as at least 1px, not 0',
  {tag: ['@smoke']},
  async ({page}) => {
    const html = renderTraceHtml(subpixelChildTrace(), {
      testTitle: 'subpixel coverage',
      traceId: 'subpixel-trace',
    });
    await page.setContent(html);

    const segment = page.locator('.otel-bar-segment').first();
    const box = await segment.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(1);
    }
  },
);

test(
  'opens details for a __proto__ processID trace without pollution or a script error',
  {tag: ['@smoke']},
  async ({page}) => {
    const poisoned = `{"data":[{"traceID":"x","spans":[{"spanID":"s1","operationName":"op","startTime":1000,"duration":10,"processID":"__proto__","references":[]}],"processes":{"__proto__":{"serviceName":"proto-svc"}}}]}`;
    const html = renderTraceHtml(poisoned, {
      testTitle: 'proto trace',
      traceId: 'proto-trace',
    });

    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.setContent(html);
    await page.locator('.otel-row').first().click();

    expect(pageErrors).toEqual([]);
    await expect(page.locator('.otel-details')).toContainText('proto-svc');

    // The regression is local to OTEL_TRACE_DATA.processes, not global
    // Object.prototype: a bare object-literal embed turns the server's own
    // "__proto__" data property back into a real prototype link, so
    // hasOwnProperty is false and getPrototypeOf aliases the process entry.
    // eval() is the only way to reach a script-scoped `const` from evaluate().
    const {ownProperty, prototypeAliased} = await page.evaluate(() => {
      // eslint-disable-next-line no-eval -- reach the page script's `const OTEL_TRACE_DATA`
      const data = eval('OTEL_TRACE_DATA') as {
        processes: Record<string, unknown>;
      };
      return {
        ownProperty: Object.prototype.hasOwnProperty.call(
          data.processes,
          '__proto__',
        ),
        prototypeAliased:
          Object.getPrototypeOf(data.processes) !== Object.getPrototypeOf({}),
      };
    });
    expect(ownProperty).toBe(true);
    expect(prototypeAliased).toBe(false);
  },
);

test(
  'keeps the failedAt marker label visible inside the horizontally scrollable waterfall',
  {tag: ['@smoke']},
  async ({page}) => {
    const trace = JSON.stringify({
      data: [
        {
          traceID: 'x',
          spans: [
            {
              spanID: 'root',
              operationName: 'root-op',
              startTime: 0,
              duration: 1000,
              processID: 'p1',
              references: [],
            },
          ],
          processes: {p1: {serviceName: 'svc'}},
        },
      ],
    });
    const html = renderTraceHtml(trace, {
      testTitle: 'marker visibility',
      traceId: 'marker-trace',
      failedAt: 0.5,
    });
    await page.setContent(html);

    const ratio = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const label = document.querySelector('.otel-marker-label');
          const root = document.querySelector('.otel-waterfall');
          if (!label || !root) {
            resolve(0);
            return;
          }
          const io = new IntersectionObserver(
            (entries) => {
              resolve(entries[0].intersectionRatio);
              io.disconnect();
            },
            {root, threshold: [0, 1]},
          );
          io.observe(label);
        }),
    );
    expect(ratio).toBeGreaterThan(0.99);
  },
);
