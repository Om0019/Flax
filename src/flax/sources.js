import cheerio from 'cheerio-without-node-native';
import { DEFAULT_SOURCE_TIMEOUT_MS, SOURCE_BASES } from './constants.js';
import { fetchJson, fetchPage, fetchText } from './http.js';
import { getEnvValue } from './env.js';
import { buildEpisodeTag } from './tmdb.js';
import { normalizeTitle, uniqueBy } from './utils.js';

function encodeBase64(value) {
  const input = String(value || '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input).toString('base64');
  }
  if (typeof btoa === 'function') {
    return btoa(input);
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  let index = 0;

  while (index < input.length) {
    const chr1 = input.charCodeAt(index++);
    const chr2 = input.charCodeAt(index++);
    const chr3 = input.charCodeAt(index++);
    const enc1 = chr1 >> 2;
    const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
    let enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
    let enc4 = chr3 & 63;

    if (Number.isNaN(chr2)) {
      enc3 = 64;
      enc4 = 64;
    } else if (Number.isNaN(chr3)) {
      enc4 = 64;
    }

    output += chars.charAt(enc1) + chars.charAt(enc2) + chars.charAt(enc3) + chars.charAt(enc4);
  }

  return output;
}

function languageMeta(kind) {
  return kind === 'mx'
    ? { language: 'Latino', contentLanguage: 'es-mx' }
    : { language: 'Castellano', contentLanguage: 'es-es' };
}

function buildTitle(tmdb, season, episode) {
  if (tmdb.mediaType === 'tv' && season && episode) {
    return `${tmdb.title} ${buildEpisodeTag(season, episode)}`;
  }

  return tmdb.year ? `${tmdb.title} (${tmdb.year})` : tmdb.title;
}

function buildSearchTerms(...values) {
  const terms = new Set();

  for (const value of values) {
    const term = typeof value === 'string' ? value.trim() : '';
    if (!term) {
      continue;
    }

    terms.add(term);

    const stripped = term.replace(/^(the|a|an)\s+/i, '').trim();
    if (stripped && stripped !== term) {
      terms.add(stripped);
    }
  }

  return [...terms];
}

function getTmdbTitleCandidates(tmdb) {
  if (Array.isArray(tmdb?._searchTitleCandidates) && tmdb._searchTitleCandidates.length) {
    return uniqueBy(
      tmdb._searchTitleCandidates
        .map((value) => String(value || '').trim())
        .filter(Boolean),
      (value) => normalizeTitle(value)
    );
  }

  return uniqueBy(
    [
      tmdb?.title,
      ...(Array.isArray(tmdb?.translatedTitles) ? tmdb.translatedTitles : []),
      tmdb?.originalTitle,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean),
    (value) => normalizeTitle(value)
  );
}

function buildFallbackEnglishTmdb(tmdb) {
  const fallbackCandidates = uniqueBy(
    [
      tmdb?.originalTitle,
      tmdb?.title,
      ...(Array.isArray(tmdb?.translatedTitles) ? tmdb.translatedTitles : []),
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean),
    (value) => normalizeTitle(value)
  );

  return {
    ...tmdb,
    _searchTitleCandidates: fallbackCandidates,
  };
}

function buildTmdbSearchTerms(tmdb, ...extraValues) {
  return buildSearchTerms(...extraValues, ...getTmdbTitleCandidates(tmdb));
}

function firstTruthySettled(settledResults) {
  for (const item of settledResults) {
    if (item.status === 'fulfilled' && item.value) {
      return item.value;
    }
  }

  return null;
}

const DEFAULT_SOURCE_TIMEOUTS_MS = {
  'cuevana-api': 2200,
  cuevana: 2200,
  cinecalidad: 2200,
  tioplus: 2200,
  gnulahd: 1200,
  homecine: 1000,
  verpeliculasultra: 800,
};

function getSourceTimeoutMs(label) {
  const envKey = `WEBSTREAMER_LATINO_SOURCE_TIMEOUT_${String(label || '').replace(/[^A-Z0-9]/gi, '_').toUpperCase()}`;
  const fallback = DEFAULT_SOURCE_TIMEOUTS_MS[label] || DEFAULT_SOURCE_TIMEOUT_MS;
  return Math.max(
    1000,
    parseInt(getEnvValue(envKey, String(fallback)), 10) || fallback
  );
}

function scoreTmdbCandidate(tmdb, rawTitle, matchedYear) {
  return getTmdbTitleCandidates(tmdb).reduce((best, candidate) => (
    Math.max(best, scoreSearchCandidate(candidate, rawTitle, tmdb.year, matchedYear))
  ), 0);
}

function slugifyCuevanaApi(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['".:!?(),[\]{}]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function scoreSearchCandidate(targetTitle, rawTitle, expectedYear, matchedYear) {
  const targetNorm = normalizeTitle(targetTitle);
  const rawNorm = normalizeTitle(rawTitle);
  const expectedYearNumber = Number.parseInt(expectedYear, 10);
  const matchedYearNumber = Number.parseInt(matchedYear, 10);
  let score = 0;

  if (!targetNorm || !rawNorm) {
    return score;
  }

  if (rawNorm === targetNorm) {
    score += 10;
  } else if (rawNorm.includes(targetNorm) || targetNorm.includes(rawNorm)) {
    score += 5;
  }

  if (Number.isFinite(expectedYearNumber) && Number.isFinite(matchedYearNumber)) {
    if (matchedYearNumber === expectedYearNumber) {
      score += 4;
    } else {
      score -= 3;
    }
  } else if (!Number.isFinite(expectedYearNumber) && Number.isFinite(matchedYearNumber)) {
    score += 1;
  }

  return score;
}

function extractCineCalidadCardTitle($, el) {
  const candidates = [
    $(el).find('.in_title').first().text(),
    $(el).find('img[alt]').first().attr('alt'),
    $(el).find('.title, h2, h3').first().text(),
  ];

  for (const candidate of candidates) {
    const value = String(candidate || '').replace(/\s+/g, ' ').trim();
    if (value) {
      return value;
    }
  }

  return '';
}

function inferBlockedLatinoPlayer(value) {
  const text = String(value || '').toLowerCase();

  if (text.includes('supervideo')) return 'SuperVideo';
  if (text.includes('dropload') || text.includes('dr0pstream')) return 'Dropload';
  if (text.includes('vudeo')) return 'Vudeo';
  if (text.includes('waaw') || text.includes('vidora')) return 'Vidora';
  if (text.includes('vidsonic')) return 'VidSonic';
  if (text.includes('plustream')) return 'Plustream';

  return null;
}

function isBlockedLatinoResult(result) {
  if (!result) {
    return true;
  }

  return Boolean(
    inferBlockedLatinoPlayer(result.player)
    || inferBlockedLatinoPlayer(result.url)
    || inferBlockedLatinoPlayer(result.referer)
  );
}

function appendLatinoResult(results, result) {
  if (!isBlockedLatinoResult(result)) {
    results.push(result);
  }
}

export async function getLatinoSourceResults(tmdb, mediaType, season, episode) {
  const flattenSettledResults = (settled) => (
    settled.flatMap((result) => {
      if (result.status === 'fulfilled') {
        return result.value.filter((entry) => !isBlockedLatinoResult(entry));
      }

      console.error('[Flax] Source error:', result.reason ? result.reason.message : result.reason);
      return [];
    })
  );

  const normalizedMediaType = tmdb.mediaType || (mediaType === 'series' ? 'tv' : mediaType);
  const disabled = new Set(
    String(getEnvValue('WEBSTREAMER_LATINO_DISABLED_SOURCES', ''))
      .split(',')
      .map(v => v.trim().toLowerCase())
      .filter(Boolean),
  );
  const withTimeout = async (label, promise, timeoutMs = getSourceTimeoutMs(label)) => {
    let timeoutId;
    try {
      return await Promise.race([
        promise,
        new Promise(resolve => {
          timeoutId = setTimeout(() => {
            console.warn(`[Flax] Source timed out after ${timeoutMs}ms: ${label}`);
            resolve([]);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  };

  const runSourceSearch = async (searchTmdb) => {
    const cuevanaApiTask = !disabled.has('cuevana-api')
      ? withTimeout('cuevana-api', searchCuevanaApi(searchTmdb, normalizedMediaType, season, episode))
      : Promise.resolve([]);

    const secondaryTasks = [
      !disabled.has('cinecalidad') && withTimeout('cinecalidad', searchCineCalidad(searchTmdb, normalizedMediaType, season, episode)),
      !disabled.has('gnulahd') && withTimeout('gnulahd', searchGnulaHd(searchTmdb, normalizedMediaType, season, episode)),
      !disabled.has('homecine') && withTimeout('homecine', searchHomeCine(searchTmdb, season, episode)),
      !disabled.has('tioplus') && withTimeout('tioplus', searchTioPlus(searchTmdb, normalizedMediaType, season, episode)),
    ].filter(Boolean);

    const [cuevanaApiResults, secondarySettled] = await Promise.all([
      cuevanaApiTask,
      Promise.allSettled(secondaryTasks),
    ]);
    const secondaryResults = flattenSettledResults(secondarySettled);

    if (cuevanaApiResults.length > 0 || disabled.has('cuevana')) {
      return cuevanaApiResults.concat(secondaryResults);
    }

    const cuevanaResults = await withTimeout('cuevana', searchCuevana(searchTmdb, season, episode))
      .catch((error) => {
        console.error('[Flax] Source error:', error ? error.message : error);
        return [];
      });

    return cuevanaResults.concat(secondaryResults);
  };

  const primaryResults = await runSourceSearch(tmdb);
  if (primaryResults.length > 0) {
    return primaryResults;
  }

  const fallbackTmdb = buildFallbackEnglishTmdb(tmdb);
  const primaryCandidates = getTmdbTitleCandidates(tmdb);
  const fallbackCandidates = getTmdbTitleCandidates(fallbackTmdb);

  if (primaryCandidates.join('|') === fallbackCandidates.join('|')) {
    return primaryResults;
  }

  console.log(`[Flax] No streams found with primary titles, retrying with original title order: ${fallbackCandidates.join(' | ')}`);
  return runSourceSearch(fallbackTmdb);
}

async function searchCuevanaApi(tmdb, mediaType, season, episode) {
  const postId = await findCuevanaApiPostId(tmdb);
  if (!postId) {
    return [];
  }

  if (mediaType === 'tv' && season && episode) {
    return searchCuevanaApiEpisode(tmdb, postId, season, episode);
  }

  return searchCuevanaApiMovie(tmdb, postId, mediaType);
}

async function findCuevanaApiPostId(tmdb) {
  const year = String(tmdb.year || '').trim();
  const slugCandidates = uniqueBy(
    buildTmdbSearchTerms(tmdb).flatMap((term) => {
      const base = slugifyCuevanaApi(term);
      if (!base) {
        return [];
      }

      return year ? [base, `${base}-${year}`] : [base];
    }),
    (value) => value
  );

  const settled = await Promise.allSettled(slugCandidates.map(async (slug) => {
    const lookupUrl = `${SOURCE_BASES.cuevanaApi}/get_post_id/${encodeURIComponent(slug)}`;
    const payload = await fetchJson(lookupUrl, {
      headers: { Referer: 'https://cue.cuevana3.nu/' },
    }).catch(() => null);
    const postId = parseInt(payload?.data, 10);

    return postId || null;
  }));

  return firstTruthySettled(settled);
}

function normalizeCuevanaApiAudio(audio) {
  const value = String(audio || '').toLowerCase();

  if (value.includes('latin')) {
    return languageMeta('mx');
  }

  if (value.includes('cast') || value.includes('spanish') || value.includes('espanol')) {
    return languageMeta('es');
  }

  return null;
}

function mapCuevanaApiEmbeds(tmdb, embeds, referer, season, episode) {
  const results = [];

  (Array.isArray(embeds) ? embeds : []).forEach((embed) => {
    const language = normalizeCuevanaApiAudio(embed?.audio);
    const rawUrl = String(embed?.url || '').trim();
    if (!language || !rawUrl) {
      return;
    }

    appendLatinoResult(results, {
      source: 'CuevanaAPI',
      ...language,
      title: buildTitle(tmdb, season, episode),
      url: rawUrl.replace(/^(https:)?\/\//, 'https://'),
      referer,
      headers: { Referer: referer },
    });
  });

  return results;
}

async function searchCuevanaApiEpisode(tmdb, postId, season, episode) {
  const endpoint = `${SOURCE_BASES.cuevanaApi}/episode/${postId}/${parseInt(season, 10)}/${parseInt(episode, 10)}`;
  const payload = await fetchJson(endpoint, {
    headers: { Referer: 'https://cue.cuevana3.nu/' },
  }).catch(() => null);

  if (!payload?.data) {
    return [];
  }

  const refererSlug = payload.data.slug
    ? `https://cue.cuevana3.nu${payload.data.slug}`
    : 'https://cue.cuevana3.nu/';

  return mapCuevanaApiEmbeds(tmdb, payload.data.embeds, refererSlug, season, episode);
}

async function searchCuevanaApiMovie(tmdb, postId, mediaType) {
  if (mediaType !== 'movie') {
    return [];
  }

  const payload = await fetchJson(`${SOURCE_BASES.cuevanaApi}/player/${postId}`, {
    headers: { Referer: 'https://cue.cuevana3.nu/' },
  }).catch(() => null);

  if (!payload?.data?.embeds) {
    return [];
  }

  return mapCuevanaApiEmbeds(
    tmdb,
    payload.data.embeds,
    `https://cue.cuevana3.nu/peliculas-online/${postId}/`,
    null,
    null
  );
}

async function searchCuevana(tmdb, season, episode) {
  const searchTerms = buildTmdbSearchTerms(tmdb);
  const settled = await Promise.allSettled(searchTerms.map(async (searchTerm) => {
    const searchUrl = `${SOURCE_BASES.cuevana}/search/${encodeURIComponent(searchTerm)}/`;
    const html = await fetchText(searchUrl, {
      headers: { Referer: SOURCE_BASES.cuevana },
    });
    const $ = cheerio.load(html);
    const resultCards = $('.MovieList.Rows > li .TPost');

    if (!resultCards.length) {
      return null;
    }

    let bestPath = null;
    let bestScore = -1;

    resultCards.each((_, card) => {
      const title = $(card).find('.Title').first().text().trim();
      const href = $(card).find('a[href]').first().attr('href');
      if (!href) {
        return;
      }

      const year = $(card).find('.Year, .Date').first().text().trim();
      const score = Math.max(
        scoreSearchCandidate(searchTerm, title, tmdb.year, year),
        scoreTmdbCandidate(tmdb, title, year)
      );

      if (score > bestScore) {
        bestScore = score;
        bestPath = href;
      }
    });

    return bestPath && bestScore >= 5
      ? { pagePath: bestPath, score: bestScore }
      : null;
  }));

  const pageResult = settled
    .filter((item) => item.status === 'fulfilled' && item.value)
    .map((item) => item.value)
    .sort((a, b) => b.score - a.score)[0] || null;

  if (!pageResult?.pagePath) {
    return [];
  }

  let pageUrl = new URL(pageResult.pagePath, SOURCE_BASES.cuevana);

  if (tmdb.mediaType === 'tv' && season && episode) {
    const episodeHtml = await fetchText(pageUrl.href, {
      headers: { Referer: pageUrl.origin },
    });
    const $$ = cheerio.load(episodeHtml);
    const episodePath = $$('.TPost .Year')
      .filter((_, el) => $$(el).text().trim() === `${season}x${episode}`)
      .closest('a')
      .attr('href');

    if (!episodePath) {
      return [];
    }

    pageUrl = new URL(episodePath, pageUrl.origin);
  }

  const pageHtml = await fetchText(pageUrl.href, {
    headers: { Referer: pageUrl.origin },
  });
  const $$$ = cheerio.load(pageHtml);
  const results = [];

  $$$('.open_submenu').each((_, el) => {
    const text = $$$(el).text();
    if (!/espa[nñ]ol/i.test(text) || !/latino/i.test(text)) {
      return;
    }

    $$$(el).find('[data-tr], [data-video]').each((__, node) => {
      const rawUrl = $$$(node).attr('data-tr') || $$$(node).attr('data-video');
      if (!rawUrl) {
        return;
      }

      appendLatinoResult(results, {
        source: 'Cuevana',
        language: 'Latino',
        title: buildTitle(tmdb, season, episode),
        url: rawUrl,
        referer: pageUrl.href,
        headers: { Referer: pageUrl.href },
      });
    });
  });

  return results;
}

async function searchCineHdPlus(tmdb, mediaType, season, episode) {
  if (mediaType !== 'tv' || !season || !episode) {
    return [];
  }

  const candidate = await findCineHdPlusSeriesPage(tmdb, season, episode);
  if (!candidate) {
    return [];
  }

  const { pageUrl, pageHtml } = candidate;
  const $ = cheerio.load(pageHtml);
  const isLatino = /latino/i.test($('.details__langs').text());
  if (!isLatino) {
    return [];
  }

  const title = `${$('meta[property="og:title"]').attr('content') || tmdb.title} ${buildEpisodeTag(season, episode)}`;
  const results = [];

  $(`[data-num="${season}x${episode}"]`)
    .siblings('.mirrors')
    .children('[data-link]')
    .each((_, el) => {
      const rawUrl = $(el).attr('data-link');
      if (!rawUrl || /cinehdplus/.test(rawUrl)) {
        return;
      }

      appendLatinoResult(results, {
        source: 'CineHDPlus',
        ...languageMeta('mx'),
        title,
        url: rawUrl.replace(/^(https:)?\/\//, 'https://'),
        referer: pageUrl,
        headers: { Referer: pageUrl },
      });
    });

  return results;
}

async function findCineHdPlusSeriesPage(tmdb, season, episode) {
  const searchTerms = [
    tmdb.tmdbId,
    ...buildTmdbSearchTerms(tmdb),
  ].filter(Boolean);
  const targetEpisode = `${season}x${episode}`;
  const seen = new Set();
  const candidates = [];

  for (const searchTerm of searchTerms) {
    const searchUrl = `${SOURCE_BASES.cinehdplus}/series/?story=${encodeURIComponent(searchTerm)}&do=search&subaction=search`;
    const html = await fetchText(searchUrl, {
      headers: { Referer: `${SOURCE_BASES.cinehdplus}/series/` },
    });
    const $ = cheerio.load(html);

    $('.card__title a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || seen.has(href)) {
        return;
      }

      seen.add(href);
      const rawTitle = $(el).text().replace(/\s+/g, ' ').trim();
      const score = scoreTmdbCandidate(tmdb, rawTitle, null);

      candidates.push({
        href,
        score,
      });
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  for (const candidate of candidates) {
    const pageUrl = candidate.href;
    const pageHtml = await fetchText(pageUrl, {
      headers: { Referer: `${SOURCE_BASES.cinehdplus}/series/` },
    }).catch(() => null);

    if (!pageHtml) {
      continue;
    }

    const $ = cheerio.load(pageHtml);
    if ($(`[data-num="${targetEpisode}"]`).length === 0) {
      continue;
    }

    return { pageUrl, pageHtml };
  }

  return null;
}

async function searchCineCalidad(tmdb, mediaType, season, episode) {
  if (mediaType === 'tv' && season && episode) {
    return searchCineCalidadSeries(tmdb, season, episode);
  }

  if (mediaType !== 'movie') {
    return [];
  }

  const pageUrl = await findCineCalidadPage(
    buildTmdbSearchTerms(tmdb),
    findCineCalidadMovie,
    tmdb.year
  );

  if (!pageUrl) {
    return [];
  }

  return extractCineCalidadPlayers(tmdb, pageUrl);
}

async function searchCineCalidadSeries(tmdb, season, episode) {
  const seriesUrl = await findCineCalidadPage(
    buildTmdbSearchTerms(tmdb),
    findCineCalidadSeries,
    tmdb.year
  );

  if (!seriesUrl) {
    return [];
  }

  const episodeUrl = await findCineCalidadEpisodeUrl(seriesUrl, season, episode);
  if (!episodeUrl) {
    return [];
  }

  return extractCineCalidadPlayers(tmdb, episodeUrl, season, episode);
}

async function findCineCalidadPage(candidates, finder, year) {
  const settled = await Promise.allSettled(candidates.map(async (candidate) => {
    const resultUrl = await finder(candidate, year);
    return resultUrl || null;
  }));

  return firstTruthySettled(settled);
}

async function extractCineCalidadPlayers(tmdb, pageUrl, season, episode) {
  const html = await fetchText(pageUrl, {
    headers: { Referer: SOURCE_BASES.cinecalidad },
  });
  const $ = cheerio.load(html);
  const results = [];

  $('#playeroptionsul li[data-option]').each((_, el) => {
    const rawUrl = ($(el).attr('data-option') || '').trim();
    if (!rawUrl || /youtube\.com\/embed/i.test(rawUrl)) {
      return;
    }

    const normalizedUrl = normalizePlayerUrl(rawUrl, pageUrl);
    if (!normalizedUrl) {
      return;
    }

    appendLatinoResult(results, {
      source: 'Cinecalidad',
      ...languageMeta('mx'),
      title: buildTitle(tmdb, season, episode),
      url: normalizedUrl,
      referer: pageUrl,
      headers: { Referer: pageUrl },
    });
  });

  return results;
}

async function searchHomeCine(tmdb, season, episode) {
  const candidateNames = getTmdbTitleCandidates(tmdb);
  const settled = await Promise.allSettled(candidateNames.map(async (candidate) => {
    const pageUrl = await findHomeCinePage(candidate, tmdb.mediaType === 'tv');
    return pageUrl || null;
  }));

  let pageUrl = firstTruthySettled(settled);
  if (!pageUrl) {
    return [];
  }

  let pageHtml = await fetchText(pageUrl);

  if (tmdb.mediaType === 'tv' && season && episode) {
    const episodeUrl = extractHomeCineEpisodeUrl(pageHtml, season, episode);
    if (!episodeUrl) {
      return [];
    }
    pageUrl = episodeUrl;
    pageHtml = await fetchText(pageUrl);
  }

  const $ = cheerio.load(pageHtml);
  const results = [];

  $('.les-content a').each((_, el) => {
    const text = $(el).text().toLowerCase();
    if (!text.includes('latino')) {
      return;
    }

    const href = $(el).attr('href');
    if (!href) {
      return;
    }

    let iframeSrc = null;

    if (href.startsWith('#')) {
      iframeSrc = $(href).find('iframe[src]').first().attr('src') || null;
    } else {
      const iframeHtml = `<div>${href}</div>`;
      iframeSrc = cheerio.load(iframeHtml)('iframe').attr('src') || null;
    }

    if (!iframeSrc) {
      return;
    }

    appendLatinoResult(results, {
      source: 'HomeCine',
      ...languageMeta('mx'),
      title: buildTitle(tmdb, season, episode),
      url: iframeSrc,
      referer: pageUrl,
      headers: { Referer: pageUrl },
    });
  });

  return results;
}

async function searchGnulaHd(tmdb, mediaType, season, episode) {
  if (mediaType === 'tv' && season && episode) {
    return searchGnulaHdSeries(tmdb, season, episode);
  }

  if (mediaType !== 'movie') {
    return [];
  }

  const pageUrl = await findGnulaHdTitlePage(tmdb, false);
  if (!pageUrl) {
    return [];
  }

  return extractGnulaHdPlayers(tmdb, pageUrl, null, null);
}

async function searchGnulaHdSeries(tmdb, season, episode) {
  const seriesUrl = await findGnulaHdTitlePage(tmdb, true);
  if (!seriesUrl) {
    return [];
  }

  const seriesHtml = await fetchText(seriesUrl, {
    headers: { Referer: SOURCE_BASES.gnulahd },
  });
  const episodeUrl = extractGnulaHdEpisodeUrl(seriesHtml, season, episode);
  if (!episodeUrl) {
    return [];
  }

  return extractGnulaHdPlayers(tmdb, episodeUrl, season, episode);
}

async function findGnulaHdTitlePage(tmdb, expectSeries) {
  const searchTerms = buildTmdbSearchTerms(tmdb);
  const settled = await Promise.allSettled(searchTerms.map(async (term) => {
    const searchUrl = `${SOURCE_BASES.gnulahd}/?s=${encodeURIComponent(term)}`;
    const html = await fetchText(searchUrl, {
      headers: { Referer: SOURCE_BASES.gnulahd },
    }).catch(() => null);

    if (!html) {
      return null;
    }

    const $ = cheerio.load(html);
    let best = null;
    const seen = new Set();

    $('a.series[href*="/ver/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || seen.has(href)) {
        return;
      }

      seen.add(href);

      const url = new URL(href, SOURCE_BASES.gnulahd).href;
      const slug = url.replace(/\/+$/, '').split('/').pop() || '';
      const rawTitle = [
        $(el).attr('title'),
        $(el).find('img[alt]').attr('alt'),
        $(el).text(),
        slug.replace(/-/g, ' '),
      ].find(Boolean) || '';

      const score = scoreTmdbCandidate(tmdb, rawTitle, null);
      const isSeriesUrl = /\/ver\/(?:series|anime)\//i.test(url) || (!expectSeries ? false : true);

      // Search pages mostly expose canonical /ver/<slug>/ links for all content,
      // so only reject obvious mismatches and otherwise rely on episode discovery.
      if (expectSeries && /\/ver\/peliculas\//i.test(url)) {
        return;
      }

      if (!best || score > best.score || (score === best.score && isSeriesUrl && !best.isSeriesUrl)) {
        best = { url, score, isSeriesUrl };
      }
    });

    return best && best.score >= 4 ? best : null;
  }));

  const best = settled
    .filter((item) => item.status === 'fulfilled' && item.value)
    .map((item) => item.value)
    .sort((a, b) => b.score - a.score)[0] || null;

  return best ? best.url : null;
}

function extractGnulaHdEpisodeUrl(seriesHtml, season, episode) {
  const $ = cheerio.load(seriesHtml);
  const seasonNumber = parseInt(season, 10);
  const episodeNumber = parseInt(episode, 10);
  const targetTags = [
    `${seasonNumber}x${episodeNumber}`,
    `${seasonNumber}x${String(episodeNumber).padStart(2, '0')}`,
  ].map((value) => value.toLowerCase());

  const href = $('a[href]').map((_, el) => $(el).attr('href')).get().find((value) => {
    const normalized = String(value || '').toLowerCase();
    return targetTags.some((targetTag) => normalized.includes(`-${targetTag}/`) || normalized.endsWith(`-${targetTag}`));
  });

  return href ? new URL(href, SOURCE_BASES.gnulahd).href : null;
}

function extractGnulaHdServerPayload(html) {
  const scripts = [
    html.match(/var\s+_gnpv_ep_langs\s*=\s*(\[[\s\S]*?\]);/i),
    html.match(/var\s+_gd\s*=\s*(\[[\s\S]*?\]);/i),
  ];

  for (const match of scripts) {
    if (!match?.[1]) {
      continue;
    }

    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (_error) {
      continue;
    }
  }

  return [];
}

function normalizeGnulaHdLanguage(entry) {
  const label = String(entry?.label || '').toLowerCase();

  if (label.includes('subtitulado')) {
    return null;
  }

  if (label.includes('castellano')) {
    return languageMeta('es');
  }

  if (label.includes('latino')) {
    return languageMeta('mx');
  }

  return null;
}

async function extractGnulaHdPlayers(tmdb, pageUrl, season, episode) {
  const html = await fetchText(pageUrl, {
    headers: { Referer: SOURCE_BASES.gnulahd },
  });
  const payload = extractGnulaHdServerPayload(html);
  const results = [];
  const seenUrls = new Set();

  payload.forEach((entry) => {
    const language = normalizeGnulaHdLanguage(entry);
    if (!language) {
      return;
    }
    const servers = Array.isArray(entry?.servers) ? entry.servers : [];

    servers.forEach((server) => {
      const rawUrl = String(server?.src || '').trim();
      if (!rawUrl) {
        return;
      }

      const normalizedUrl = rawUrl.replace(/^(https:)?\/\//, 'https://');
      if (seenUrls.has(normalizedUrl)) {
        return;
      }
      seenUrls.add(normalizedUrl);

      appendLatinoResult(results, {
        source: 'GnulaHD',
        ...language,
        title: buildTitle(tmdb, season, episode),
        url: normalizedUrl,
        referer: pageUrl,
        headers: { Referer: pageUrl },
      });
    });
  });

  return results;
}

async function findHomeCinePage(name, isSeries) {
  const searchUrl = `${SOURCE_BASES.homecine}/?s=${encodeURIComponent(name)}`;
  const html = await fetchText(searchUrl);
  const $ = cheerio.load(html);
  const candidates = [];
  const targetNorm = normalizeTitle(name);

  $('a[oldtitle]').each((_, el) => {
    const oldTitle = ($(el).attr('oldtitle') || '').trim();
    const href = $(el).attr('href');
    if (!href) {
      return;
    }

    const seriesMatch = href.includes('/series/');
    if (isSeries !== seriesMatch) {
      return;
    }

    let score = 0;
    const norm = normalizeTitle(oldTitle);
    if (norm === targetNorm) {
      score += 10;
    }
    if (norm.includes(targetNorm) || targetNorm.includes(norm)) {
      score += 5;
    }

    candidates.push({ href, score });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? candidates[0].href : null;
}

function extractHomeCineEpisodeUrl(pageHtml, season, episode) {
  const $ = cheerio.load(pageHtml);
  const suffix = `-temporada-${season}-capitulo-${episode}`;

  const href = $('#seasons a')
    .map((_, el) => $(el).attr('href'))
    .get()
    .find((value) => value && value.endsWith(suffix));

  return href || null;
}

async function searchVerHdLink(tmdb, mediaType) {
  if (mediaType !== 'movie' || !tmdb.imdbId) {
    return [];
  }

  const pageUrl = `${SOURCE_BASES.verhdlink}/movie/${tmdb.imdbId}`;
  const html = await fetchText(pageUrl);
  const $ = cheerio.load(html);
  const results = [];

  $('._player-mirrors.latino [data-link!=""]').each((_, el) => {
    const rawUrl = $(el).attr('data-link');
    if (!rawUrl || /verhdlink/.test(rawUrl)) {
      return;
    }

    appendLatinoResult(results, {
      source: 'VerHdLink',
      ...languageMeta('mx'),
      title: buildTitle(tmdb),
      url: rawUrl.replace(/^(https:)?\/\//, 'https://'),
      referer: SOURCE_BASES.verhdlink,
      headers: { Referer: SOURCE_BASES.verhdlink },
    });
  });

  return results;
}

async function findCineCalidadMovie(title, year) {
  const searchUrl = `${SOURCE_BASES.cinecalidad}/?s=${encodeURIComponent(title)}`;
  const html = await fetchText(searchUrl, {
    headers: { Referer: SOURCE_BASES.cinecalidad },
  });
  const $ = cheerio.load(html);
  let best = null;

  $('#archive-content article.item.movies').each((_, el) => {
    const href = $(el).find('a[href*="/ver-pelicula/"]').first().attr('href');
    const rawTitle = extractCineCalidadCardTitle($, el);
    if (!href || !rawTitle) {
      return;
    }

    const yearText = $(el).find('.home_post_content p').eq(1).text().trim();
    const score = scoreSearchCandidate(title, rawTitle, year, yearText);

    if (!best || score > best.score) {
      best = { href, score };
    }
  });

  return best && best.score >= 8 ? best.href : null;
}

async function findCineCalidadSeries(title, year) {
  const searchUrl = `${SOURCE_BASES.cinecalidad}/?s=${encodeURIComponent(title)}`;
  const html = await fetchText(searchUrl, {
    headers: { Referer: SOURCE_BASES.cinecalidad },
  });
  const $ = cheerio.load(html);
  let best = null;

  $('#archive-content article.item, #archive-content article').each((_, el) => {
    const href = $(el).find('a[href*="/ver-serie/"]').first().attr('href');
    const rawTitle = extractCineCalidadCardTitle($, el);
    if (!href || !rawTitle) {
      return;
    }

    const yearText = $(el).find('.home_post_content p').eq(1).text().trim();
    const score = scoreSearchCandidate(title, rawTitle, year, yearText);

    if (!best || score > best.score) {
      best = { href, score };
    }
  });

  return best && best.score >= 8 ? best.href : null;
}

async function findCineCalidadEpisodeUrl(seriesUrl, season, episode) {
  const html = await fetchText(seriesUrl, {
    headers: { Referer: SOURCE_BASES.cinecalidad },
  });
  const $ = cheerio.load(html);
  const target = `${season}x${episode}`;

  const href = $('a[href*="/ver-el-episodio/"]')
    .map((_, el) => $(el).attr('href'))
    .get()
    .find((value) => {
      if (!value) {
        return false;
      }

      try {
        const pathname = new URL(value, SOURCE_BASES.cinecalidad).pathname.toLowerCase();
        return pathname.endsWith(`-${target}/`) || pathname.endsWith(`-${target}`);
      } catch (_error) {
        return false;
      }
    });

  return href ? new URL(href, SOURCE_BASES.cinecalidad).href : null;
}

function normalizePlayerUrl(rawUrl, baseUrl) {
  if (!rawUrl) {
    return null;
  }

  if (/^\/\//.test(rawUrl)) {
    return `https:${rawUrl}`;
  }

  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  try {
    return new URL(rawUrl, baseUrl || SOURCE_BASES.cinecalidad).href;
  } catch (_error) {
    return null;
  }
}

async function searchTioPlusSeries(tmdb, season, episode) {
  const candidates = getTmdbTitleCandidates(tmdb);
  const settled = await Promise.allSettled(candidates.map(async (candidate) => {
    const resultUrl = await findTioPlusSeries(candidate, tmdb.year);
    return resultUrl || null;
  }));

  const seriesUrl = firstTruthySettled(settled);
  if (!seriesUrl) {
    return [];
  }

  const seriesHtml = await fetchText(seriesUrl, {
    headers: { Referer: SOURCE_BASES.tioplus },
  });
  const $ = cheerio.load(seriesHtml);
  const episodeHref = $('#episodeList a.itemA[href]')
    .map((_, el) => $(el).attr('href'))
    .get()
    .find((href) => {
      if (!href) {
        return false;
      }

      try {
        const pathname = new URL(href, SOURCE_BASES.tioplus).pathname.replace(/\/+$/, '');
        return pathname === `/serie/${pathname.split('/')[2]}/season/${season}/episode/${episode}`;
      } catch (_error) {
        return false;
      }
    });

  if (!episodeHref) {
    return [];
  }

  const episodeUrl = new URL(episodeHref, SOURCE_BASES.tioplus).href;
  const html = await fetchText(episodeUrl, {
    headers: { Referer: seriesUrl },
  });
  const $$ = cheerio.load(html);
  const results = [];

  $$('.bg-tabs > div').each((_, section) => {
    const buttonText = $$(section).find('button').first().text().toLowerCase();
    if (!buttonText.includes('latino')) {
      return;
    }

    $$(section).find('li[data-server]').each((__, el) => {
      const token = $$(el).attr('data-server');
      if (!token) {
        return;
      }

      appendLatinoResult(results, {
        source: 'TioPlus',
        ...languageMeta('mx'),
        title: buildTitle(tmdb, season, episode),
        url: `${SOURCE_BASES.tioplus}/player/${encodeBase64(token)}`,
        referer: episodeUrl,
        headers: { Referer: episodeUrl },
        _tioplusToken: token,
      });
    });
  });

  if (results.length === 0) {
    return [];
  }

  const resolved = await Promise.allSettled(results.map(resolveTioPlusPlayer));

  return resolved.flatMap((result) => (
    result.status === 'fulfilled' && result.value && !isBlockedLatinoResult(result.value) ? [result.value] : []
  ));
}

async function searchTioPlus(tmdb, mediaType, season, episode) {
  if (mediaType === 'tv' && season && episode) {
    return searchTioPlusSeries(tmdb, season, episode);
  }

  return searchTioPlusMovieFlow(tmdb, mediaType);
}

async function searchTioPlusMovieFlow(tmdb, mediaType) {
  if (mediaType !== 'movie') {
    return [];
  }

  const candidates = getTmdbTitleCandidates(tmdb);
  const settled = await Promise.allSettled(candidates.map(async (candidate) => {
    const resultUrl = await findTioPlusMovie(candidate, tmdb.year);
    return resultUrl || null;
  }));

  const pageUrl = firstTruthySettled(settled);
  if (!pageUrl) {
    return [];
  }

  const html = await fetchText(pageUrl, {
    headers: { Referer: SOURCE_BASES.tioplus },
  });
  const $ = cheerio.load(html);
  const results = [];

  $('.bg-tabs > div').each((_, section) => {
    const buttonText = $(section).find('button').first().text().toLowerCase();
    if (!buttonText.includes('latino')) {
      return;
    }

    $(section).find('li[data-server]').each((__, el) => {
      const token = $(el).attr('data-server');
      if (!token) {
        return;
      }

      appendLatinoResult(results, {
        source: 'TioPlus',
        ...languageMeta('mx'),
        title: buildTitle(tmdb),
        url: `${SOURCE_BASES.tioplus}/player/${encodeBase64(token)}`,
        referer: pageUrl,
        headers: { Referer: pageUrl },
        _tioplusToken: token,
      });
    });
  });

  if (results.length === 0) {
    return [];
  }

  const resolved = await Promise.allSettled(results.map(resolveTioPlusPlayer));

  return resolved.flatMap((result) => (
    result.status === 'fulfilled' && result.value && !isBlockedLatinoResult(result.value) ? [result.value] : []
  ));
}

async function searchVerPeliculasUltra(tmdb, mediaType) {
  if (mediaType !== 'movie') {
    return [];
  }

  const candidates = [tmdb.title, tmdb.originalTitle].filter(Boolean);
  const settled = await Promise.allSettled(candidates.map(async (candidate) => {
    const resultUrl = await findVerPeliculasUltraMovie(candidate, tmdb.year);
    return resultUrl || null;
  }));

  const pageUrl = firstTruthySettled(settled);
  if (!pageUrl) {
    return [];
  }

  const html = await fetchText(pageUrl, {
    headers: { Referer: SOURCE_BASES.verpeliculasultra },
  });
  const $ = cheerio.load(html);
  const results = [];

  $('#ts21 .play-btn-cont[data-src], #ts2 .play-btn-cont[data-src]').each((_, el) => {
    const rawUrl = ($(el).attr('data-src') || '').trim();
    if (!rawUrl) {
      return;
    }

    appendLatinoResult(results, {
      source: 'VerPeliculasUltra',
      ...languageMeta('mx'),
      title: buildTitle(tmdb),
      url: rawUrl.replace(/^(https:)?\/\//, 'https://'),
      referer: pageUrl,
      headers: { Referer: pageUrl },
    });
  });

  return results;
}

async function findVerPeliculasUltraMovie(title, year) {
  const searchUrl = `${SOURCE_BASES.verpeliculasultra}/index.php?do=search&subaction=search&story=${encodeURIComponent(title)}`;
  const html = await fetchText(searchUrl, {
    headers: {
      Referer: SOURCE_BASES.verpeliculasultra,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  const $ = cheerio.load(html);
  const targetNorm = normalizeTitle(title);
  let best = null;

  $('a[href$=".html"][title]').each((_, el) => {
    const href = $(el).attr('href');
    const rawTitle = ($(el).attr('title') || $(el).text() || '').trim();
    if (!href || !rawTitle) {
      return;
    }

    let score = 0;
    const norm = normalizeTitle(rawTitle);
    if (norm === targetNorm) {
      score += 10;
    }
    if (norm.includes(targetNorm) || targetNorm.includes(norm)) {
      score += 5;
    }

    const article = $(el).closest('article, .shortstory, .base.shortstory, li, div');
    const yearText = article.text().match(/\b(19|20)\d{2}\b/);
    if (year && yearText && yearText[0] === year) {
      score += 4;
    }

    if (/serie|temporada|cap[ií]tulo/i.test(rawTitle)) {
      score -= 5;
    }

    if (!best || score > best.score) {
      best = { href, score };
    }
  });

  return best && best.score >= 5 ? new URL(best.href, SOURCE_BASES.verpeliculasultra).href : null;
}

async function findTioPlusMovie(title, year) {
  const searchUrl = `${SOURCE_BASES.tioplus}/api/search/${encodeURIComponent(title)}`;
  const html = await fetchText(searchUrl, {
    headers: {
      Referer: `${SOURCE_BASES.tioplus}/search`,
      Accept: 'text/html,*/*;q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (/No hay resultados/i.test(html)) {
    return null;
  }

  const $ = cheerio.load(`<div>${html}</div>`);
  let best = null;

  $('a.itemA[href]').each((_, el) => {
    const href = $(el).attr('href');
    const rawTitle = $(el).find('h2').text().trim();
    const kind = $(el).find('.typeItem').text().toLowerCase();
    if (!href || !rawTitle || kind.includes('serie')) {
      return;
    }

    const matchYear = rawTitle.match(/\((\d{4})\)/);
    const score = scoreSearchCandidate(title, rawTitle.replace(/\(\d{4}\)/, '').trim(), year, matchYear ? matchYear[1] : null);

    if (!best || score > best.score) {
      best = { href, score };
    }
  });

  return best && best.score >= 5 ? best.href : null;
}

async function findTioPlusSeries(title, year) {
  const searchUrl = `${SOURCE_BASES.tioplus}/api/search/${encodeURIComponent(title)}`;
  const html = await fetchText(searchUrl, {
    headers: {
      Referer: `${SOURCE_BASES.tioplus}/search`,
      Accept: 'text/html,*/*;q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (/No hay resultados/i.test(html)) {
    return null;
  }

  const $ = cheerio.load(`<div>${html}</div>`);
  let best = null;

  $('a.itemA[href]').each((_, el) => {
    const href = $(el).attr('href');
    const rawTitle = $(el).find('h2').text().trim();
    const kind = $(el).find('.typeItem').text().toLowerCase();
    if (!href || !rawTitle || !kind.includes('serie')) {
      return;
    }

    const matchYear = rawTitle.match(/\((\d{4})\)/);
    const score = scoreSearchCandidate(title, rawTitle.replace(/\(\d{4}\)/, '').trim(), year, matchYear ? matchYear[1] : null);

    if (!best || score > best.score) {
      best = { href, score };
    }
  });

  return best && best.score >= 5 ? best.href : null;
}

async function resolveTioPlusPlayer(result) {
  const html = await fetchText(result.url, {
    headers: result.headers,
  });
  const match = html.match(/window\.location\.href\s*=\s*'([^']+)'/);
  if (!match || !match[1]) {
    return null;
  }

  return {
    source: result.source,
    language: result.language,
    contentLanguage: result.contentLanguage,
    title: result.title,
    url: match[1],
    referer: result.referer,
    headers: { Referer: result.referer },
  };
}
