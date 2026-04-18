const TMDB_API_KEY = 'd131017ccc6e5462a81c9304d21476de';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const BACKEND_BASE_URL = 'https://mznxiwqjdiq00239q.space';
const WASM_HELPER_URL = 'https://xprime.su/_app/immutable/assets/streamhelper_bg.B6MCtTbq.wasm';

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  Connection: 'keep-alive',
};

const PLAYBACK_HEADERS = {
  'User-Agent': REQUEST_HEADERS['User-Agent'],
  Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://xprime.su/',
  Origin: 'https://xprime.su',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
};

const EMBED_SERVERS = [
  { id: 'facile', name: 'Facile' },
  { id: 'lighter', name: 'Lighter' },
];

const MAX_STREAMS_PER_SERVER = 3;

let wasmExports;
let wasmU8;
let wasmView;
let cachedDecoder;
let cachedEncoder;
let cachedEncodeLength = 0;
let helperReadyPromise;

function getDecoder() {
  if (!cachedDecoder) {
    cachedDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
    cachedDecoder.decode();
  }
  return cachedDecoder;
}

function getEncoder() {
  if (!cachedEncoder) {
    cachedEncoder = new TextEncoder();
  }
  return cachedEncoder;
}

function getUint8Memory() {
  if (!wasmU8 || wasmU8.byteLength === 0 || wasmU8.buffer !== wasmExports.memory.buffer) {
    wasmU8 = new Uint8Array(wasmExports.memory.buffer);
  }
  return wasmU8;
}

function getDataView() {
  if (!wasmView || wasmView.buffer !== wasmExports.memory.buffer) {
    wasmView = new DataView(wasmExports.memory.buffer);
  }
  return wasmView;
}

function decodeString(ptr, len) {
  return getDecoder().decode(getUint8Memory().subarray(ptr, ptr + len));
}

function isLikeNone(value) {
  return value === undefined || value === null;
}

function addHeapObject(value) {
  const index = wasmExports.__externref_table_alloc();
  wasmExports.__wbindgen_export_2.set(index, value);
  return index;
}

function handleError(fn, args) {
  try {
    return fn.apply(this, args);
  } catch (error) {
    const index = addHeapObject(error);
    wasmExports.__wbindgen_exn_store(index);
    return undefined;
  }
}

function passStringToWasm(value, malloc, realloc) {
  const encoder = getEncoder();

  if (realloc === undefined) {
    const encoded = encoder.encode(value);
    const ptr = malloc(encoded.length, 1) >>> 0;
    getUint8Memory().subarray(ptr, ptr + encoded.length).set(encoded);
    cachedEncodeLength = encoded.length;
    return ptr;
  }

  let length = value.length;
  let ptr = malloc(length, 1) >>> 0;
  const mem = getUint8Memory();

  let offset = 0;
  while (offset < length) {
    const code = value.charCodeAt(offset);
    if (code > 0x7f) {
      break;
    }
    mem[ptr + offset] = code;
    offset += 1;
  }

  if (offset !== length) {
    if (offset !== 0) {
      value = value.slice(offset);
    }
    ptr = realloc(ptr, length, offset + (value.length * 3), 1) >>> 0;
    const view = getUint8Memory().subarray(ptr + offset, ptr + offset + (value.length * 3));
    const result = typeof encoder.encodeInto === 'function'
      ? encoder.encodeInto(value, view)
      : (() => {
          const encoded = encoder.encode(value);
          view.set(encoded);
          return { written: encoded.length };
        })();
    offset += result.written;
    ptr = realloc(ptr, length, offset, 1) >>> 0;
  }

  cachedEncodeLength = offset;
  return ptr;
}

function takeExternref(index) {
  const value = wasmExports.__wbindgen_export_2.get(index);
  wasmExports.__externref_table_dealloc(index);
  return value;
}

function getWasmImports() {
  return {
    wbg: {
      __wbg_buffer_61b7ce01341d7f88(target) {
        return target.buffer;
      },
      __wbg_call_500db948e69c7330() {
        return handleError(function call(target, thisArg, arg) {
          return target.call(thisArg, arg);
        }, arguments);
      },
      __wbg_call_b0d8e36992d9900d() {
        return handleError(function call(target, thisArg) {
          return target.call(thisArg);
        }, arguments);
      },
      __wbg_crypto_ed58b8e10a292839(target) {
        return target.crypto;
      },
      __wbg_error_7534b8e9a36f1ab4(ptr, len) {
        console.error(decodeString(ptr, len));
      },
      __wbg_getRandomValues_bcb4912f16000dc4() {
        return handleError(function getRandomValues(crypto, array) {
          crypto.getRandomValues(array);
        }, arguments);
      },
      __wbg_msCrypto_0a36e2ec3a343d26(target) {
        return target.msCrypto;
      },
      __wbg_new_3ff5b33b1ce712df(value) {
        return new Uint8Array(value);
      },
      __wbg_new_8a6f238a6ece86ea() {
        return new Error();
      },
      __wbg_newnoargs_fd9e4bf8be2bc16d(ptr, len) {
        return new Function(decodeString(ptr, len));
      },
      __wbg_newwithbyteoffsetandlength_ba35896968751d91(target, offset, len) {
        return new Uint8Array(target, offset >>> 0, len >>> 0);
      },
      __wbg_newwithlength_34ce8f1051e74449(length) {
        return new Uint8Array(length >>> 0);
      },
      __wbg_node_02999533c4ea02e3(target) {
        return target.node;
      },
      __wbg_now_64d0bb151e5d3889() {
        return Date.now();
      },
      __wbg_process_5c1d670bc53614b8(target) {
        return target.process;
      },
      __wbg_randomFillSync_ab2cfe79ebbf2740() {
        return handleError(function randomFillSync(target, array) {
          target.randomFillSync(array);
        }, arguments);
      },
      __wbg_require_79b1e9274cde3c87() {
        return handleError(function getRequire() {
          return module.require;
        }, arguments);
      },
      __wbg_set_23d69db4e5c66a6e(target, source, offset) {
        target.set(source, offset >>> 0);
      },
      __wbg_stack_0ed75d68575b0f3c(arg0, error) {
        const ptr = passStringToWasm(error.stack, wasmExports.__wbindgen_malloc, wasmExports.__wbindgen_realloc);
        const len = cachedEncodeLength;
        getDataView().setInt32(arg0 + 4, len, true);
        getDataView().setInt32(arg0 + 0, ptr, true);
      },
      __wbg_static_accessor_GLOBAL_0be7472e492ad3e3() {
        const value = typeof global === 'undefined' ? null : global;
        return isLikeNone(value) ? 0 : addHeapObject(value);
      },
      __wbg_static_accessor_GLOBAL_THIS_1a6eb482d12c9bfb() {
        const value = typeof globalThis === 'undefined' ? null : globalThis;
        return isLikeNone(value) ? 0 : addHeapObject(value);
      },
      __wbg_static_accessor_SELF_1dc398a895c82351() {
        const value = typeof self === 'undefined' ? null : self;
        return isLikeNone(value) ? 0 : addHeapObject(value);
      },
      __wbg_static_accessor_WINDOW_ae1c80c7eea8d64a() {
        const value = typeof window === 'undefined' ? null : window;
        return isLikeNone(value) ? 0 : addHeapObject(value);
      },
      __wbg_subarray_46adeb9b86949d12(target, start, end) {
        return target.subarray(start >>> 0, end >>> 0);
      },
      __wbg_versions_c71aa1626a93e0a1(target) {
        return target.versions;
      },
      __wbindgen_error_new(ptr, len) {
        return new Error(decodeString(ptr, len));
      },
      __wbindgen_init_externref_table() {
        const table = wasmExports.__wbindgen_export_2;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
      },
      __wbindgen_is_function(value) {
        return typeof value === 'function';
      },
      __wbindgen_is_object(value) {
        return typeof value === 'object' && value !== null;
      },
      __wbindgen_is_string(value) {
        return typeof value === 'string';
      },
      __wbindgen_is_undefined(value) {
        return value === undefined;
      },
      __wbindgen_memory() {
        return wasmExports.memory;
      },
      __wbindgen_string_new(ptr, len) {
        return decodeString(ptr, len);
      },
      __wbindgen_throw(ptr, len) {
        throw new Error(decodeString(ptr, len));
      },
    },
  };
}

async function initWasmHelper() {
  if (wasmExports) {
    return wasmExports;
  }

  if (!helperReadyPromise) {
    helperReadyPromise = (async () => {
      const response = await fetch(WASM_HELPER_URL, { headers: REQUEST_HEADERS });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${WASM_HELPER_URL}`);
      }

      const imports = getWasmImports();
      let instance;

      if (typeof WebAssembly.instantiateStreaming === 'function') {
        try {
          ({ instance } = await WebAssembly.instantiateStreaming(response.clone(), imports));
        } catch (_error) {
          const bytes = await response.arrayBuffer();
          ({ instance } = await WebAssembly.instantiate(bytes, imports));
        }
      } else {
        const bytes = await response.arrayBuffer();
        ({ instance } = await WebAssembly.instantiate(bytes, imports));
      }

      wasmExports = instance.exports;
      wasmView = null;
      wasmU8 = null;
      wasmExports.__wbindgen_start();
      wasmExports.k5r_setup();
      return wasmExports;
    })().catch((error) => {
      helperReadyPromise = null;
      throw error;
    });
  }

  return helperReadyPromise;
}

async function decryptPayload(text) {
  await initWasmHelper();

  let outPtr = 0;
  let outLen = 0;

  try {
    const ptr = passStringToWasm(text, wasmExports.__wbindgen_malloc, wasmExports.__wbindgen_realloc);
    const len = cachedEncodeLength;
    const result = wasmExports.f2v_extract(ptr, len);
    let valuePtr = result[0];
    let valueLen = result[1];

    if (result[3]) {
      valuePtr = 0;
      valueLen = 0;
      throw takeExternref(result[2]);
    }

    outPtr = valuePtr;
    outLen = valueLen;
    return decodeString(valuePtr, valueLen);
  } finally {
    if (outPtr || outLen) {
      wasmExports.__wbindgen_free(outPtr, outLen, 1);
    }
  }
}

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

function buildEmbedListUrl(serverId, media, season, episode) {
  const params = new URLSearchParams();
  params.set('id', media.tmdbId);

  if (media.mediaType === 'tv') {
    params.set('season', String(season || 1));
    params.set('episode', String(episode || 1));
  }

  return `${BACKEND_BASE_URL}/embed/${serverId}?${params.toString()}`;
}

function buildResolveUrl(serverId, entryName, media, season, episode) {
  const params = new URLSearchParams();
  params.set('id', media.tmdbId);
  params.set('name', media.title || '');
  params.set('year', media.year || '');

  if (media.imdbId) {
    params.set('imdb', media.imdbId);
  }

  if (media.mediaType === 'tv') {
    params.set('season', String(season || 1));
    params.set('episode', String(episode || 1));
  }

  params.set('media_type', media.mediaType);

  return `${BACKEND_BASE_URL}/embed/${serverId}/${encodeURIComponent(entryName)}?${params.toString()}`;
}

function normalizeEntryName(name) {
  return String(name || '').trim();
}

function createStream(url, server, index, media) {
  const title = media.year ? `${media.title} (${media.year})` : media.title;

  return {
    name: `XPrime ${server.name} #${index + 1} - Adaptive`,
    title,
    url,
    quality: 'Adaptive',
    headers: PLAYBACK_HEADERS,
    provider: 'xprime',
  };
}

function fetchEmbedEntries(server, media, season, episode) {
  return getJson(buildEmbedListUrl(server.id, media, season, episode))
    .then((entries) => (Array.isArray(entries) ? entries : []))
    .then((entries) => entries
      .filter((entry) => entry && typeof entry.name === 'string' && entry.name.trim())
      .sort((left, right) => {
        if (Boolean(left.dl) === Boolean(right.dl)) {
          return 0;
        }
        return left.dl ? 1 : -1;
      }))
    .catch(() => []);
}

async function resolveEmbed(server, entry, media, season, episode) {
  const encrypted = await getText(buildResolveUrl(server.id, entry.name, media, season, episode));
  if (!encrypted || !encrypted.trim()) {
    return null;
  }

  const decrypted = await decryptPayload(encrypted);
  if (!decrypted || !decrypted.trim()) {
    return null;
  }

  const payload = JSON.parse(decrypted);
  if (!payload || typeof payload.url !== 'string' || !payload.url.startsWith('http')) {
    return null;
  }

  return payload.url;
}

async function fetchFromServer(server, media, season, episode) {
  const entries = await fetchEmbedEntries(server, media, season, episode);
  const streams = [];

  for (const entry of entries) {
    if (streams.length >= MAX_STREAMS_PER_SERVER) {
      break;
    }

    try {
      const url = await resolveEmbed(server, entry, media, season, episode);
      if (url) {
        streams.push(createStream(url, server, streams.length, media));
      }
    } catch (_error) {
      // Skip broken embed entries.
    }
  }

  return streams;
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

async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  try {
    const media = await fetchMediaDetails(tmdbId, mediaType);
    const results = await Promise.all(EMBED_SERVERS.map((server) => fetchFromServer(server, media, season, episode)));
    return dedupeStreams(results.flat());
  } catch (_error) {
    return [];
  }
}

module.exports = { getStreams };
