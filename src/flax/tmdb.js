import { TMDB_API_KEY, TMDB_BASE_URL } from './constants.js';
import { fetchJson } from './http.js';

function normalizeMediaType(mediaType) {
  return mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
}

export async function getTmdbInfo(tmdbId, mediaType) {
  const type = normalizeMediaType(mediaType);
  const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids,translations&language=es-ES`;

  const data = await fetchJson(url);
  const title = type === 'tv' ? data.name : data.title;
  const originalTitle = type === 'tv' ? (data.original_name || data.name) : (data.original_title || data.title);
  const year = type === 'tv'
    ? (data.first_air_date || '').slice(0, 4)
    : (data.release_date || '').slice(0, 4);
  const translationTitles = Array.isArray(data.translations?.translations)
    ? data.translations.translations
      .filter((entry) => ['es', 'es-ES', 'es-MX'].includes(entry?.iso_639_1) || ['ES', 'MX'].includes(entry?.iso_3166_1))
      .flatMap((entry) => {
        const translatedData = entry?.data || {};
        return [
          type === 'tv' ? translatedData.name : translatedData.title,
          type === 'tv' ? translatedData.original_name : translatedData.original_title,
        ];
      })
      .map((value) => String(value || '').trim())
      .filter(Boolean)
    : [];

  return {
    tmdbId: String(tmdbId),
    mediaType: type,
    title,
    originalTitle,
    translatedTitles: [...new Set(translationTitles)],
    year,
    imdbId: data.external_ids ? data.external_ids.imdb_id : null,
  };
}

export function buildEpisodeTag(season, episode) {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}
