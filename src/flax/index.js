import { getLatinoSourceResults } from './sources.js';
import { getTmdbInfo } from './tmdb.js';
import { resolveLatinoStreams } from './extractors.js';

async function getStreams(tmdbIdOrMedia, mediaType = 'movie', season = null, episode = null) {
  let tmdbId, type, s, e;

  if (typeof tmdbIdOrMedia === 'object' && tmdbIdOrMedia !== null) {
    // Handle Nuvio/Flax media object signature
    tmdbId = tmdbIdOrMedia.tmdb_id || tmdbIdOrMedia.tmdbId;
    type = tmdbIdOrMedia.type || tmdbIdOrMedia.mediaType || 'movie';
    s = tmdbIdOrMedia.season;
    e = tmdbIdOrMedia.episode;
  } else {
    // Handle traditional argument-based signature
    tmdbId = tmdbIdOrMedia;
    type = mediaType;
    s = season;
    e = episode;
  }

  const normalizedSeason = s == null ? null : parseInt(s, 10);
  const normalizedEpisode = e == null ? null : parseInt(e, 10);
  const normalizedMediaType = type === 'series' ? 'tv' : type;

  console.log(
    `[Flax] Fetching streams for TMDB ID: ${tmdbId}, Type: ${normalizedMediaType}` +
    (normalizedSeason && normalizedEpisode ? `, S${normalizedSeason}E${normalizedEpisode}` : ''),
  );

  try {
    const tmdb = await getTmdbInfo(tmdbId, normalizedMediaType);
    console.log(`[Flax] TMDB Info: "${tmdb.title}" (${tmdb.year || 'N/A'})`);

    const sourceResults = await getLatinoSourceResults(tmdb, normalizedMediaType, normalizedSeason, normalizedEpisode);
    console.log(`[Flax] Candidate source URLs: ${sourceResults.length}`);

    const streams = await resolveLatinoStreams(sourceResults);
    console.log(`[Flax] Final streams: ${streams.length}`);

    return streams;
  } catch (error) {
    console.error('[Flax] getStreams error:', error.message);
    return [];
  }
}

module.exports = { getStreams };
