// Minimal umami v2 API client for self-hosted instances.
// Auth: POST /api/auth/login -> { token }; use Authorization: Bearer <token>.

export class UmamiClient {
  constructor({ baseUrl, username, password }) {
    if (!baseUrl) throw new Error('UMAMI_BASE_URL is required');
    if (!username || !password) {
      throw new Error('UMAMI_USERNAME and UMAMI_PASSWORD are required');
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.username = username;
    this.password = password;
    this.token = null;
  }

  async login() {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    if (!res.ok) {
      throw new Error(`umami login failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    this.token = data.token;
    return data;
  }

  async #get(path, params) {
    if (!this.token) await this.login();
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new Error(`umami GET ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  listWebsites() {
    return this.#get('/api/websites');
  }

  // startAt/endAt are unix ms.
  stats(websiteId, { startAt, endAt }) {
    return this.#get(`/api/websites/${websiteId}/stats`, { startAt, endAt });
  }

  pageviews(websiteId, { startAt, endAt, unit = 'day', timezone = 'UTC' }) {
    return this.#get(`/api/websites/${websiteId}/pageviews`, {
      startAt,
      endAt,
      unit,
      timezone,
    });
  }

  // type: url | referrer | browser | os | device | country | region | city | event | title | host
  metrics(websiteId, { startAt, endAt, type, limit = 25 }) {
    return this.#get(`/api/websites/${websiteId}/metrics`, {
      startAt,
      endAt,
      type,
      limit,
    });
  }
}

export function resolveWindow(days = 30) {
  const endAt = Date.now();
  const startAt = endAt - days * 24 * 60 * 60 * 1000;
  return { startAt, endAt };
}

export async function pickWebsiteId(client, preferred) {
  if (preferred) return preferred;
  const res = await client.listWebsites();
  const items = Array.isArray(res) ? res : (res.data ?? []);
  if (!items.length) throw new Error('No websites returned from /api/websites');
  return items[0].id;
}
