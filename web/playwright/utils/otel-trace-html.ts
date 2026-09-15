import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {TestInfo} from '@playwright/test';

/**
 * Call site (phase 1, web/playwright/utils/failure-artifacts.ts
 * attachFailureArtifacts): after server-spans.json is attached, await
 * attachOtelTraceHtml(testInfo, spansResult.body, {testTitle: testInfo.title,
 * traceId: trace.traceId, jaegerUrl: process.env.JAEGER_QUERY_URL &&
 * `${JAEGER_QUERY_URL}/trace/${traceId}`}).
 */

export interface TraceMeta {
  testTitle: string;
  traceId: string;
  jaegerUrl?: string;
  /** epoch ms */
  failedAt?: number;
}

interface JaegerTag {
  key: string;
  type?: string;
  value: unknown;
}

interface JaegerLogField {
  key: string;
  value: unknown;
}

interface JaegerLog {
  timestamp: number;
  fields?: JaegerLogField[];
}

interface JaegerReference {
  refType: string;
  spanID: string;
  traceID?: string;
}

interface JaegerSpan {
  spanID: string;
  operationName: string;
  startTime: number;
  duration: number;
  references?: JaegerReference[];
  tags?: JaegerTag[];
  logs?: JaegerLog[];
  processID: string;
  warnings?: string[] | null;
}

interface JaegerProcess {
  serviceName: string;
  tags?: JaegerTag[];
}

interface JaegerTraceData {
  traceID: string;
  spans?: JaegerSpan[];
  processes?: Record<string, JaegerProcess>;
}

interface JaegerResponse {
  data?: JaegerTraceData[];
}

interface ParsedTrace {
  spans: JaegerSpan[];
  processes: Record<string, JaegerProcess>;
}

interface TreeRow {
  span: JaegerSpan;
  depth: number;
  serviceName: string;
}

export interface CoverageSegment {
  leftPct: number;
  widthPct: number;
}

export interface ChildCoverage {
  fraction: number;
  segments: CoverageSegment[];
}

const PALETTE = [
  '#4f8fd6',
  '#d6824f',
  '#4fd68f',
  '#d64f8f',
  '#8f4fd6',
  '#d6c94f',
];

const BASE_CSS = `
:root { --bg:#ffffff; --fg:#1b1f23; --muted:#6a737d; --border:#d0d7de; --panel-bg:#f6f8fa; --error:#d64545; --link:#0969da; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#0d1117; --fg:#c9d1d9; --muted:#8b949e; --border:#30363d; --panel-bg:#161b22; --error:#f85149; --link:#58a6ff; }
}
* { box-sizing: border-box; }
body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
a { color: var(--link); }
.otel-header h1 { font-size:15px; margin:0 0 4px; }
.otel-meta { color:var(--muted); font-size:12px; }
.otel-meta code { font-family:ui-monospace,monospace; }
.otel-waterfall { position:relative; margin-top:16px; }
.otel-grid-row { display:grid; grid-template-columns:260px 70px 1fr; align-items:center; column-gap:8px; }
.otel-row { cursor:pointer; padding:2px 0; border-left:3px solid transparent; }
.otel-row.error { border-left-color:var(--error); }
.otel-name-cell { display:flex; align-items:center; gap:6px; min-width:0; }
.otel-swatch { width:8px; height:8px; border-radius:2px; flex:0 0 auto; }
.otel-name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.otel-badge { color:var(--error); font-weight:600; font-size:11px; }
.otel-duration { color:var(--muted); font-variant-numeric:tabular-nums; text-align:right; }
.otel-track { position:relative; height:14px; background:var(--panel-bg); border-radius:2px; }
.otel-bar { position:absolute; top:1px; height:12px; min-width:2px; border-radius:2px; }
.otel-details { display:none; margin:4px 0 8px 20px; padding:8px; background:var(--panel-bg); border-radius:4px; font-family:ui-monospace,monospace; font-size:12px; white-space:pre-wrap; }
.otel-details.open { display:block; }
.otel-marker-overlay { position:absolute; inset:0; pointer-events:none; }
.otel-marker-overlay > .otel-grid-row { height:100%; }
.otel-marker-track { position:relative; height:100%; }
.otel-marker-line { position:absolute; top:-16px; bottom:0; border-left:1px dashed var(--error); }
.otel-marker-label { position:absolute; top:-16px; font-size:10px; color:var(--error); white-space:nowrap; transform:translateX(-50%); }
.otel-bar-segment { position:absolute; top:0; height:100%; border-radius:2px; min-width:1px; }
.otel-bar-faint { border:1px dashed rgba(127,127,127,0.65); }
`;

function escapeHtml(value: unknown): string {
  const str = String(value ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeScript(json: string): string {
  return json.replace(/</g, '\\u003c');
}

function page(title: string, bodyHtml: string, scriptSrc: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}</style>
</head>
<body>
${bodyHtml}
<script>${scriptSrc}</script>
</body>
</html>`;
}

function degradedPage(traceId: string, reason: string): string {
  const body = `<p>no spans captured for trace ${escapeHtml(
    traceId || 'unknown',
  )}: ${escapeHtml(reason)}</p>`;
  return page('OTel Trace (no data)', body, '');
}

function parseTrace(serverSpansJson: string): ParsedTrace | null {
  let parsed: JaegerResponse;
  try {
    parsed = JSON.parse(serverSpansJson);
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.data) || parsed.data.length === 0) {
    return null;
  }
  const spans: JaegerSpan[] = [];
  const processes: Record<string, JaegerProcess> = {};
  for (const trace of parsed.data) {
    if (!trace || typeof trace !== 'object') {
      continue;
    }
    if (Array.isArray(trace.spans)) {
      spans.push(...trace.spans);
    }
    if (trace.processes) {
      Object.assign(processes, trace.processes);
    }
  }
  if (spans.length === 0) {
    return null;
  }
  return {spans, processes};
}

function roundPct(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Fraction of span's own duration covered by its direct children, with
 * overlapping/overhanging child intervals merged and clipped to the span's
 * own [startTime, startTime + duration] so coverage can never exceed 1.
 */
export function childCoverage(
  span: JaegerSpan,
  children: JaegerSpan[],
): ChildCoverage {
  if (
    !Number.isFinite(span.duration) ||
    span.duration <= 0 ||
    children.length === 0
  ) {
    return {fraction: 0, segments: []};
  }

  const spanStart = span.startTime;
  const spanEnd = span.startTime + span.duration;
  if (!Number.isFinite(spanStart) || !Number.isFinite(spanEnd)) {
    return {fraction: 0, segments: []};
  }

  const clipped = children
    .filter(
      (child) =>
        Number.isFinite(child.startTime) &&
        Number.isFinite(child.duration) &&
        Number.isFinite(child.startTime + child.duration),
    )
    .map((child): [number, number] => [
      Math.max(child.startTime, spanStart),
      Math.min(child.startTime + child.duration, spanEnd),
    ])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const interval of clipped) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) {
      last[1] = Math.max(last[1], interval[1]);
    } else {
      merged.push(interval);
    }
  }

  const covered = merged.reduce((sum, [start, end]) => sum + (end - start), 0);
  const fraction = Math.min(covered / span.duration, 1);
  const segments: CoverageSegment[] = merged.map(([start, end]) => ({
    leftPct: roundPct(((start - spanStart) / span.duration) * 100),
    widthPct: roundPct(((end - start) / span.duration) * 100),
  }));

  return {fraction, segments};
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildRows(
  spans: JaegerSpan[],
  processes: Record<string, JaegerProcess>,
): {rows: TreeRow[]; directChildrenOf: Map<string, JaegerSpan[]>} {
  const byId = new Map<string, JaegerSpan>();
  for (const span of spans) {
    byId.set(span.spanID, span);
  }

  const childrenOf = new Map<string, JaegerSpan[]>();
  const directChildrenOf = new Map<string, JaegerSpan[]>();
  const roots: JaegerSpan[] = [];

  for (const span of spans) {
    const refs = span.references ?? [];
    const childOfRef = refs.find((r) => r.refType === 'CHILD_OF');
    const parentRef =
      childOfRef ?? refs.find((r) => r.refType === 'FOLLOWS_FROM');
    const parentId = parentRef?.spanID;
    if (parentId && byId.has(parentId)) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(span);
      childrenOf.set(parentId, list);
      if (childOfRef) {
        const direct = directChildrenOf.get(parentId) ?? [];
        direct.push(span);
        directChildrenOf.set(parentId, direct);
      }
    } else {
      roots.push(span);
    }
  }

  const byStart = (a: JaegerSpan, b: JaegerSpan) => a.startTime - b.startTime;
  roots.sort(byStart);
  childrenOf.forEach((list) => list.sort(byStart));
  directChildrenOf.forEach((list) => list.sort(byStart));

  const rows: TreeRow[] = [];
  const visit = (span: JaegerSpan, depth: number) => {
    const serviceName =
      processes[span.processID]?.serviceName ?? span.processID ?? 'unknown';
    rows.push({span, depth, serviceName});
    for (const child of childrenOf.get(span.spanID) ?? []) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots) {
    visit(root, 0);
  }
  return {rows, directChildrenOf};
}

function isErrorSpan(span: JaegerSpan): boolean {
  for (const tag of span.tags ?? []) {
    if (
      tag.key === 'otel.status_code' &&
      String(tag.value).toUpperCase() === 'ERROR'
    ) {
      return true;
    }
    if (
      tag.key === 'error' &&
      (tag.value === true || String(tag.value).toLowerCase() === 'true')
    ) {
      return true;
    }
    if (tag.key === 'http.status_code' && Number(tag.value) >= 500) {
      return true;
    }
  }
  return false;
}

function formatMs(durationUs: number): string {
  return (durationUs / 1000).toFixed(2);
}

function renderFromParsed(parsed: ParsedTrace | null, meta: TraceMeta): string {
  const traceId = meta.traceId;
  if (!parsed) {
    return degradedPage(traceId, '0 spans');
  }

  const {spans, processes} = parsed;
  const {rows, directChildrenOf} = buildRows(spans, processes);
  if (rows.length === 0) {
    return degradedPage(
      traceId,
      `${spans.length} spans, 0 rows after building tree (check for reference cycles)`,
    );
  }

  const traceStart = Math.min(...spans.map((s) => s.startTime));
  const traceEnd = Math.max(...spans.map((s) => s.startTime + s.duration));
  const total = Math.max(traceEnd - traceStart, 1);

  const processOrder: string[] = [];
  for (const row of rows) {
    if (!processOrder.includes(row.span.processID)) {
      processOrder.push(row.span.processID);
    }
  }
  const colorFor = (processId: string) =>
    PALETTE[processOrder.indexOf(processId) % PALETTE.length];

  const serviceList = Array.from(new Set(rows.map((r) => r.serviceName)))
    .sort()
    .join(', ');

  const rowsHtml = rows
    .map((row, rowIndex) => {
      const {span, depth, serviceName} = row;
      const left = ((span.startTime - traceStart) / total) * 100;
      const width = Math.max((span.duration / total) * 100, 0);
      const error = isErrorSpan(span);
      const color = colorFor(span.processID);
      const children = directChildrenOf.get(span.spanID) ?? [];

      let barHtml: string;
      let trackLabel = '';
      if (children.length > 0) {
        const {fraction, segments} = childCoverage(span, children);
        trackLabel = ` aria-label="${roundPct(
          fraction * 100,
        )}% covered by direct child spans"`;
        const segmentsHtml = segments
          .map(
            (seg) =>
              `<div class="otel-bar-segment" style="left:${seg.leftPct}%;width:${seg.widthPct}%;background:${color}"></div>`,
          )
          .join('');
        barHtml = `<div class="otel-bar otel-bar-faint" style="left:${left}%;width:${width}%;background:${hexToRgba(
          color,
          0.35,
        )}">${segmentsHtml}</div>`;
      } else {
        barHtml = `<div class="otel-bar" style="left:${left}%;width:${width}%;background:${color}"></div>`;
      }

      return `<div class="otel-grid-row otel-row${
        error ? ' error' : ''
      }" data-row-index="${rowIndex}" role="button" tabindex="0" aria-expanded="false">
  <div class="otel-name-cell" style="padding-left:${
    depth * 14
  }px" title="${escapeHtml(serviceName)}: ${escapeHtml(span.operationName)}">
    <span class="otel-swatch" style="background:${color}"></span>
    <span class="otel-name">${escapeHtml(span.operationName)}</span>
    ${error ? '<span class="otel-badge">ERROR</span>' : ''}
  </div>
  <div class="otel-duration">${formatMs(span.duration)} ms</div>
  <div class="otel-track"${trackLabel}>${barHtml}</div>
</div>`;
    })
    .join('\n');

  let markerHtml = '';
  if (typeof meta.failedAt === 'number') {
    const failedAtUs = meta.failedAt * 1000;
    if (failedAtUs >= traceStart && failedAtUs <= traceEnd) {
      const pct = ((failedAtUs - traceStart) / total) * 100;
      markerHtml = `<div class="otel-marker-overlay"><div class="otel-grid-row"><div></div><div></div><div class="otel-marker-track"><div class="otel-marker-line" style="left:${pct}%"></div><div class="otel-marker-label" style="left:${pct}%">test failed</div></div></div></div>`;
    }
  }

  const jaegerLink = meta.jaegerUrl
    ? ` &middot; <a href="${escapeHtml(
        meta.jaegerUrl,
      )}" target="_blank" rel="noopener noreferrer">open in Jaeger</a>`
    : '';

  const bodyHtml = `<div class="otel-header">
  <h1>${escapeHtml(meta.testTitle)}</h1>
  <div class="otel-meta">trace <code>${escapeHtml(
    traceId,
  )}</code> &middot; ${formatMs(total)} ms &middot; ${
    rows.length
  } spans &middot; services: ${escapeHtml(serviceList)}${jaegerLink}</div>
  <div class="otel-meta">faint bar = time not covered by direct child spans</div>
</div>
<div class="otel-waterfall">
${markerHtml}
${rowsHtml}
</div>`;

  const dataForScript = {
    spans: rows.map(({span: s}) => ({
      spanID: s.spanID,
      operationName: s.operationName,
      duration: s.duration,
      processID: s.processID,
      tags: s.tags ?? [],
      logs: s.logs ?? [],
      warnings: s.warnings ?? [],
    })),
    processes,
  };
  const scriptSrc = `
const OTEL_TRACE_DATA = ${escapeScript(JSON.stringify(dataForScript))};
function otelFieldsToText(fields) {
  return (fields || []).map(function (f) { return f.key + '=' + JSON.stringify(f.value); }).join(', ');
}
function otelRenderDetails(span, processes) {
  var proc = processes[span.processID];
  var lines = [];
  lines.push('process: ' + (proc ? proc.serviceName : span.processID) + ' (' + span.processID + ')');
  lines.push('spanID: ' + span.spanID);
  lines.push('duration: ' + (span.duration / 1000).toFixed(3) + ' ms');
  if (span.tags && span.tags.length) {
    lines.push('tags:');
    span.tags.forEach(function (t) { lines.push('  ' + t.key + ' = ' + JSON.stringify(t.value)); });
  }
  if (span.logs && span.logs.length) {
    lines.push('logs:');
    span.logs.forEach(function (l) { lines.push('  [' + l.timestamp + '] ' + otelFieldsToText(l.fields)); });
  }
  if (span.warnings && span.warnings.length) {
    lines.push('warnings:');
    span.warnings.forEach(function (w) { lines.push('  ' + w); });
  }
  return lines.join('\\n');
}
function otelToggleRow(row) {
  var idx = row.getAttribute('data-row-index');
  var existing = document.getElementById('details-' + idx);
  if (existing) {
    var open = existing.classList.toggle('open');
    row.setAttribute('aria-expanded', open ? 'true' : 'false');
    return;
  }
  var span = OTEL_TRACE_DATA.spans[idx];
  if (!span) return;
  var panel = document.createElement('pre');
  panel.className = 'otel-details open';
  panel.id = 'details-' + idx;
  panel.textContent = otelRenderDetails(span, OTEL_TRACE_DATA.processes);
  row.insertAdjacentElement('afterend', panel);
  row.setAttribute('aria-expanded', 'true');
}
document.addEventListener('click', function (e) {
  var row = e.target.closest('.otel-row');
  if (!row) return;
  otelToggleRow(row);
});
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var row = e.target.closest && e.target.closest('.otel-row');
  if (!row) return;
  e.preventDefault();
  otelToggleRow(row);
});
`;

  return page(meta.testTitle, bodyHtml, scriptSrc);
}

function safeRenderFromParsed(
  parsed: ParsedTrace | null,
  meta: TraceMeta,
): string {
  try {
    return renderFromParsed(parsed, meta);
  } catch {
    return degradedPage(meta.traceId, 'render error');
  }
}

export function renderTraceHtml(
  serverSpansJson: string,
  meta: TraceMeta,
): string {
  return safeRenderFromParsed(parseTrace(serverSpansJson), meta);
}

export async function attachOtelTraceHtml(
  testInfo: TestInfo,
  serverSpansJson: string,
  meta: TraceMeta,
): Promise<void> {
  try {
    const parsed = parseTrace(serverSpansJson);
    const html = safeRenderFromParsed(parsed, meta);
    const outputPath = testInfo.outputPath('otel-trace.html');
    await mkdir(path.dirname(outputPath), {recursive: true});
    await writeFile(outputPath, html, 'utf-8');
    await testInfo.attach('otel-trace.html', {
      path: outputPath,
      contentType: 'text/html',
    });
    console.log(
      `[otel-trace-html] trace=${meta.traceId} spans=${
        parsed ? parsed.spans.length : 0
      }`,
    );
  } catch (err) {
    console.log(
      `[otel-trace-html] degraded: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
