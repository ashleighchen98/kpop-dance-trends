// Central config: search terms, filtering keywords, and paths.
// Edit this file to tune what counts as "a K-pop dance trend" for your channel.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const CACHE_DIR = path.join(ROOT_DIR, 'data', 'cache');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');

// Search queries sent to YouTube's search.list endpoint.
// Kept broad-but-dance-specific on purpose — song titles alone get filtered
// out later in src/processing (a dance CHALLENGE/COVER/PRACTICE video is
// the signal we actually want, not just "song is popular").
export const YOUTUBE_SEARCH_QUERIES = [
  'kpop dance challenge',
  'kpop dance cover',
  'kpop dance practice mirrored',
  '카이팝 댄스 챌린지', // "kpop dance challenge" in Korean — catches KR-native uploads
];

// How far back to look for "trending this week".
export const LOOKBACK_DAYS = 7;

// How many results to pull per query before filtering/ranking.
export const RESULTS_PER_QUERY = 25;

// How many ranked results the dashboard shows.
export const TOP_N = 10;

// How many distinct-dance candidates get tried for official-video
// resolution (dance practice, or failing that the official MV — see
// resolveOfficial.js) before giving up on filling the top N. Some
// candidates won't resolve at all (see README — that's often correctly
// filtering out non-K-pop or skit content, not a failure), so this needs
// real headroom above TOP_N, not just TOP_N itself.
//
// Each candidate costs 1-2 search.list calls, and search.list is 100 quota
// units per call — NOT a small cost. YouTube's free tier is 10,000
// units/day, which is only 100 search.list calls total, for the whole day,
// covering the original scrape too. This was 25 (up to 50 searches, half
// the ENTIRE day's quota in one run) until a real run alternating dance
// practice + MV fallback attempts across many candidates burned through the
// full daily quota in a single `npm run process` call — confirmed live, not
// theoretical. Lowered to 15 (up to 30 searches) to leave real headroom for
// the base scrape and any other runs that day. Raise this only if you also
// accept you'll likely get one full run per day, maybe two.
//
// This only bounds cost for NEW, never-seen dances — a cache hit (see
// officialCache.js) doesn't count against this at all, so a mostly-cached
// run (most weeks, once a song's already been resolved once) can fill far
// more than 15 slots for free. This number is really "how many brand-new
// dances can I afford to discover in one run," not "how big can the
// dashboard get."
export const MAX_CANDIDATES_TO_RESOLVE = 15;

// Videos below this view count are excluded from ranking (still shown in
// raw counts, just not ranked). Without this, a video with e.g. 7,000
// views and 50 likes hits the same engagement-rate ceiling as a video with
// 500,000 views and 50,000 likes — small sample sizes make the ratio noisy
// and let barely-seen videos outrank things that are actually spreading.
export const MIN_VIEW_COUNT_FOR_RANKING = 10_000;

// Titles/descriptions containing these are treated as real dance-trend
// signals. Matching in src/processing/filter.js strips spaces/punctuation
// from both sides first, so this also catches hashtag forms with no space
// (e.g. "#kpopdancecover" matches 'dance cover') without listing every variant.
export const DANCE_SIGNAL_KEYWORDS = [
  'dance challenge',
  'dance cover',
  'dance practice',
  'choreography',
  'dance tutorial',
  'mirrored',
  'dance cam',
  'in public', // "kpop in public" — a whole dance-cover subgenre
  '안무', // "choreography" in Korean
];

// Titles/descriptions containing these suggest it's not actual dance-trend
// content, even though it passed the DANCE_SIGNAL_KEYWORDS check above —
// used to exclude false positives DANCE_SIGNAL_KEYWORDS alone lets through.
export const NON_DANCE_EXCLUDE_KEYWORDS = [
  // Just a song upload, not a dance video at all.
  'official mv',
  'official m/v',
  'official audio',
  'lyric video',
  'lyrics video',
  'audio only',
  'visualizer',

  // Content-format false positives caught on real output (user flagged 3
  // videos in one dashboard that weren't actual choreography content —
  // each below maps to one of them):
  'this or that', // an interactive game-short format, not a performance (e.g. "THIS OR THAT CHALLENGE")
  'most famous', // compilation/listicle phrasing ("BTS's Most Famous Dance Challenge"), not a single performance
  'reaction', // reacting to a video isn't performing/covering the choreography

  // Found immediately after the fix above, verifying it didn't just let a
  // different false positive rise into the top 10: a trivia channel had
  // hashtag-stuffed #dance #challenge onto "Guess the KATSEYE Member by
  // Their Hairstyle" — a quiz, not a dance video. Same tag-riding pattern
  // as the Macarena case, different genre.
  'guess the',
  'trivia',

  // Live customer-facing dashboard example: "Real Jk vs fake Jk dance
  // challenge" — a real-vs-fake impersonator comparison, not a
  // choreography performance. Same "content format, not a dance" pattern
  // as 'this or that' above.
  'vs fake',

  // DANCE_SIGNAL_KEYWORDS checks "is this dance-FORMAT content", never
  // "is this actually K-pop" — nothing currently verifies that. Real example:
  // a Macarena video (not K-pop — a '90s Latin pop dance) hashtag-stuffed
  // with #kpop #kpopdance for reach, riding the search query rather than
  // being genuinely related to it. Blocklisting is a narrow, safe fix — the
  // real gap (no positive "is this K-pop" check) is noted in README.
  'macarena',
];
