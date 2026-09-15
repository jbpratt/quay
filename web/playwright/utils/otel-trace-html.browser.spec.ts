import {expect, test} from '@playwright/test';
import {renderTraceHtml} from './otel-trace-html';

/**
 * happy-dom (used by the vitest suite in otel-trace-html.test.ts) never
 * computes CSS layout, so it cannot catch a real 0px segment. These tests
 * render the same HTML in a real browser and assert on measured geometry.
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
