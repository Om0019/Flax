import axios from 'axios';
import { DEFAULT_HEADERS } from './constants.js';

function mergeHeaders(headers) {
  return { ...DEFAULT_HEADERS, ...(headers || {}) };
}

export async function fetchPage(url, options = {}) {
  const response = await axios({
    url,
    method: options.method || 'GET',
    headers: mergeHeaders(options.headers),
    data: options.body,
    responseType: 'text',
    maxRedirects: 5,
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }
  const headers = {};
  for (const [key, value] of Object.entries(response.headers || {})) {
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  return {
    text: typeof response.data === 'string' ? response.data : String(response.data || ''),
    url: response.request?.res?.responseUrl || response.config?.url || url,
    headers,
  };
}

export async function fetchText(url, options = {}) {
  const page = await fetchPage(url, options);
  return page.text;
}

export async function fetchJson(url, options = {}) {
  const response = await axios({
    url,
    method: options.method || 'GET',
    headers: mergeHeaders({
      Accept: 'application/json,text/plain,*/*',
      ...(options.headers || {}),
    }),
    data: options.body,
    responseType: 'json',
    maxRedirects: 5,
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
  }

  return response.data;
}
