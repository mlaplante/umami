# umami SEO/analytics report tooling

Two ways to turn umami data into a custom report from Claude Code, modeled on
[Bruce Clay's GSC + Claude Code workflow](https://searchengineland.com/build-custom-seo-reports-claude-code-google-search-console-477894).

- **`mcp-server/`** — MCP stdio server. Register it in Claude Code and ask
  questions like "top pages last 30 days" in natural language; Claude calls the
  tools itself and renders whatever output you ask for.
- **`scripts/report.mjs`** — one-shot CLI. Logs in, pulls stats / pageviews /
  top URLs / referrers / countries / browsers, and writes a self-contained
  `report.html` (Observable Plot via CDN) to `tools/seo-report/out/`.

Target instance: `https://laplantedevanalytics.netlify.app` (this repo deployed
to Netlify). Auto-discovers your first website via `GET /api/websites`.

## Setup (one-time)

```bash
cd tools/seo-report
cp .env.example .env          # fill in UMAMI_USERNAME / UMAMI_PASSWORD
npm install
```

## Option 2 — CLI report

```bash
npm run report                # last 30 days, all websites picked first one
npm run report -- --days 7    # tweak window
npm run report -- --website-id <uuid>   # pin to a specific website
```

Open the printed `out/report.html` in your browser, or screenshot for a deck.

## Option 1 — MCP server in Claude Code

```bash
claude mcp add umami -- node $(pwd)/tools/seo-report/mcp-server/server.mjs
```

The server reads `.env` from `tools/seo-report/`. Restart Claude Code, then ask:

> "Using the umami tools, show me the top 10 pages and top 10 referrers for the
> last 14 days as a markdown table, then save an Observable Plot HTML report."

Exposed tools: `umami_list_websites`, `umami_stats`, `umami_pageviews`,
`umami_metrics` (type = url / referrer / browser / os / device / country / event).
