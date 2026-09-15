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

export interface CollectJaegerSpansOptions {
  queryUrl?: string;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  // Quay's BatchSpanProcessor exports every 5s, so the retry budget must
  // span comfortably longer than that.
  deadlineMs?: number;
  attemptTimeoutMs?: number;
  retryDelayMs?: number;
}

export type CollectJaegerSpansResult =
  | {ok: true; body: string}
  | {ok: false; reason: string};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Fetches Jaeger spans for a trace, retrying until deadlineMs elapses. Never throws. */
export async function collectJaegerSpans(
  traceId: string,
  opts: CollectJaegerSpansOptions = {},
): Promise<CollectJaegerSpansResult> {
  const {
    queryUrl,
    fetchFn = fetch,
    sleepFn = sleep,
    deadlineMs = 8000,
    attemptTimeoutMs = 2000,
    retryDelayMs = 1000,
  } = opts;

  if (!queryUrl) {
    return {ok: false, reason: 'JAEGER_QUERY_URL unset'};
  }

  const url = `${queryUrl}/api/traces/${traceId}`;
  const deadline = Date.now() + deadlineMs;
  const noSpansReason = `no spans for trace ${traceId} (likely cause: requests made without the per-test traceparent header, e.g. a spec-local request context, are not attributable)`;
  let lastReason = noSpansReason;

  for (;;) {
    try {
      const res = await fetchFn(url, {
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      const body = await res.text();
      try {
        const parsed = JSON.parse(body);
        const spans = parsed?.data?.[0]?.spans;
        if (Array.isArray(spans) && spans.length > 0) {
          return {ok: true, body};
        }
        lastReason = noSpansReason;
      } catch (err) {
        lastReason = `malformed response: ${errMessage(err)}`;
      }
    } catch (err) {
      lastReason = `unreachable: ${errMessage(err)}`;
    }

    if (Date.now() >= deadline) {
      return {ok: false, reason: lastReason};
    }
    await sleepFn(retryDelayMs);
  }
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
 * original test failure, and every degraded collector becomes a line in
 * not-collected.txt instead.
 */
export async function attachFailureArtifacts(
  testInfo: TestInfo,
  trace: TraceContext,
  startedAt: Date,
): Promise<void> {
  try {
    const endedAt = new Date();
    const otherCollectors: Array<{name: string; run: () => Promise<void>}> = [
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

    const [spansResult, otherResults] = await Promise.all([
      collectJaegerSpans(trace.traceId, {
        queryUrl: process.env.JAEGER_QUERY_URL,
      }),
      Promise.allSettled(otherCollectors.map((c) => c.run())),
    ]);

    const attached: string[] = [];
    const notCollected: Array<{name: string; reason: string}> = [];

    if (spansResult.ok === true) {
      await writeAndAttach(
        testInfo,
        'server-spans.json',
        spansResult.body,
        'application/json',
      );
      attached.push('server-spans.json');
    } else {
      notCollected.push({
        name: 'server-spans.json',
        reason: spansResult.reason,
      });
    }

    otherResults.forEach((result, i) => {
      const name = otherCollectors[i].name;
      if (result.status === 'fulfilled') {
        attached.push(name);
      } else {
        notCollected.push({name, reason: String(result.reason)});
      }
    });

    if (notCollected.length > 0) {
      try {
        const body =
          notCollected
            .map((c) => `${c.name}: not collected: ${c.reason}`)
            .join('\n') + '\n';
        await writeAndAttach(testInfo, 'not-collected.txt', body, 'text/plain');
        attached.push('not-collected.txt');
      } catch {
        // best-effort; nothing to fall back to
      }
    }

    console.log(
      `[failure-artifacts] trace=${trace.traceId} attached=[${attached.join(
        ',',
      )}] not-collected=[${notCollected.map((c) => c.name).join(',')}]`,
    );
  } catch (err) {
    // best-effort diagnostics must never affect the test outcome, but still
    // leave one line so a debugger knows the machinery ran and failed
    console.log(
      `[failure-artifacts] trace=${trace.traceId} failed: ${errMessage(err)}`,
    );
  }
}
