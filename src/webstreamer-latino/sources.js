import cheerio from 'cheerio-without-node-native';
import { SOURCE_BASES } from './constants.js';
import { fetchPage, fetchText } from './http.js';
import { buildEpisodeTag } from './tmdb.js';
import { normalizeTitle } from './utils.js';

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
  const disabled = new Set(
    String(process.env.WEBSTREAMER_LATINO_DISABLED_SOURCES || '')
      .split(',')
      .map(v => v.trim().toLowerCase())
      .filter(Boolean),
  );
  const sourceTimeoutMs = Math.max(0, parseInt(process.env.WEBSTREAMER_LATINO_SOURCE_TIMEOUT_MS || '0', 10) || 0);

  const withTimeout = (label, promise) => {
    if (!sourceTimeoutMs) {
      return promise;
    }
    return Promise.race([
      promise,
      new Promise(resolve => setTimeout(() => {
        console.warn(`[WebstreamerLatino] Source timed out after ${sourceTimeoutMs}ms: ${label}`);
        resolve([]);
      }, sourceTimeoutMs)),
    ]);
  };

  await Promise.allSettled([
    prewarmSource(SOURCE_BASES.cuevana),
    prewarmSource(SOURCE_BASES.cinecalidad),
    prewarmSource(SOURCE_BASES.tioplus),
  ]);

  const cuevanaResults = disabled.has('cuevana')
    ? []
    : await withTimeout('cuevana', searchCuevana(tmdb, season, episode)).catch((error) => {
      console.error('[WebstreamerLatino] Source error:', error ? error.message : error);
      return [];
    });

  const tasks = [
    !disabled.has('cinecalidad') && withTimeout('cinecalidad', searchCineCalidad(tmdb, mediaType, season, episode)),
    !disabled.has('homecine') && withTimeout('homecine', searchHomeCine(tmdb, season, episode)),
    !disabled.has('tioplus') && withTimeout('tioplus', searchTioPlus(tmdb, mediaType, season, episode)),
  ].filter(Boolean);

  const settled = await Promise.allSettled(tasks);

  return settled.flatMap((result) => {
    if (result.status === 'fulfilled') {
      return result.value.filter((entry) => !isBlockedLatinoResult(entry));
    }

    console.error('[WebstreamerLatino] Source error:', result.reason ? result.reason.message : result.reason);
    return [];
  }).concat(cuevanaResults.filter((entry) => !isBlockedLatinoResult(entry)));
}

async function prewarmSource(baseUrl) {
  await fetchPage(baseUrl, {
    headers: {
      Referer: baseUrl,
      Origin: new URL(baseUrl).origin,
    },
  }).catch(() => null);
}

async function searchCuevana(tmdb, season, episode) {
  const searchTerms = buildSearchTerms(tmdb.originalTitle, tmdb.title);
  let pagePath = null;

  for (const searchTerm of searchTerms) {
    const searchUrl = `${SOURCE_BASES.cuevana}/search/${encodeURIComponent(searchTerm)}/`;
    const html = await fetchText(searchUrl, {
      headers: { Referer: SOURCE_BASES.cuevana },
    });
    const $ = cheerio.load(html);
    const resultCards = $('.MovieList.Rows > li .TPost');

    if (!resultCards.length) {
      continue;
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
      const score = scoreSearchCandidate(searchTerm, title, tmdb.year, year);

      if (score > bestScore) {
        bestScore = score;
        bestPath = href;
      }
    });

    if (bestPath && bestScore >= 5) {
      pagePath = bestPath;
      break;
    }
  }

  if (!pagePath) {
    return [];
  }

  let pageUrl = new URL(pagePath, SOURCE_BASES.cuevana);

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
    ...buildSearchTerms(tmdb.originalTitle, tmdb.title),
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
      const score = scoreSearchCandidate(tmdb.title, rawTitle, tmdb.year, null);

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
    buildSearchTerms(tmdb.title, tmdb.originalTitle),
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
    buildSearchTerms(tmdb.title, tmdb.originalTitle),
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
  for (const candidate of candidates) {
    const resultUrl = await finder(candidate, year);
    if (resultUrl) {
      return resultUrl;
    }
  }

  return null;
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
  const candidateNames = [tmdb.title, tmdb.originalTitle].filter(Boolean);
  let pageUrl = null;

  for (const candidate of candidateNames) {
    pageUrl = await findHomeCinePage(candidate, tmdb.mediaType === 'tv');
    if (pageUrl) {
      break;
    }
  }

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
  const candidates = [tmdb.originalTitle, tmdb.title].filter(Boolean);
  let seriesUrl = null;

  for (const candidate of candidates) {
    const resultUrl = await findTioPlusSeries(candidate, tmdb.year);
    if (resultUrl) {
      seriesUrl = resultUrl;
      break;
    }
  }

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
        url: `${SOURCE_BASES.tioplus}/player/${Buffer.from(token).toString('base64')}`,
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

  const candidates = [tmdb.originalTitle, tmdb.title].filter(Boolean);
  let pageUrl = null;

  for (const candidate of candidates) {
    const resultUrl = await findTioPlusMovie(candidate, tmdb.year);
    if (resultUrl) {
      pageUrl = resultUrl;
      break;
    }
  }

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
        url: `${SOURCE_BASES.tioplus}/player/${Buffer.from(token).toString('base64')}`,
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
  let pageUrl = null;

  for (const candidate of candidates) {
    const resultUrl = await findVerPeliculasUltraMovie(candidate, tmdb.year);
    if (resultUrl) {
      pageUrl = resultUrl;
      break;
    }
  }

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
