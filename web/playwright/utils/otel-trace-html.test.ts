import {describe, expect, it, vi} from 'vitest';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readFile, rm} from 'node:fs/promises';
import {
  attachOtelTraceHtml,
  childCoverage,
  renderTraceHtml,
  TraceMeta,
} from './otel-trace-html';
import {
  makeLargeTrace,
  realTrace7Spans,
} from './__fixtures__/otel-trace-fixtures';

const NO_EXTERNAL_REFS =
  /<link\b|<script[^>]+src=|url\((['"]?)https?:|\bfetch\(|serviceWorker/;

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function span(startTime: number, duration: number) {
  return {
    spanID: `${startTime}-${duration}`,
    operationName: 'op',
    startTime,
    duration,
    processID: 'p1',
  };
}

const baseMeta: TraceMeta = {
  testTitle: 'sample test',
  traceId: '4eea808a18db706c3b3ff9d6e5a68f0b',
};

describe('renderTraceHtml', () => {
  it('renders the real 7-span fixture as one tree with the orphan parent handled', () => {
    const html = renderTraceHtml(realTrace7Spans, baseMeta);
    const doc = parse(html);
    const rows = doc.querySelectorAll('.otel-row');
    expect(rows.length).toBe(7);
    expect(html).toContain('4eea808a18db706c3b3ff9d6e5a68f0b');
    expect(html).toContain('quay');
  });

  it('shades a parent bar with inner coverage segments and leaves leaves solid', () => {
    const html = renderTraceHtml(realTrace7Spans, baseMeta);
    const doc = parse(html);
    const segments = doc.querySelectorAll('.otel-bar-segment');
    expect(segments.length).toBeGreaterThanOrEqual(1);

    const leafBar = Array.from(doc.querySelectorAll('.otel-bar')).find(
      (bar) => !bar.classList.contains('otel-bar-faint'),
    );
    expect(leafBar).not.toBeUndefined();
    expect(leafBar?.querySelector('.otel-bar-segment')).toBeNull();

    expect(html).toContain('time not covered by direct child spans');
  });

  it('renders the large synthetic fixture with depth >= 4, one error row, two colours', () => {
    const html = renderTraceHtml(makeLargeTrace(), baseMeta);
    const doc = parse(html);
    const rows = doc.querySelectorAll('.otel-row');
    expect(rows.length).toBeGreaterThanOrEqual(50);

    let maxDepth = 0;
    rows.forEach((row) => {
      const style =
        row.querySelector('.otel-name-cell')?.getAttribute('style') ?? '';
      const match = style.match(/padding-left:(\d+)px/);
      const px = match ? parseInt(match[1], 10) : 0;
      maxDepth = Math.max(maxDepth, px / 14);
    });
    expect(maxDepth).toBeGreaterThanOrEqual(4);

    const errorRows = doc.querySelectorAll('.otel-row.error');
    expect(errorRows.length).toBe(1);

    const swatchColors = new Set<string>();
    doc.querySelectorAll('.otel-swatch').forEach((el) => {
      const style = el.getAttribute('style') ?? '';
      const match = style.match(/background:([^;"]+)/);
      if (match) swatchColors.add(match[1]);
    });
    expect(swatchColors.size).toBe(2);
  });

  it('includes a Jaeger deep link only when jaegerUrl is given', () => {
    const withLink = renderTraceHtml(realTrace7Spans, {
      ...baseMeta,
      jaegerUrl: 'http://jaeger.local/trace/abc',
    });
    expect(withLink).toContain('href="http://jaeger.local/trace/abc"');

    const withoutLink = renderTraceHtml(realTrace7Spans, baseMeta);
    expect(withoutLink).not.toContain('open in Jaeger');
  });

  it('draws the failedAt marker only when inside the trace time range', () => {
    // real fixture startTime is in microseconds; use the trace start converted to ms plus a small offset.
    const traceStartMs = Math.floor(1789415699655982 / 1000);
    const inside = renderTraceHtml(realTrace7Spans, {
      ...baseMeta,
      failedAt: traceStartMs + 100,
    });
    const insideDoc = parse(inside);
    expect(insideDoc.querySelector('.otel-marker-line')).not.toBeNull();
    expect(inside).toContain('test failed');

    const outside = renderTraceHtml(realTrace7Spans, {
      ...baseMeta,
      failedAt: 1,
    });
    const outsideDoc = parse(outside);
    expect(outsideDoc.querySelector('.otel-marker-line')).toBeNull();
  });

  it('has no external references', () => {
    const real = renderTraceHtml(realTrace7Spans, baseMeta);
    const large = renderTraceHtml(makeLargeTrace(), baseMeta);
    expect(real).not.toMatch(NO_EXTERNAL_REFS);
    expect(large).not.toMatch(NO_EXTERNAL_REFS);
  });

  it('stays within the size budget', () => {
    const real = renderTraceHtml(realTrace7Spans, baseMeta);
    const large = renderTraceHtml(makeLargeTrace(), baseMeta);
    const realBytes = Buffer.byteLength(real, 'utf-8');
    const largeBytes = Buffer.byteLength(large, 'utf-8');
    expect(realBytes).toBeLessThan(100 * 1024);
    expect(largeBytes).toBeLessThan(100 * 1024);
    expect(realBytes).toBeGreaterThan(5 * 1024);
  });

  it.each([
    ['empty string', ''],
    ['invalid JSON', '{not json'],
    ['no data', '{"data":[]}'],
    ['zero spans', '{"data":[{"spans":[]}]}'],
    ['a null trace entry', '{"data":[null]}'],
  ])('degrades gracefully for %s', (_label, input) => {
    const html = renderTraceHtml(input, baseMeta);
    expect(html).toContain('no spans captured');
  });

  it('renders without throwing when a span is missing tags/references/processes', () => {
    const minimal = JSON.stringify({
      data: [
        {
          traceID: 'x',
          spans: [
            {
              spanID: 's1',
              operationName: 'op',
              startTime: 1000,
              duration: 10,
              processID: 'p1',
            },
          ],
        },
      ],
    });
    expect(() => renderTraceHtml(minimal, baseMeta)).not.toThrow();
    const html = renderTraceHtml(minimal, baseMeta);
    expect(html).toContain('op');
  });

  it('escapes an operationName containing markup', () => {
    const malicious = JSON.stringify({
      data: [
        {
          traceID: 'x',
          spans: [
            {
              spanID: 's1',
              operationName: '<script>alert(1)</script>',
              startTime: 1000,
              duration: 10,
              processID: 'p1',
            },
          ],
          processes: {p1: {serviceName: 'svc'}},
        },
      ],
    });
    const html = renderTraceHtml(malicious, baseMeta);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes a tag value containing a script-closing comment in the inlined span data', () => {
    const poisoned = JSON.stringify({
      data: [
        {
          traceID: 'x',
          spans: [
            {
              spanID: 's1',
              operationName: 'op',
              startTime: 1000,
              duration: 10,
              processID: 'p1',
              tags: [{key: 'http.url', value: '/x?q=<!--<script'}],
            },
          ],
          processes: {p1: {serviceName: 'svc'}},
        },
      ],
    });
    const html = renderTraceHtml(poisoned, baseMeta);
    expect(html).not.toContain('<!--<script');
    expect(html).toContain('\\u003c!--\\u003cscript');
  });

  it('renders each row as a focusable toggle with aria-expanded="false"', () => {
    const html = renderTraceHtml(realTrace7Spans, baseMeta);
    const doc = parse(html);
    const rows = doc.querySelectorAll('.otel-row');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(row.getAttribute('role')).toBe('button');
      expect(row.getAttribute('tabindex')).toBe('0');
      expect(row.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('gives rows with a duplicate spanID distinct toggle identities', () => {
    const dupTrace = JSON.stringify({
      data: [
        {
          traceID: 'x',
          spans: [
            {
              spanID: 'a',
              operationName: 'op1',
              startTime: 1000,
              duration: 10,
              processID: 'p1',
            },
            {
              spanID: 'a',
              operationName: 'op2',
              startTime: 1020,
              duration: 10,
              processID: 'p1',
            },
          ],
          processes: {p1: {serviceName: 'svc'}},
        },
      ],
    });
    const html = renderTraceHtml(dupTrace, baseMeta);
    const doc = parse(html);
    const rows = doc.querySelectorAll('.otel-row');
    expect(rows.length).toBe(2);
    const indices = Array.from(rows).map((row) =>
      row.getAttribute('data-row-index'),
    );
    expect(new Set(indices).size).toBe(2);
  });

  it('does not explode when a duplicate spanID is referenced as a parent', () => {
    // Two independent chains of 10 spans each reuse the same spanIDs for
    // their parent links; each span instance must still be visited once.
    const makeChain = (prefix: string) => {
      const spans = [];
      for (let i = 0; i < 10; i++) {
        spans.push({
          spanID: `dup-${i}`,
          operationName: `${prefix}-${i}`,
          startTime: 1000 + i * 10,
          duration: 10,
          processID: 'p1',
          references:
            i === 0 ? [] : [{refType: 'CHILD_OF', spanID: `dup-${i - 1}`}],
        });
      }
      return spans;
    };
    const dupTrace = JSON.stringify({
      data: [
        {
          traceID: 'x',
          spans: [...makeChain('a'), ...makeChain('b')],
          processes: {p1: {serviceName: 'svc'}},
        },
      ],
    });
    const html = renderTraceHtml(dupTrace, baseMeta);
    const doc = parse(html);
    expect(doc.querySelectorAll('.otel-row').length).toBe(20);
  });

  it('degrades gracefully when spans form a cycle disconnected from any root', () => {
    const cyclic = JSON.stringify({
      data: [
        {
          traceID: 'x',
          spans: [
            {
              spanID: 'root',
              operationName: 'root-op',
              startTime: 1000,
              duration: 10,
              processID: 'p1',
              references: [],
            },
            {
              spanID: 'a',
              operationName: 'a-op',
              startTime: 1000,
              duration: 10,
              processID: 'p1',
              references: [{refType: 'CHILD_OF', spanID: 'b'}],
            },
            {
              spanID: 'b',
              operationName: 'b-op',
              startTime: 1000,
              duration: 10,
              processID: 'p1',
              references: [{refType: 'CHILD_OF', spanID: 'a'}],
            },
          ],
          processes: {p1: {serviceName: 'svc'}},
        },
      ],
    });
    const html = renderTraceHtml(cyclic, baseMeta);
    expect(html).toContain('no spans captured');
  });

  it('does not treat a FOLLOWS_FROM successor as covering its predecessor', () => {
    const followsFrom = JSON.stringify({
      data: [
        {
          traceID: 'x',
          spans: [
            {
              spanID: 'parent',
              operationName: 'parent-op',
              startTime: 1000,
              duration: 100,
              processID: 'p1',
              references: [],
            },
            {
              spanID: 'successor',
              operationName: 'successor-op',
              startTime: 1000,
              duration: 100,
              processID: 'p1',
              references: [{refType: 'FOLLOWS_FROM', spanID: 'parent'}],
            },
          ],
          processes: {p1: {serviceName: 'svc'}},
        },
      ],
    });
    const html = renderTraceHtml(followsFrom, baseMeta);
    const doc = parse(html);
    expect(doc.querySelectorAll('.otel-bar-segment').length).toBe(0);
    expect(doc.querySelectorAll('.otel-bar-faint').length).toBe(0);
  });

  it('does not pollute Object.prototype via a __proto__ process key', () => {
    // Built as raw JSON text: a JS object literal's `__proto__: ...` key
    // sets the prototype instead of creating an own property, so
    // JSON.stringify would silently drop it before it reached our parser.
    const poisoned = `{"data":[{"traceID":"x","spans":[{"spanID":"s1","operationName":"op","startTime":1000,"duration":10,"processID":"__proto__","references":[]}],"processes":{"__proto__":{"serviceName":"proto-svc"}}}]}`;
    const html = renderTraceHtml(poisoned, baseMeta);
    expect(({} as Record<string, unknown>).serviceName).toBeUndefined();
    expect(html).toContain('proto-svc');
  });

  it('exposes coverage as an accessible label, not just a color difference', () => {
    const html = renderTraceHtml(realTrace7Spans, baseMeta);
    const doc = parse(html);
    const labeled = doc.querySelector('.otel-track[aria-label*="covered"]');
    expect(labeled).not.toBeNull();
  });

  it('ignores a raw infinite child duration in the public render instead of showing false coverage', () => {
    // 1e400 overflows to Infinity when JSON.parse evaluates the number
    // literal; JSON has no literal token for Infinity itself.
    const malformed =
      '{"data":[{"traceID":"x","spans":[' +
      '{"spanID":"parent","operationName":"parent-op","startTime":100,"duration":100,"processID":"p1","references":[]},' +
      '{"spanID":"child","operationName":"child-op","startTime":125,"duration":1e400,"processID":"p1","references":[{"refType":"CHILD_OF","spanID":"parent"}]}' +
      '],"processes":{"p1":{"serviceName":"svc"}}}]}';
    const html = renderTraceHtml(malformed, baseMeta);
    const doc = parse(html);
    const track = doc.querySelector('.otel-track[aria-label*="covered"]');
    expect(track?.getAttribute('aria-label')).toBe(
      '0% covered by direct child spans',
    );
    expect(doc.querySelectorAll('.otel-bar-segment').length).toBe(0);
  });

  it('toggles a details panel on click and via keyboard', () => {
    const html = renderTraceHtml(realTrace7Spans, baseMeta);
    const bodyMatch = html.match(/<body>([\s\S]*?)<script>/);
    const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
    if (!bodyMatch || !scriptMatch) {
      throw new Error('expected body and script markup in rendered html');
    }
    document.body.innerHTML = bodyMatch[1];
    // eslint-disable-next-line no-new-func -- exercising the inlined script as a browser would
    new Function(scriptMatch[1])();

    const row = document.querySelector('.otel-row') as HTMLElement;
    expect(row.getAttribute('aria-expanded')).toBe('false');

    row.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(
      document.getElementById('details-0')?.classList.contains('open'),
    ).toBe(true);

    row.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(row.getAttribute('aria-expanded')).toBe('false');

    row.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
    );
    expect(row.getAttribute('aria-expanded')).toBe('true');

    document.body.innerHTML = '';
  });
});

describe('childCoverage', () => {
  it('returns 0 for a span with no children', () => {
    expect(childCoverage(span(0, 100), [])).toEqual({
      fraction: 0,
      segments: [],
    });
  });

  it('returns the duration ratio for one child fully inside the parent', () => {
    const result = childCoverage(span(0, 100), [span(10, 25)]);
    expect(result.fraction).toBeCloseTo(0.25);
    expect(result.segments).toEqual([{leftPct: 10, widthPct: 25}]);
  });

  it('merges two overlapping children instead of summing their durations', () => {
    const result = childCoverage(span(0, 100), [
      span(10, 30), // covers [10, 40]
      span(20, 30), // covers [20, 50], overlaps the first
    ]);
    // merged coverage is [10, 50] = 40, not the summed 60
    expect(result.fraction).toBeCloseTo(0.4);
    expect(result.segments).toEqual([{leftPct: 10, widthPct: 40}]);
  });

  it('clips a child overhanging the parent end so fraction stays <= 1', () => {
    const result = childCoverage(span(0, 100), [span(80, 50)]);
    expect(result.fraction).toBeCloseTo(0.2);
    expect(result.fraction).toBeLessThanOrEqual(1);
    expect(result.segments).toEqual([{leftPct: 80, widthPct: 20}]);
  });

  it('returns 0 for a span with duration <= 0', () => {
    expect(childCoverage(span(0, 0), [span(0, 10)])).toEqual({
      fraction: 0,
      segments: [],
    });
  });

  it('returns 0 instead of Infinity when start + duration overflows to a nonfinite value', () => {
    const result = childCoverage(span(1e308, 1e308), [span(1e308, 10)]);
    expect(result).toEqual({fraction: 0, segments: []});
  });

  it('ignores a child with a raw infinite duration instead of clipping it into false coverage', () => {
    // Without pre-clip validation, Math.min(125 + Infinity, 200) clips to
    // 200, reporting 75% coverage from a single malformed child.
    const result = childCoverage(span(100, 100), [span(125, Infinity)]);
    expect(result).toEqual({fraction: 0, segments: []});
  });

  it('clips a subpixel-wide child to a rounded, non-scientific-notation percentage', () => {
    const result = childCoverage(span(0, 1_000_000_000), [span(0, 1)]);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].widthPct).toBe(0);
    expect(Number.isFinite(result.segments[0].widthPct)).toBe(true);
  });

  it('computes ~1.3% coverage for the real 7-span fixture root', () => {
    const parsed = JSON.parse(realTrace7Spans);
    const spans = parsed.data[0].spans as Array<{
      spanID: string;
      startTime: number;
      duration: number;
      references?: Array<{refType: string; spanID: string}>;
    }>;
    const byId = new Map(spans.map((s) => [s.spanID, s]));
    const roots = spans.filter((s) => {
      const parentId = s.references?.find(
        (r) => r.refType === 'CHILD_OF',
      )?.spanID;
      return !parentId || !byId.has(parentId);
    });
    const childrenOfRoot = (rootId: string) =>
      spans.filter((s) =>
        s.references?.some(
          (r) => r.refType === 'CHILD_OF' && r.spanID === rootId,
        ),
      );
    const root = roots.find((r) => childrenOfRoot(r.spanID).length > 0);
    if (!root) {
      throw new Error('expected a root span with children in the fixture');
    }
    const children = childrenOfRoot(root.spanID);
    expect(children.length).toBeGreaterThan(0);

    const result = childCoverage(
      root as Parameters<typeof childCoverage>[0],
      children as Parameters<typeof childCoverage>[1],
    );
    // 2917 + 1282 + 1134 + 883 + 1656 = 7872us covered / 585706us duration
    expect(result.fraction).toBeCloseTo(0.013440190129518905);
    expect(result.fraction * 100).toBeCloseTo(1.3440190129518905, 1);
  });
});

describe('attachOtelTraceHtml', () => {
  it('writes the file and attaches it path-based, never throwing', async () => {
    const outputFile = join(tmpdir(), `otel-trace-${Date.now()}.html`);
    const attach = vi.fn().mockResolvedValue(undefined);
    const testInfo = {
      outputPath: () => outputFile,
      attach,
      title: 'fake test',
    } as unknown as import('@playwright/test').TestInfo;

    await attachOtelTraceHtml(testInfo, realTrace7Spans, baseMeta);

    expect(attach).toHaveBeenCalledWith('otel-trace.html', {
      path: outputFile,
      contentType: 'text/html',
    });
    const content = await readFile(outputFile, 'utf-8');
    expect(content).toContain('4eea808a18db706c3b3ff9d6e5a68f0b');
    await rm(outputFile, {force: true});
  });

  it('does not throw when attach rejects', async () => {
    const outputFile = join(tmpdir(), `otel-trace-reject-${Date.now()}.html`);
    const attach = vi.fn().mockRejectedValue(new Error('attach failed'));
    const testInfo = {
      outputPath: () => outputFile,
      attach,
      title: 'fake test',
    } as unknown as import('@playwright/test').TestInfo;

    await expect(
      attachOtelTraceHtml(testInfo, realTrace7Spans, baseMeta),
    ).resolves.toBeUndefined();
    await rm(outputFile, {force: true});
  });
});
