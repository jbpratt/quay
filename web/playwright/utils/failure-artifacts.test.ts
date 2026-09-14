// @vitest-environment node

import {describe, expect, it, vi} from 'vitest';
import type {TestInfo} from '@playwright/test';
import {writeFile} from 'fs/promises';
import {
  attachFailureArtifacts,
  capTail,
  interleaveTimestampedLines,
  logWindow,
  newTraceContext,
  shouldCollect,
} from './failure-artifacts';

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe('newTraceContext', () => {
  it('produces a well-formed W3C trace context', () => {
    const trace = newTraceContext();
    expect(trace.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(trace.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(trace.traceparent).toBe(`00-${trace.traceId}-${trace.spanId}-01`);
  });

  it('mints a different trace id on each call', () => {
    const a = newTraceContext();
    const b = newTraceContext();
    expect(a.traceId).not.toBe(b.traceId);
    expect(a.spanId).not.toBe(b.spanId);
  });
});

describe('shouldCollect', () => {
  it('is true when a test fails and was expected to pass', () => {
    expect(shouldCollect('failed', 'passed')).toBe(true);
  });

  it('is true when a test times out and was expected to pass', () => {
    expect(shouldCollect('timedOut', 'passed')).toBe(true);
  });

  it('is false for an expected failure (test.fail)', () => {
    expect(shouldCollect('failed', 'failed')).toBe(false);
  });

  it('is false when a test is skipped', () => {
    expect(shouldCollect('skipped', 'passed')).toBe(false);
  });

  it('is false when a test passes', () => {
    expect(shouldCollect('passed', 'passed')).toBe(false);
  });

  it('is true when a test.fail() test times out instead of failing', () => {
    expect(shouldCollect('timedOut', 'failed')).toBe(true);
  });
});

describe('logWindow', () => {
  it('pads both sides of the window and returns ISO-8601 strings', () => {
    const startedAt = new Date('2026-01-01T00:00:05.000Z');
    const endedAt = new Date('2026-01-01T00:00:10.000Z');
    const {since, until} = logWindow(startedAt, endedAt, 2000);
    expect(since).toBe('2026-01-01T00:00:03.000Z');
    expect(until).toBe('2026-01-01T00:00:12.000Z');
  });

  it('defaults the pad to 2000ms', () => {
    const startedAt = new Date('2026-01-01T00:00:05.000Z');
    const endedAt = new Date('2026-01-01T00:00:10.000Z');
    const {since, until} = logWindow(startedAt, endedAt);
    expect(since).toBe('2026-01-01T00:00:03.000Z');
    expect(until).toBe('2026-01-01T00:00:12.000Z');
  });
});

describe('capTail', () => {
  it('returns text unchanged when at or under the cap', () => {
    const text = 'hello world';
    expect(capTail(text, Buffer.byteLength(text))).toBe(text);
    expect(capTail(text, Buffer.byteLength(text) + 10)).toBe(text);
  });

  it('truncates and preserves the exact tail when over the cap', () => {
    const text = '0123456789';
    const result = capTail(text, 4);
    expect(result).toBe('[truncated: kept last 4 of 10 bytes]\n6789');
  });

  it('does not throw when the cap cuts a multibyte UTF-8 character', () => {
    // '€' is 3 bytes in UTF-8; capping at a byte offset that splits it must
    // not throw, even though the decoded tail may contain a replacement char.
    const text = 'ab€cd';
    expect(() => capTail(text, 3)).not.toThrow();
  });
});

describe('interleaveTimestampedLines', () => {
  it('merges two --timestamps-prefixed streams into chronological order', () => {
    const stdout = ['2026-01-01T00:00:00.000000000Z out1'].join('\n');
    const stderr = [
      '2026-01-01T00:00:01.000000000Z err1',
      '2026-01-01T00:00:02.000000000Z err2',
    ].join('\n');
    expect(interleaveTimestampedLines(stdout, stderr)).toBe(
      [
        '2026-01-01T00:00:00.000000000Z out1',
        '2026-01-01T00:00:01.000000000Z err1',
        '2026-01-01T00:00:02.000000000Z err2',
      ].join('\n'),
    );
  });

  it('interleaves a stderr line between two stdout lines, unlike concatenation', () => {
    const stdout = [
      '2026-01-01T00:00:00.000000000Z out1',
      '2026-01-01T00:00:02.000000000Z out2',
    ].join('\n');
    const stderr = ['2026-01-01T00:00:01.000000000Z err1'].join('\n');
    expect(interleaveTimestampedLines(stdout, stderr)).toBe(
      [
        '2026-01-01T00:00:00.000000000Z out1',
        '2026-01-01T00:00:01.000000000Z err1',
        '2026-01-01T00:00:02.000000000Z out2',
      ].join('\n'),
    );
  });

  it('drops empty lines from either stream', () => {
    expect(interleaveTimestampedLines('', '')).toBe('');
  });
});

describe('attachFailureArtifacts', () => {
  it('attaches not-collected.txt when every collector fails', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    process.env.QUAY_LOG_CMD = 'quay-test-cmd-that-does-not-exist';

    try {
      const attached: string[] = [];
      const testInfo = {
        outputPath: (name: string) => `/tmp/${name}`,
        attach: vi.fn(async (name: string) => {
          attached.push(name);
        }),
      } as unknown as TestInfo;

      const runPromise = attachFailureArtifacts(
        testInfo,
        newTraceContext(),
        new Date(),
      );
      await vi.runAllTimersAsync();
      await runPromise;

      expect(attached).toEqual(['not-collected.txt']);

      const notCollectedCall = vi
        .mocked(writeFile)
        .mock.calls.find(([path]) => path === '/tmp/not-collected.txt');
      const body = notCollectedCall?.[1] as string;
      expect(body).toContain('server-spans.json');
      expect(body).toContain('quay-logs.txt');
      expect(body).toContain('quay-config.json');
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      delete process.env.QUAY_LOG_CMD;
    }
  });
});
