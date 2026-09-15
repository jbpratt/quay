import {describe, expect, it, vi} from 'vitest';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readFile, rm} from 'node:fs/promises';
import {
  attachOtelTraceHtml,
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
