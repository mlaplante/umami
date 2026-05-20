#!/usr/bin/env node
// MCP stdio server exposing umami analytics as tools for Claude Code.
// Register with:
//   claude mcp add umami -- node /absolute/path/to/server.mjs
//
// Tools:
//   umami_list_websites      -> array of {id,name,domain,...}
//   umami_stats              -> totals for a window
//   umami_pageviews          -> timeseries
//   umami_metrics            -> top-N for url/referrer/browser/os/device/country/event/...

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { UmamiClient, pickWebsiteId, resolveWindow } from '../lib/umami-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const client = new UmamiClient({
  baseUrl: process.env.UMAMI_BASE_URL,
  username: process.env.UMAMI_USERNAME,
  password: process.env.UMAMI_PASSWORD,
});

// Resolve the active website once per process; the MCP server is short-lived
// per Claude Code session.
let websiteIdPromise = null;
function getWebsiteId(explicit) {
  if (explicit) return Promise.resolve(explicit);
  if (!websiteIdPromise) {
    websiteIdPromise = pickWebsiteId(client, process.env.UMAMI_WEBSITE_ID || null);
  }
  return websiteIdPromise;
}

function windowFromArgs(args) {
  if (args.startAt && args.endAt) {
    return { startAt: Number(args.startAt), endAt: Number(args.endAt) };
  }
  return resolveWindow(args.days ?? 30);
}

const tools = [
  {
    name: 'umami_list_websites',
    description: 'List websites accessible to the configured umami user.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'umami_stats',
    description:
      'Headline totals (pageviews, visits, visitors, bounces, totaltime) for a window. Use days OR startAt/endAt (unix ms).',
    inputSchema: {
      type: 'object',
      properties: {
        websiteId: { type: 'string', description: 'Optional; defaults to the first website.' },
        days: { type: 'number', description: 'Last N days (default 30).' },
        startAt: { type: 'number' },
        endAt: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'umami_pageviews',
    description: 'Timeseries of pageviews and sessions. Unit defaults to "day".',
    inputSchema: {
      type: 'object',
      properties: {
        websiteId: { type: 'string' },
        days: { type: 'number' },
        startAt: { type: 'number' },
        endAt: { type: 'number' },
        unit: { type: 'string', enum: ['minute', 'hour', 'day', 'month', 'year'] },
        timezone: { type: 'string', description: 'IANA tz (default UTC).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'umami_metrics',
    description:
      'Top-N values for a dimension. Event columns: path, entry, exit, referrer, domain, title, query, event, tag, hostname, utmSource, utmMedium, utmCampaign, utmContent, utmTerm. Session columns: browser, os, device, screen, language, country, city, region. Also: channel.',
    inputSchema: {
      type: 'object',
      properties: {
        websiteId: { type: 'string' },
        type: {
          type: 'string',
          enum: [
            'path', 'entry', 'exit', 'referrer', 'domain', 'title', 'query', 'event', 'tag', 'hostname',
            'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm',
            'browser', 'os', 'device', 'screen', 'language', 'country', 'city', 'region',
            'channel',
          ],
        },
        days: { type: 'number' },
        startAt: { type: 'number' },
        endAt: { type: 'number' },
        limit: { type: 'number', description: 'Default 25.' },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
];

const server = new Server(
  { name: 'umami-seo-report', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async req => {
  const { name, arguments: args = {} } = req.params;
  try {
    const result = await dispatch(name, args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${err?.message ?? String(err)}` }],
    };
  }
});

async function dispatch(name, args) {
  switch (name) {
    case 'umami_list_websites':
      return client.listWebsites();
    case 'umami_stats': {
      const websiteId = await getWebsiteId(args.websiteId);
      return client.stats(websiteId, windowFromArgs(args));
    }
    case 'umami_pageviews': {
      const websiteId = await getWebsiteId(args.websiteId);
      return client.pageviews(websiteId, {
        ...windowFromArgs(args),
        unit: args.unit ?? 'day',
        timezone: args.timezone ?? 'UTC',
      });
    }
    case 'umami_metrics': {
      const websiteId = await getWebsiteId(args.websiteId);
      return client.metrics(websiteId, {
        ...windowFromArgs(args),
        type: args.type,
        limit: args.limit ?? 25,
      });
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

await server.connect(new StdioServerTransport());
