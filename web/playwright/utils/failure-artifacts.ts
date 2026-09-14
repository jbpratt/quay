/**
 * Per-test W3C trace propagation and on-failure diagnostic attachments
 * (Jaeger spans, Quay logs, Quay config).
 */

import {execFile} from 'child_process';
import {promisify} from 'util';
import {randomBytes} from 'crypto';
import {writeFile} from 'fs/promises';
import {TestInfo, TestStatus} from '@playwright/test';
import {API_URL} from './config';

const execFileAsync = promisify(execFile);

const JAEGER_QUERY_URL =
  process.env.JAEGER_QUERY_URL || 'http://localhost:16686';

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceparent: string;
}

/** Generates a fresh W3C trace id (32 hex chars) and span id (16 hex chars). */
export function newTraceContext(): TraceContext {
  const traceId = randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  return {
    traceId,
    spanId,
    traceparent: `00-${traceId}-${spanId}-01`,
  };
}

/** True only when the test actually failed (not skipped, not an expected failure). */
export function shouldCollect(
  status: TestStatus | undefined,
  expectedStatus: TestStatus,
): boolean {
  return (
    (status === 'failed' || status === 'timedOut') && status !== expectedStatus
  );
}

/** Log query window around a test run, padded on both sides. */
export function logWindow(
  startedAt: Date,
  endedAt: Date,
  padMs = 2000,
): {since: string; until: string} {
  return {
    since: new Date(startedAt.getTime() - padMs).toISOString(),
    until: new Date(endedAt.getTime() + padMs).toISOString(),
  };
}

/** Caps text to the last maxBytes bytes, prefixing a truncation marker if cut. */
export function capTail(text: string, maxBytes: number): string {
  const total = Buffer.byteLength(text);
  if (total <= maxBytes) {
    return text;
  }
  const buf = Buffer.from(text, 'utf8');
  const tail = buf.subarray(buf.length - maxBytes).toString('utf8');
  return `[truncated: kept last ${maxBytes} of ${total} bytes]\n${tail}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Merges two --timestamps-prefixed docker/podman log streams into
 * chronological order. Each line sorts correctly on its RFC3339Nano prefix.
 */
export function interleaveTimestampedLines(
  stdout: string,
  stderr: string,
): string {
  const lines = [...stdout.split('\n'), ...stderr.split('\n')].filter(
    (line) => line.length > 0,
  );
  lines.sort();
  return lines.join('\n');
}

async function fetchJaegerSpans(trace: TraceContext): Promise<string> {
  const url = `${JAEGER_QUERY_URL}/api/traces/${trace.traceId}`;
  let lastErr: unknown = new Error('no spans returned');
  // Quay's BatchSpanProcessor exports every 5s, so the retry budget must
  // span comfortably longer than that.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      await sleep(2000);
    }
    try {
      const res = await fetch(url, {signal: AbortSignal.timeout(5000)});
      const body = await res.text();
      const parsed = JSON.parse(body);
      if (parsed?.data?.[0]?.spans?.length > 0) {
        return body;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function fetchQuayLogs(startedAt: Date, endedAt: Date): Promise<string> {
  const {since, until} = logWindow(startedAt, endedAt);
  const logCmd = process.env.QUAY_LOG_CMD || 'docker logs';
  const container = process.env.QUAY_LOG_CONTAINER || 'quay-quay';
  const [cmd, ...cmdArgs] = logCmd.split(' ');
  const {stdout, stderr} = await execFileAsync(
    cmd,
    [...cmdArgs, '--timestamps', '--since', since, '--until', until, container],
    {timeout: 15000, maxBuffer: 8 * 1024 * 1024},
  );
  return capTail(interleaveTimestampedLines(stdout, stderr), 1024 * 1024);
}

async function fetchQuayConfig(): Promise<string> {
  const res = await fetch(`${API_URL}/config`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`config fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function writeAndAttach(
  testInfo: TestInfo,
  name: string,
  body: string,
  contentType: string,
): Promise<void> {
  const path = testInfo.outputPath(name);
  await writeFile(path, body);
  await testInfo.attach(name, {path, contentType});
}

/**
 * Best-effort attachments for a failed test: Jaeger spans for this test's
 * trace id, Quay container logs for the test window, and the live Quay
 * /config response. Never throws -- attachment failures must not mask the
 * original test failure.
 */
export async function attachFailureArtifacts(
  testInfo: TestInfo,
  trace: TraceContext,
  startedAt: Date,
): Promise<void> {
  const endedAt = new Date();
  const collectors: Array<{name: string; run: () => Promise<void>}> = [
    {
      name: 'server-spans.json',
      run: async () =>
        writeAndAttach(
          testInfo,
          'server-spans.json',
          await fetchJaegerSpans(trace),
          'application/json',
        ),
    },
    {
      name: 'quay-logs.txt',
      run: async () =>
        writeAndAttach(
          testInfo,
          'quay-logs.txt',
          await fetchQuayLogs(startedAt, endedAt),
          'text/plain',
        ),
    },
    {
      name: 'quay-config.json',
      run: async () =>
        writeAndAttach(
          testInfo,
          'quay-config.json',
          await fetchQuayConfig(),
          'application/json',
        ),
    },
  ];

  const results = await Promise.allSettled(collectors.map((c) => c.run()));

  const notCollected = results
    .map((result, i) =>
      result.status === 'rejected'
        ? `not collected: ${collectors[i].name}: ${String(result.reason)}`
        : null,
    )
    .filter((line): line is string => line !== null);

  if (notCollected.length > 0) {
    try {
      await writeAndAttach(
        testInfo,
        'not-collected.txt',
        notCollected.join('\n') + '\n',
        'text/plain',
      );
    } catch {
      // best-effort; nothing to fall back to
    }
  }
}
