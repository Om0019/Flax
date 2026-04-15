import { DEFAULT_HEADERS } from './constants.js';
import { getEnvValue } from './env.js';

const cookieJar = new Map();
const REQUEST_TIMEOUT_MS = Math.max(1000, parseInt(getEnvValue('WEBSTREAMER_LATINO_HTTP_TIMEOUT_MS', '15000'), 10) || 15000);

function mergeHeaders(headers) {
  return { ...DEFAULT_HEADERS, ...(headers || {}) };
}

function getCookieHeader(url) {
  const hostname = new URL(url).hostname;
  return cookieJar.get(hostname) || '';
}

function headersToObject(headers) {
  const result = {};
  if (!headers) {
    return result;
  }

  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      result[String(key).toLowerCase()] = String(value);
    });
    return result;
  }

  for (const [key, value] of Object.entries(headers || {})) {
    result[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  return result;
}

function storeCookies(url, headers) {
  const hostname = new URL(url).hostname;
  const existing = cookieJar.get(hostname) || '';
  const cookieMap = new Map();

  if (existing) {
    existing.split(/;\s*/).forEach((pair) => {
      const [name, ...rest] = pair.split('=');
      if (!name || !rest.length) {
        return;
      }
      cookieMap.set(name.trim(), rest.join('=').trim());
    });
  }

  const setCookie = headers?.['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

  cookies.forEach((cookie) => {
    const pair = String(cookie).split(';')[0];
    const [name, ...rest] = pair.split('=');
    if (!name || !rest.length) {
      return;
    }
    cookieMap.set(name.trim(), rest.join('=').trim());
  });

  if (cookieMap.size > 0) {
    cookieJar.set(
      hostname,
      Array.from(cookieMap.entries()).map(([name, value]) => `${name}=${value}`).join('; '),
    );
  }
}

async function issueRequest(url, options = {}) {
  const cookieHeader = getCookieHeader(url);
  const navigationHeaders = {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: mergeHeaders({
      ...navigationHeaders,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(options.headers || {}),
    }),
    body: options.body,
  });

  const text = await response.text();
  const headers = headersToObject(response.headers);
  storeCookies(url, headers);

  return {
    status: response.status,
    statusText: response.statusText || '',
    headers,
    text,
    url: response.url || url,
  };
}

async function warmHost(url, headers) {
  const parsed = new URL(url);
  await issueRequest(parsed.origin, {
    headers: {
      Referer: parsed.origin,
      ...(headers || {}),
    },
  }).catch(() => null);
}

export async function fetchPage(url, options = {}) {
  let response = await issueRequest(url, options);

  if (response.status === 403 && !options._warmed) {
    await warmHost(url, options.headers);
    response = await issueRequest(url, { ...options, _warmed: true });
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }
  return {
    text: response.text,
    url: response.url || url,
    headers: response.headers || {},
  };
}

export async function fetchText(url, options = {}) {
  const page = await fetchPage(url, options);
  return page.text;
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: mergeHeaders({
      Accept: 'application/json,text/plain,*/*',
      ...(options.headers || {}),
    }),
    body: options.body,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  return await response.json();
}
