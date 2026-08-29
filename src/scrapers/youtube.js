// YouTube scraper — uses the OFFICIAL YouTube Data API v3 (search.list +
// videos.list). This is a real, supported, free-tier API — unlike TikTok,
// there's no scraping or bot-detection question here.
//
// Requires YOUTUBE_API_KEY in .env (see .env.example for how to get one).
//
// Usage:
//   npm run scrape:youtube
//   node src/scrapers/youtube.js

import fs from 'node:fs';
import path from 'node:path';
import {
  CACHE_DIR,
  LOOKBACK_DAYS,
  RESULTS_PER_QUERY,
  YOUTUBE_SEARCH_QUERIES,
} from '../config.js';
import { loadEnv } from '../loadEnv.js';

loadEnv();

const API_BASE = 'https://www.googleapis.com/youtube/v3';

// The YouTube Data API sometimes returns titles/descriptions with HTML
// entities left un-decoded (e.g. "&#39;" instead of "'") — found by tracing
// a real dedup bug where "&#39;BAD&#39;" broke title comparison. Decoding
// once here, right at the source, means every downstream consumer (filter,
// dedupe, dashboard display) gets clean text without needing to know about
// this quirk.
function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&'); // decode last, so a literal "&amp;lt;" doesn't become a live "<"
}

function getApiKey() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error(
      'Missing YOUTUBE_API_KEY. Copy .env.example to .env and add your ' +
        'YouTube Data API v3 key (see .env.example for setup steps).'
    );
  }
  return key;
}

/**
 * Search for videos matching a query, published within the lookback window.
 * Returns raw search.list items (id + snippet only — no stats yet).
 */
async function searchVideos(query, { maxResults = RESULTS_PER_QUERY, lookbackDays = LOOKBACK_DAYS } = {}) {
  const apiKey = getApiKey();
  const publishedAfter = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const url = new URL(`${API_BASE}/search`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('order', 'viewCount');
  url.searchParams.set('publishedAfter', publishedAfter);
  url.searchParams.set('maxResults', String(Math.min(maxResults, 50)));
  url.searchParams.set('relevanceLanguage', 'en');
  url.searchParams.set('safeSearch', 'moderate');

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube search.list failed for "${query}": ${res.status} ${body}`);
  }
  const data = await res.json();
  return (data.items || []).map((item) => ({
    videoId: item.id.videoId,
    title: decodeHtmlEntities(item.snippet.title),
    description: decodeHtmlEntities(item.snippet.description),
    channelTitle: decodeHtmlEntities(item.snippet.channelTitle),
    publishedAt: item.snippet.publishedAt,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
    matchedQuery: query,
  }));
}

/**
 * Fetch statistics (views/likes/comments) for a batch of video IDs.
 * videos.list allows up to 50 IDs per call.
 */
async function getVideoStats(videoIds) {
  if (videoIds.length === 0) return new Map();
  const apiKey = getApiKey();
  const stats = new Map();

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = new URL(`${API_BASE}/videos`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('part', 'statistics,contentDetails');
    url.searchParams.set('id', batch.join(','));

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube videos.list failed: ${res.status} ${body}`);
    }
    const data = await res.json();
    for (const item of data.items || []) {
      stats.set(item.id, {
        viewCount: Number(item.statistics?.viewCount ?? 0),
        likeCount: Number(item.statistics?.likeCount ?? 0),
        commentCount: Number(item.statistics?.commentCount ?? 0),
        duration: item.contentDetails?.duration ?? null,
      });
    }
  }
  return stats;
}

// Tried using search.list's pageInfo.totalResults to estimate "how many
// videos exist for this dance" globally — it doesn't work. Verified
// directly: YouTube caps this at a flat 1,000,000 for any broadly-matching
// query (confirmed against several real queries, all returning exactly
// 1000000), only dropping to an exact 0 when nothing matches at all. There
// is no gradation in between, so it can't distinguish a moderately-known
// dance from a massive one — useless as a ranking signal. Google's own docs
// call this value approximate; in practice, for anything popular, it's not
// approximate so much as a placeholder. Replaced by searchCandidatesContaining
// below (used by processing/resolveOfficial.js) plus counting duplicates in
// our own scrape sample (see dedupe.js / processing/index.js) — smaller
// numbers, but real ones.

/**
 * Searches YouTube for `query`, returning full candidate info (title,
 * channel, thumbnail, url). If `mustContainPhrase` is given, only returns
 * results whose title contains it (case-insensitive) — plural, not just
 * the first match. Search relevance can rank a wrong-song result first (a
 * common word in the query loses to a distinctive one — a real case
 * caught while testing this: "girlset itzy chat dance practice" returned
 * a real GIRLSET dance-practice video, just for a different song,
 * "Tweak"), so the caller (processing/resolveOfficial.js) verifies
 * candidates against the actual group it's resolving for rather than
 * trusting result order.
 *
 * `mustContainPhrase` is deliberately optional: requiring the literal word
 * "official" in an MV's title was a real bug — a genuine official upload
 * titled e.g. "KATSEYE - Animal (M/V)" doesn't contain that word at all,
 * so it got rejected by this filter before the caller ever got to check
 * whether the channel itself was really KATSEYE's. The channel match is
 * the reliable signal; the title phrase is only worth requiring when
 * there's no better option (see the 'dance practice' caller, where the
 * phrase itself is what we're looking for).
 */
export async function searchCandidatesContaining(query, mustContainPhrase, { maxResults = 5 } = {}) {
  const apiKey = getApiKey();
  const url = new URL(`${API_BASE}/search`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', String(maxResults));

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`YouTube search.list (resolve) failed for "${query}": ${res.status} ${body}`);
    // Flagged separately from other failures (a malformed query, a network
    // blip) so callers can stop trying further candidates immediately
    // instead of repeating the identical failure up to MAX_CANDIDATES_TO_
    // RESOLVE times with a full error dump each — genuinely happened while
    // testing this against real exhausted quota, not a hypothetical.
    try {
      const parsed = JSON.parse(body);
      err.quotaExceeded =
        parsed?.error?.status === 'RESOURCE_EXHAUSTED' ||
        parsed?.error?.errors?.[0]?.reason === 'rateLimitExceeded';
    } catch {
      // Body wasn't JSON (or didn't parse) — leave quotaExceeded unset,
      // treat as a normal per-candidate failure.
    }
    throw err;
  }
  const data = await res.json();
  const items = data.items || [];
  const phrase = mustContainPhrase ? mustContainPhrase.toLowerCase() : null;

  return items
    .filter((item) => !phrase || decodeHtmlEntities(item.snippet.title).toLowerCase().includes(phrase))
    .map((item) => ({
      videoId: item.id.videoId,
      title: decodeHtmlEntities(item.snippet.title),
      channelTitle: decodeHtmlEntities(item.snippet.channelTitle),
      publishedAt: item.snippet.publishedAt,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    }));
}

/**
 * Run all configured search queries, dedupe by video ID, attach stats.
 * Returns an array of enriched video objects.
 */
export async function scrapeYouTubeDanceTrends() {
  const byId = new Map();
  const failures = [];

  for (const query of YOUTUBE_SEARCH_QUERIES) {
    let results;
    try {
      results = await searchVideos(query);
    } catch (err) {
      console.warn(`[youtube] query "${query}" failed, skipping: ${err.message}`);
      failures.push({ query, message: err.message });
      continue;
    }
    for (const item of results) {
      if (!byId.has(item.videoId)) {
        byId.set(item.videoId, item);
      } else {
        // Video matched multiple queries — keep a record of that, it's a
        // useful signal (multi-query overlap = more clearly dance-related).
        byId.get(item.videoId).matchedQuery += `, ${query}`;
      }
    }
  }

  // If EVERY query failed (bad/revoked key, quota exhausted, YouTube API
  // outage, etc.), this is a real failure, not "zero trends this week" —
  // treat it as fatal so automation (scripts/weekly-run.sh) reports it
  // instead of silently shipping an empty dashboard. A partial failure
  // (some queries ok, some not) is still tolerated — see the try/catch
  // above — since one bad query shouldn't kill an otherwise-good run.
  if (failures.length === YOUTUBE_SEARCH_QUERIES.length && YOUTUBE_SEARCH_QUERIES.length > 0) {
    throw new Error(
      `All ${failures.length} search queries failed — treating as a fatal error rather than ` +
        `"0 trends found". First failure: ${failures[0].message}`
    );
  }

  const stats = await getVideoStats([...byId.keys()]);

  const videos = [...byId.values()].map((v) => ({
    ...v,
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
    ...(stats.get(v.videoId) || { viewCount: 0, likeCount: 0, commentCount: 0, duration: null }),
  }));

  videos.sort((a, b) => b.viewCount - a.viewCount);
  return videos;
}

function saveToCache(videos) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(CACHE_DIR, `youtube-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ scrapedAt: new Date().toISOString(), videos }, null, 2));
  return outPath;
}

async function main() {
  // Fail fast with one clear message instead of repeating a "missing key"
  // warning per query and writing out a misleading empty result file.
  getApiKey();

  console.log('Scraping YouTube for K-pop dance trend videos...');
  console.log(`Queries: ${YOUTUBE_SEARCH_QUERIES.join(' | ')}`);
  const videos = await scrapeYouTubeDanceTrends();

  const outPath = saveToCache(videos);
  console.log(`\nFound ${videos.length} unique videos. Cached to ${outPath}\n`);

  console.log('Top 10 by view count:');
  for (const v of videos.slice(0, 10)) {
    console.log(`  ${v.viewCount.toLocaleString()} views — "${v.title}" (${v.channelTitle}) — ${v.url}`);
  }
}

// Only run when executed directly (`node src/scrapers/youtube.js`), not when imported.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(`\n[youtube] Fatal error: ${err.message}`);
    process.exitCode = 1;
  });
}
