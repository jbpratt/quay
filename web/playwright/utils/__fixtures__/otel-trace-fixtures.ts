import realTrace7SpansData from './jaeger-trace-7-spans.json';

/** Real 7-span Jaeger /api/traces/{id} response captured from the spike (qu-9hpz). */
export const realTrace7Spans: string = JSON.stringify(realTrace7SpansData);

const TRACE_ID = 'b'.repeat(32);
const BASE_START_US = 1700000000000000;

interface SyntheticTag {
  key: string;
  type: string;
  value: string | number | boolean;
}

interface SyntheticLogField {
  key: string;
  value: string;
}

interface SyntheticLog {
  timestamp: number;
  fields: SyntheticLogField[];
}

interface SyntheticSpan {
  traceID: string;
  spanID: string;
  operationName: string;
  references: Array<{refType: string; traceID: string; spanID: string}>;
  startTime: number;
  duration: number;
  tags: SyntheticTag[];
  logs: SyntheticLog[];
  processID: string;
  warnings: string[] | null;
}

function spanId(index: number): string {
  return index.toString(16).padStart(16, '0');
}

/**
 * Synthetic Jaeger trace: 1 root, 6 level-1, 18 level-2, 18 level-3, 18
 * level-4 spans (61 total, nesting depth 4), alternating between two
 * processes, with exactly one ERROR span carrying a log event. All
 * timestamps are deterministic (no randomness).
 */
export function makeLargeTrace(): string {
  const spans: SyntheticSpan[] = [];
  let index = 0;

  const makeSpan = (
    parentId: string | undefined,
    opName: string,
  ): SyntheticSpan => {
    const id = spanId(index);
    const processID = index % 2 === 0 ? 'p1' : 'p2';
    const span: SyntheticSpan = {
      traceID: TRACE_ID,
      spanID: id,
      operationName: opName,
      references: parentId
        ? [{refType: 'CHILD_OF', traceID: TRACE_ID, spanID: parentId}]
        : [],
      startTime: BASE_START_US + index * 1000,
      duration: 1000 + (index % 7) * 137,
      tags: [
        {
          key: 'span.kind',
          type: 'string',
          value: index % 2 === 0 ? 'server' : 'client',
        },
      ],
      logs: [],
      processID,
      warnings: null,
    };
    index += 1;
    spans.push(span);
    return span;
  };

  const root = makeSpan(undefined, 'root-operation');

  const level1 = Array.from({length: 6}, (_, i) =>
    makeSpan(root.spanID, `level1-op-${i}`),
  );

  const level2 = level1.flatMap((parent, pi) =>
    Array.from({length: 3}, (_, i) =>
      makeSpan(parent.spanID, `level2-op-${pi}-${i}`),
    ),
  );

  const level3 = level2.map((parent, i) =>
    makeSpan(parent.spanID, `level3-op-${i}`),
  );

  level3.forEach((parent, i) => makeSpan(parent.spanID, `level4-op-${i}`));

  const errorSpan = spans[Math.floor(spans.length / 2)];
  errorSpan.tags.push({
    key: 'otel.status_code',
    type: 'string',
    value: 'ERROR',
  });
  errorSpan.logs.push({
    timestamp: errorSpan.startTime + Math.floor(errorSpan.duration / 2),
    fields: [
      {key: 'event', value: 'exception'},
      {key: 'exception.message', value: 'synthetic failure for test fixture'},
    ],
  });

  const trace = {
    data: [
      {
        traceID: TRACE_ID,
        spans,
        processes: {
          p1: {serviceName: 'quay', tags: []},
          p2: {serviceName: 'postgres', tags: []},
        },
        warnings: null,
      },
    ],
    total: 0,
    limit: 0,
    offset: 0,
    errors: null,
  };

  return JSON.stringify(trace);
}
