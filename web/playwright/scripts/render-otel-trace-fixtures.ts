// Run: cd web && npx ts-node --transpile-only --compiler-options '{"module":"commonjs","esModuleInterop":true}' playwright/scripts/render-otel-trace-fixtures.ts [outDir]
import {writeFileSync, statSync, mkdirSync} from 'node:fs';
import path from 'node:path';

import {renderTraceHtml} from '../utils/otel-trace-html';
import {
  realTrace7Spans,
  makeLargeTrace,
} from '../utils/__fixtures__/otel-trace-fixtures';

function midpointFailedAtMs(traceJson: string): number {
  const spans = JSON.parse(traceJson).data[0].spans as Array<{
    startTime: number;
    duration: number;
  }>;
  const start = Math.min(...spans.map((s) => s.startTime));
  const end = Math.max(...spans.map((s) => s.startTime + s.duration));
  return Math.floor((start + end) / 2 / 1000);
}

function write(outDir: string, fileName: string, html: string): void {
  const outputPath = path.join(outDir, fileName);
  writeFileSync(outputPath, html, 'utf-8');
  const {size} = statSync(outputPath);
  console.log(`${outputPath} (${size} bytes)`);
}

function main(): void {
  const outDir = process.argv[2] ?? '/tmp';
  mkdirSync(outDir, {recursive: true});

  const realTraceId = JSON.parse(realTrace7Spans).data[0].traceID as string;
  const sevenSpanHtml = renderTraceHtml(realTrace7Spans, {
    testTitle: 'signin flow (real 7-span trace)',
    traceId: realTraceId,
    jaegerUrl: `http://localhost:16686/trace/${realTraceId}`,
  });
  write(outDir, 'otel-trace-7-spans.html', sevenSpanHtml);

  const largeTraceJson = makeLargeTrace();
  const largeTraceId = JSON.parse(largeTraceJson).data[0].traceID as string;
  const largeHtml = renderTraceHtml(largeTraceJson, {
    testTitle: 'synthetic large trace (61 spans)',
    traceId: largeTraceId,
    failedAt: midpointFailedAtMs(largeTraceJson),
  });
  write(outDir, 'otel-trace-large.html', largeHtml);
}

main();
