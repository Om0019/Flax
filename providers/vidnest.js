/**
 * vidnest - Built from src/vidnest/
 * Generated: 2026-04-19T00:17:51.795Z
 */
var __defProp = Object.defineProperty;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};

// src/vidnest/index.js
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var VIDNEST_BASE_URL = "https://first.vidnest.fun";
var VIDNEST_PROXY_URL = "https://vidnest.animanga.fun/proxy";
var PASSPHRASE = "A7kP9mQeXU2BWcD4fRZV+Sg8yN0/M5tLbC1HJQwYe6o=";
var SERVERS = ["hollymoviehd", "primesrc", "ophim", "flixhq", "vidlink", "rogflix"];
var WORKING_HEADERS = {
  "accept": "*/*",
  "accept-encoding": "gzip, deflate, br, zstd",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
  "origin": "https://vidnest.fun",
  "referer": "https://vidnest.fun/",
  "sec-ch-ua": '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36"
};
var PLAYBACK_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Accept": "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  "Connection": "keep-alive",
  "Sec-Fetch-Dest": "video",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
  "DNT": "1"
};
function decryptAesGcm(encryptedB64, passphraseB64) {
  console.log("[Vidnest] Starting AES-GCM decryption via server...");
  const decryptServerUrl = process.env.DECRYPT_SERVER_URL || "https://aesdec.nuvioapp.space/decrypt";
  return fetch(decryptServerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      encryptedData: encryptedB64,
      passphrase: passphraseB64
    })
  }).then((response) => response.json()).then((data) => {
    if (data.error)
      throw new Error(data.error);
    console.log("[Vidnest] Server decryption successful");
    return data.decrypted;
  }).catch((error) => {
    console.error(`[Vidnest] Server decryption failed: ${error.message}`);
    throw error;
  });
}
function validateStreamUrl(url, headers) {
  console.log(`[Vidnest] Validating stream URL: ${url.substring(0, 60)}...`);
  if (url.includes(".m3u8") || url.includes("/streamsvr/") || url.includes("/stream2/")) {
    console.log(`[Vidnest] Skipping validation for HLS/protected stream`);
    return Promise.resolve(true);
  }
  return fetch(url, {
    method: "HEAD",
    headers,
    timeout: 5e3
  }).then((response) => {
    const isValid = response.ok || response.status === 206 || response.status === 302 || response.status === 403;
    console.log(`[Vidnest] URL validation result: ${response.status} - ${isValid ? "VALID" : "INVALID"}`);
    return isValid;
  }).catch((error) => {
    console.log(`[Vidnest] URL validation failed: ${error.message}`);
    if (url.includes(".m3u8") || url.includes("/streamsvr/") || url.includes("/stream2/")) {
      return true;
    }
    return false;
  });
}
function makeRequest(url, options = {}) {
  const defaultHeaders = __spreadValues({}, WORKING_HEADERS);
  return fetch(url, __spreadValues({
    method: options.method || "GET",
    headers: __spreadValues(__spreadValues({}, defaultHeaders), options.headers)
  }, options)).then(function(response) {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  }).catch(function(error) {
    console.error(`[Vidnest] Request failed for ${url}: ${error.message}`);
    throw error;
  });
}
function getTMDBDetails(tmdbId, mediaType) {
  const endpoint = mediaType === "tv" ? "tv" : "movie";
  const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  return makeRequest(url).then(function(response) {
    return response.json();
  }).then(function(data) {
    var _a;
    const title = mediaType === "tv" ? data.name : data.title;
    const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
    const year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;
    return {
      title,
      year,
      imdbId: ((_a = data.external_ids) == null ? void 0 : _a.imdb_id) || null
    };
  });
}
function wrapUrlWithProxy(url) {
  if (url.includes("flashstream.cc") || url.includes("streamsvr/") || url.includes("/pl/") || url.includes("rogflix") || url.includes("lethe399key.com") && url.includes("/stream2/")) {
    let origin = "https://flashstream.cc";
    let referer = "https://flashstream.cc/";
    if (url.includes("lethe399key.com")) {
      origin = "https://lethe399key.com";
      referer = "https://lethe399key.com/";
    }
    const proxyHeaders = {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0",
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.5",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "cross-site",
      "origin": origin,
      "referer": referer
    };
    const encodedUrl = encodeURIComponent(url);
    const encodedHeaders = encodeURIComponent(JSON.stringify(proxyHeaders));
    const proxiedUrl = `${VIDNEST_PROXY_URL}?url=${encodedUrl}&headers=${encodedHeaders}`;
    console.log(`[Vidnest] Wrapping URL through proxy: ${url.substring(0, 60)}...`);
    return proxiedUrl;
  }
  return url;
}
function processVidnestResponse(data, serverName, mediaInfo, seasonNum, episodeNum) {
  const streams = [];
  try {
    console.log(`[Vidnest] Processing response from ${serverName}:`, JSON.stringify(data, null, 2));
    let sources = [];
    if (data.sources && Array.isArray(data.sources)) {
      sources = data.sources;
    } else if (data.streams && Array.isArray(data.streams)) {
      sources = data.streams;
    } else if (data.url && typeof data.url === "string") {
      sources = [{ url: data.url, type: "hls", headers: data.headers, subtitles: data.subtitles }];
    } else if (data.data && typeof data.data === "string") {
      sources = [{ url: data.data, type: "hls", headers: data.headers, provider: data.provider }];
    } else if (data.success && (data.sources || data.streams)) {
      sources = data.sources || data.streams || [];
    }
    if (!Array.isArray(sources) || sources.length === 0) {
      console.log(`[Vidnest] ${serverName}: No sources/streams found in response`);
      return streams;
    }
    sources.forEach((source, index) => {
      if (!source)
        return;
      let videoUrl = source.file || source.url || source.src || source.link;
      if (!videoUrl) {
        console.log(`[Vidnest] ${serverName}: Source ${index} has no video URL`);
        return;
      }
      videoUrl = wrapUrlWithProxy(videoUrl);
      let languageInfo = "";
      if (source.language) {
        languageInfo = ` [${source.language}]`;
      }
      let labelInfo = "";
      if (source.label) {
        labelInfo = ` - ${source.label}`;
      } else if (source.source) {
        labelInfo = ` - ${source.source}`;
      }
      let mediaTitle = mediaInfo.title || "Unknown";
      if (mediaInfo.year) {
        mediaTitle += ` (${mediaInfo.year})`;
      }
      if (seasonNum && episodeNum) {
        mediaTitle = `${mediaInfo.title} S${String(seasonNum).padStart(2, "0")}E${String(episodeNum).padStart(2, "0")}`;
      }
      const quality = "auto";
      streams.push({
        name: `Vidnest ${serverName.charAt(0).toUpperCase() + serverName.slice(1)}${labelInfo}${languageInfo}`,
        title: mediaTitle,
        url: videoUrl,
        quality,
        size: "Unknown",
        provider: "vidnest"
      });
      console.log(`[Vidnest] ${serverName}: Added ${quality}${languageInfo} stream: ${videoUrl.substring(0, 60)}...`);
    });
  } catch (error) {
    console.error(`[Vidnest] Error processing ${serverName} response: ${error.message}`);
  }
  return streams;
}
function fetchFromServer(serverName, mediaType, tmdbId, mediaInfo, seasonNum, episodeNum) {
  console.log(`[Vidnest] Fetching from ${serverName}...`);
  let apiUrl;
  if (mediaType === "tv" && seasonNum && episodeNum) {
    apiUrl = `${VIDNEST_BASE_URL}/${serverName}/${mediaType}/${tmdbId}/${seasonNum}/${episodeNum}`;
  } else {
    apiUrl = `${VIDNEST_BASE_URL}/${serverName}/${mediaType}/${tmdbId}`;
  }
  if (serverName === "flixhq") {
    apiUrl += "?server=upcloud";
  }
  console.log(`[Vidnest] ${serverName} API URL: ${apiUrl}`);
  return makeRequest(apiUrl).then(function(response) {
    return response.text();
  }).then(function(responseText) {
    console.log(`[Vidnest] ${serverName} response length: ${responseText.length} characters`);
    try {
      const data = JSON.parse(responseText);
      if (data.encrypted && data.data) {
        console.log(`[Vidnest] ${serverName}: Detected encrypted response, decrypting...`);
        return decryptAesGcm(data.data, PASSPHRASE).then(function(decryptedText) {
          console.log(`[Vidnest] ${serverName}: Decryption successful`);
          try {
            const decryptedData = JSON.parse(decryptedText);
            return processVidnestResponse(decryptedData, serverName, mediaInfo, seasonNum, episodeNum);
          } catch (parseError) {
            console.error(`[Vidnest] ${serverName}: JSON parse error after decryption: ${parseError.message}`);
            return [];
          }
        });
      } else {
        return processVidnestResponse(data, serverName, mediaInfo, seasonNum, episodeNum);
      }
    } catch (parseError) {
      console.error(`[Vidnest] ${serverName}: Invalid JSON response: ${parseError.message}`);
      return [];
    }
  }).catch(function(error) {
    console.error(`[Vidnest] ${serverName} error: ${error.message}`);
    return [];
  });
}
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  console.log(`[Vidnest] Starting extraction for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === "tv" ? `, S:${seasonNum}E:${episodeNum}` : ""}`);
  return new Promise((resolve, reject) => {
    getTMDBDetails(tmdbId, mediaType).then(function(mediaInfo) {
      console.log(`[Vidnest] TMDB Info: "${mediaInfo.title}" (${mediaInfo.year || "N/A"})`);
      const serverPromises = SERVERS.map((serverName) => {
        return fetchFromServer(serverName, mediaType, tmdbId, mediaInfo, seasonNum, episodeNum);
      });
      return Promise.all(serverPromises).then(function(results) {
        const allStreams = [];
        results.forEach((streams) => {
          allStreams.push(...streams);
        });
        const uniqueStreams = [];
        const seenUrls = /* @__PURE__ */ new Set();
        allStreams.forEach((stream) => {
          if (!seenUrls.has(stream.url)) {
            seenUrls.add(stream.url);
            uniqueStreams.push(stream);
          }
        });
        console.log(`[Vidnest] Validating ${uniqueStreams.length} streams...`);
        const validationPromises = uniqueStreams.map(
          (stream) => validateStreamUrl(stream.url, PLAYBACK_HEADERS).then((isValid) => ({ stream, isValid }))
        );
        return Promise.all(validationPromises).then(function(results2) {
          const validStreams = results2.filter((r) => r.isValid).map((r) => r.stream);
          console.log(`[Vidnest] Filtered ${uniqueStreams.length - validStreams.length} broken links`);
          const getQualityValue = (quality) => {
            const q = quality.toLowerCase().replace(/p$/, "");
            if (q === "4k" || q === "2160")
              return 2160;
            if (q === "1440")
              return 1440;
            if (q === "1080")
              return 1080;
            if (q === "720")
              return 720;
            if (q === "480")
              return 480;
            if (q === "360")
              return 360;
            if (q === "240")
              return 240;
            if (q === "unknown")
              return 0;
            const numQuality = parseInt(q);
            if (!isNaN(numQuality) && numQuality > 0) {
              return numQuality;
            }
            return 1;
          };
          validStreams.sort((a, b) => {
            const qualityA = getQualityValue(a.quality);
            const qualityB = getQualityValue(b.quality);
            return qualityB - qualityA;
          });
          console.log(`[Vidnest] Total valid streams found: ${validStreams.length}`);
          resolve(validStreams);
        });
      });
    }).catch(function(error) {
      console.error(`[Vidnest] Error fetching media details: ${error.message}`);
      resolve([]);
    });
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
