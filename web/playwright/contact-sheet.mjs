#!/usr/bin/env node
// Usage: node playwright/contact-sheet.mjs <beforeDir> <afterDir> <out.html>
// Pairs PNGs by filename into a before/after HTML grid and screenshots it to
// <out>.png. Dev-only companion to playwright/design/capture.spec.ts.
import fs from 'fs';
import path from 'path';
import {pathToFileURL} from 'url';
import {chromium} from '@playwright/test';

const [beforeDir, afterDir, out] = process.argv.slice(2);
if (!beforeDir || !afterDir || !out) {
  console.error(
    'Usage: node playwright/contact-sheet.mjs <beforeDir> <afterDir> <out.html>',
  );
  process.exit(1);
}

for (const dir of [beforeDir, afterDir]) {
  if (!fs.existsSync(dir)) {
    console.error(`No such directory: ${dir}`);
    process.exit(1);
  }
}

const pngs = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
const names = [...new Set([...pngs(beforeDir), ...pngs(afterDir)])].sort();

const escape = (s) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c],
  );
const cell = (dir, name) => {
  const file = path.join(dir, name);
  return fs.existsSync(file)
    ? `<td><img src="${escape(pathToFileURL(path.resolve(file)).href)}"></td>`
    : '<td class="missing">missing</td>';
};

const rows = names
  .map(
    (name) =>
      `<tr><th>${escape(name)}</th>${cell(beforeDir, name)}${cell(
        afterDir,
        name,
      )}</tr>`,
  )
  .join('\n');

fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true});
fs.writeFileSync(
  out,
  `<!doctype html>
<meta charset="utf-8">
<title>Contact sheet</title>
<style>
  body { font-family: sans-serif; margin: 16px; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th, td { border: 1px solid #ccc; padding: 8px; vertical-align: top; }
  th:first-child { width: 200px; text-align: left; word-break: break-all; }
  img { width: 100%; }
  .missing { color: #c9190b; text-align: center; }
</style>
<table>
<tr><th>name</th><th>before: ${escape(beforeDir)}</th><th>after: ${escape(
    afterDir,
  )}</th></tr>
${rows}
</table>
`,
);

const png = out.replace(/\.html?$/, '') + '.png';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport: {width: 1600, height: 900}});
  await page.goto(pathToFileURL(path.resolve(out)).href);
  await page.screenshot({path: png, fullPage: true});
} finally {
  await browser.close();
}
console.log(`Wrote ${out} and ${png} (${names.length} rows)`);
