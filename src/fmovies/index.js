const TMDB_API_KEY = 'd131017ccc6e5462a81c9304d21476de';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const DECRYPT_API_URL = 'https://enc-dec.app/api/dec-videasy';

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Connection: 'keep-alive',
};

const PLAYBACK_HEADERS = {
  'User-Agent': REQUEST_HEADERS['User-Agent'],
  Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.fmovies.gd/',
  Origin: 'https://www.fmovies.gd',
  'Sec-Fetch-Dest': 'video',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
};

const SERVERS = [
  {
    name: 'Yoru',
    language: 'Original',
    url: 'https://api.videasy.net/cdn/sources-with-title',
  },
  {
    name: 'Vyse',
    language: 'Hindi',
    url: 'https://api.videasy.net/hdmovie/sources-with-title',
  },
];

function getJson(url) {
  return fetch(url, { headers: REQUEST_HEADERS }).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.json();
  });
}

function getText(url) {
  return fetch(url, { headers: REQUEST_HEADERS }).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.text();
  });
}

function postJson(url, payload) {
  return fetch(url, {
    method: 'POST',
    headers: {
      ...REQUEST_HEADERS,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.json();
  });
}

function fetchMediaDetails(tmdbId, mediaType) {
  const normalizedType = mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
  const url = `${TMDB_BASE_URL}/${normalizedType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;

  return getJson(url).then((data) => ({
    tmdbId: String(data.id || tmdbId),
    mediaType: normalizedType,
    title: normalizedType === 'tv' ? data.name : data.title,
    year: normalizedType === 'tv'
      ? String(data.first_air_date || '').slice(0, 4)
      : String(data.release_date || '').slice(0, 4),
    imdbId: data.external_ids && data.external_ids.imdb_id ? data.external_ids.imdb_id : '',
  }));
}

function buildServerUrl(server, media, season, episode) {
  const params = new URLSearchParams();
  params.set('title', encodeURIComponent(encodeURIComponent(media.title).replace(/\+/g, '%20')));
  params.set('mediaType', media.mediaType);
  params.set('year', media.year || '');
  params.set('tmdbId', media.tmdbId);
  params.set('imdbId', media.imdbId || '');

  if (media.mediaType === 'tv') {
    params.set('seasonId', String(season || 1));
    params.set('episodeId', String(episode || 1));
  }

  return `${server.url}?${params.toString()}`;
}

function decryptPayload(encryptedText, tmdbId) {
  return postJson(DECRYPT_API_URL, { text: encryptedText, id: String(tmdbId) }).then((response) => response.result || {});
}

function normalizeQuality(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return 'Adaptive';
  }

  const upper = raw.toUpperCase();
  if (/^\d{3,4}P$/.test(upper)) {
    return upper;
  }

  if (/^\d{3,4}p$/.test(raw)) {
    return raw;
  }

  if (/hindi/i.test(raw)) {
    return 'Adaptive';
  }

  return raw;
}

function createStream(source, server, media) {
  const quality = normalizeQuality(source.quality);
  const title = media.year ? `${media.title} (${media.year})` : media.title;

  return {
    name: `Fmovies ${server.name} (${server.language}) - ${quality}`,
    title,
    url: source.url,
    quality,
    headers: PLAYBACK_HEADERS,
    provider: 'fmovies',
    language: server.language,
  };
}

function fetchFromServer(server, media, season, episode) {
  return getText(buildServerUrl(server, media, season, episode))
    .then((encryptedText) => {
      if (!encryptedText || !encryptedText.trim()) {
        return [];
      }

      return decryptPayload(encryptedText, media.tmdbId);
    })
    .then((payload) => {
      const sources = Array.isArray(payload && payload.sources) ? payload.sources : [];
      return sources
        .filter((source) => source && typeof source.url === 'string' && source.url.includes('workers.dev'))
        .map((source) => createStream(source, server, media));
    })
    .catch(() => []);
}

function dedupeStreams(streams) {
  const seen = new Set();
  return streams.filter((stream) => {
    if (seen.has(stream.url)) {
      return false;
    }
    seen.add(stream.url);
    return true;
  });
}

function sortStreams(streams) {
  const rank = (quality) => {
    const match = String(quality || '').match(/(\d{3,4})/);
    if (match) {
      return parseInt(match[1], 10);
    }
    if (/adaptive/i.test(String(quality || ''))) {
      return 9999;
    }
    return 0;
  };

  return [...streams].sort((left, right) => rank(right.quality) - rank(left.quality));
}

async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  try {
    const media = await fetchMediaDetails(tmdbId, mediaType);
    const results = await Promise.all(SERVERS.map((server) => fetchFromServer(server, media, season, episode)));
    return sortStreams(dedupeStreams(results.flat()));
  } catch (_error) {
    return [];
  }
}

module.exports = { getStreams };
