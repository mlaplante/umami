#!/usr/bin/env node
// One-shot CLI: pulls headline stats + a timeseries + top URLs/referrers/
// countries/browsers from umami and emits a self-contained HTML report
// (Observable Plot loaded from CDN). No build step.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import { UmamiClient, pickWebsiteId, resolveWindow } from '../lib/umami-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'out');

function parseArgs(argv) {
  const args = { days: 30, websiteId: process.env.UMAMI_WEBSITE_ID || null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') args.days = Number(argv[++i]);
    else if (a === '--website-id') args.websiteId = argv[++i];
  }
  if (!Number.isFinite(args.days) || args.days <= 0) {
    throw new Error('--days must be a positive number');
  }
  return args;
}

async function main() {
  const { days, websiteId: preferred } = parseArgs(process.argv.slice(2));

  const client = new UmamiClient({
    baseUrl: process.env.UMAMI_BASE_URL,
    username: process.env.UMAMI_USERNAME,
    password: process.env.UMAMI_PASSWORD,
  });

  await client.login();
  const websiteId = await pickWebsiteId(client, preferred);
  const { startAt, endAt } = resolveWindow(days);

  const [stats, pageviews, urls, referrers, countries, browsers] = await Promise.all([
    client.stats(websiteId, { startAt, endAt }),
    client.pageviews(websiteId, { startAt, endAt, unit: 'day' }),
    client.metrics(websiteId, { startAt, endAt, type: 'path', limit: 15 }),
    client.metrics(websiteId, { startAt, endAt, type: 'referrer', limit: 15 }),
    client.metrics(websiteId, { startAt, endAt, type: 'country', limit: 15 }),
    client.metrics(websiteId, { startAt, endAt, type: 'browser', limit: 15 }),
  ]);

  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, 'report.html');
  const dataPath = join(outDir, 'data.json');

  const data = {
    meta: {
      websiteId,
      generatedAt: new Date().toISOString(),
      startAt,
      endAt,
      days,
      baseUrl: process.env.UMAMI_BASE_URL,
    },
    stats,
    pageviews,
    urls,
    referrers,
    countries,
    browsers,
  };

  await writeFile(dataPath, JSON.stringify(data, null, 2));
  await writeFile(reportPath, renderHtml(data));

  console.log(`✔ wrote ${reportPath}`);
  console.log(`✔ wrote ${dataPath}`);
}

function num(v) {
  if (v && typeof v === 'object' && 'value' in v) return v.value ?? 0;
  return Number(v) || 0;
}

function renderHtml(data) {
  const { meta, stats, pageviews, urls, referrers, countries, browsers } = data;
  const dataJson = JSON.stringify({ pageviews, urls, referrers, countries, browsers }).replace(/</g, '\\u003c');
  const fmtRange = `${new Date(meta.startAt).toISOString().slice(0, 10)} → ${new Date(meta.endAt).toISOString().slice(0, 10)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>umami report · ${fmtRange}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
  h1 { margin-bottom: 0; }
  .meta { color: #666; margin-bottom: 2rem; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin: 1rem 0 2rem; }
  .kpi { padding: 1rem; border: 1px solid #ddd; border-radius: 8px; }
  .kpi .label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #888; }
  .kpi .value { font-size: 1.6rem; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0 2rem; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #eee; }
  th { font-weight: 600; color: #444; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  section { margin-bottom: 2.5rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>umami report</h1>
<p class="meta">${meta.baseUrl} · website <code>${meta.websiteId}</code> · ${fmtRange} (${meta.days}d) · generated ${meta.generatedAt}</p>

<div class="kpis">
  <div class="kpi"><div class="label">Pageviews</div><div class="value">${num(stats.pageviews).toLocaleString()}</div></div>
  <div class="kpi"><div class="label">Visits</div><div class="value">${num(stats.visits).toLocaleString()}</div></div>
  <div class="kpi"><div class="label">Visitors</div><div class="value">${num(stats.visitors).toLocaleString()}</div></div>
  <div class="kpi"><div class="label">Bounces</div><div class="value">${num(stats.bounces).toLocaleString()}</div></div>
  <div class="kpi"><div class="label">Total time (s)</div><div class="value">${num(stats.totaltime).toLocaleString()}</div></div>
</div>

<section>
  <h2>Traffic over time</h2>
  <div id="chart"></div>
</section>

<div class="grid">
  <section><h2>Top pages</h2>${tableHtml(urls)}</section>
  <section><h2>Top referrers</h2>${tableHtml(referrers)}</section>
  <section><h2>Top countries</h2>${tableHtml(countries)}</section>
  <section><h2>Top browsers</h2>${tableHtml(browsers)}</section>
</div>

<script type="module">
import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm";
const data = ${dataJson};
const series = (data.pageviews?.pageviews ?? data.pageviews ?? []).map(d => ({
  date: new Date(d.x ?? d.t ?? d.date),
  value: Number(d.y ?? d.value ?? d.pageviews ?? 0),
  series: "Pageviews",
}));
const sessions = (data.pageviews?.sessions ?? []).map(d => ({
  date: new Date(d.x ?? d.t ?? d.date),
  value: Number(d.y ?? d.value ?? d.sessions ?? 0),
  series: "Sessions",
}));
const points = [...series, ...sessions];
const chart = Plot.plot({
  marginLeft: 50,
  height: 280,
  y: { grid: true, label: "count" },
  x: { label: null },
  color: { legend: true },
  marks: [
    Plot.areaY(points, { x: "date", y: "value", fill: "series", fillOpacity: 0.15 }),
    Plot.lineY(points, { x: "date", y: "value", stroke: "series", strokeWidth: 2 }),
    Plot.ruleY([0]),
  ],
});
document.getElementById("chart").append(chart);
</script>
</body>
</html>`;
}

function tableHtml(metric) {
  const rows = Array.isArray(metric) ? metric : (metric?.data ?? []);
  if (!rows.length) return '<p><em>No data.</em></p>';
  const body = rows
    .map(r => {
      const label = r.x ?? r.name ?? r.value ?? '(unknown)';
      const count = num(r.y ?? r.count ?? r.value);
      return `<tr><td>${escapeHtml(String(label))}</td><td class="n">${count.toLocaleString()}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th>Name</th><th class="n">Count</th></tr></thead><tbody>${body}</tbody></table>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
