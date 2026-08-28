// Separates real dance-trend content (challenges, covers, practice videos,
// "in public" dance covers) from false positives that just happen to match
// the search queries — song uploads, MVs, unrelated videos that mention
// "kpop dance" in passing (a mobile game clip, a reaction video, etc.).
//
// Search alone isn't enough for this — see the real example from Day 1's
// test run: a mobile-game video titled "K-POP DANCE vs ZOMBIE FIRE! ...
// #shorts" matched the search query but obviously isn't a dance trend.

import { DANCE_SIGNAL_KEYWORDS, NON_DANCE_EXCLUDE_KEYWORDS } from '../config.js';

// Lowercase and strip everything but letters/digits, so "dance cover",
// "Dance-Cover", and "#dancecover" all normalize to the same string and
// match each other as substrings.
function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

function textContainsKeyword(normalizedText, keyword) {
  return normalizedText.includes(normalize(keyword));
}

/**
 * Returns true if a video looks like real dance-trend content:
 * at least one dance-signal keyword present, and no exclude keyword
 * that suggests it's just a plain song upload.
 */
export function isDanceTrendContent(video) {
  const haystack = normalize(`${video.title} ${video.description || ''}`);

  const hasExcludeSignal = NON_DANCE_EXCLUDE_KEYWORDS.some((kw) => textContainsKeyword(haystack, kw));
  if (hasExcludeSignal) return false;

  const hasDanceSignal = DANCE_SIGNAL_KEYWORDS.some((kw) => textContainsKeyword(haystack, kw));
  return hasDanceSignal;
}

/**
 * Filters a list of scraped videos down to ones that look like real
 * dance trends. Attaches nothing — just filters.
 */
export function filterDanceTrends(videos) {
  return videos.filter(isDanceTrendContent);
}
