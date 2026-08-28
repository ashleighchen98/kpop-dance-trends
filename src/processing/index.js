// Processing pipeline: latest raw scrape -> filter -> rank -> group ->
// resolve official video -> save.
//
// Ranking here is "how many distinct videos we found doing this dance" —
// see groupSimilarTrends — not just how big one video got. That's the
// actual "how viral is this REALLY" signal; the per-video virality score
// from rank.js still exists, but only to pick which member represents a
// group and as secondary context, not as the primary ranking.
//
// NOTE: this now makes live YouTube API calls (resolving each candidate's
// official dance-practice/MV video — see resolveOfficial.js) rather than
// working purely from the cached scrape. If that fails entirely (no API
// key, quota exhausted), every candidate fails to resolve and the top list
// comes back empty rather than silently wrong — see main()'s error handling.
//
// Usage:
//   npm run process
//   node src/processing/index.js

import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, MIN_VIEW_COUNT_FOR_RANKING, TOP_N } from '../config.js';
import { filterDanceTrends } from './filter.js';
import { rankByVirality } from './rank.js';
import { groupSimilarTrends } from './dedupe.js';
import { resolveTopGroups } from './resolveOfficial.js';

function findLatestScrapeFile() {
  if (!fs.existsSync(CACHE_DIR)) return null;
  const files = fs
    .readdirSync(CACHE_DIR)
    .filter((f) => /^youtube-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort(); // ISO dates sort correctly as strings
  if (files.length === 0) return null;
  return path.join(CACHE_DIR, files[files.length - 1]);
}

// Flattens a resolved group into a single dashboard-friendly object: the
// representative (highest-scoring) member's own fields, the group's exact
// in-sample duplicate count, and the resolved official video to link to.
function flattenGroup(group) {
  const rep = group.videos[0];
  return {
    ...rep,
    sampleVideoCount: group.videos.length, // exact — how many WE found doing this dance
    official: group.official, // { videoId, title, channelTitle, thumbnail, url, kind }
  };
}

export async function runProcessingPipeline() {
  const scrapeFile = findLatestScrapeFile();
  if (!scrapeFile) {
    throw new Error(
      'No scrape data found in data/cache/. Run "npm run scrape:youtube" first.'
    );
  }

  const { scrapedAt, videos: rawVideos } = JSON.parse(fs.readFileSync(scrapeFile, 'utf8'));

  const filtered = filterDanceTrends(rawVideos);
  const eligible = filtered.filter((v) => v.viewCount >= MIN_VIEW_COUNT_FOR_RANKING);
  const ranked = rankByVirality(eligible);
  const groups = groupSimilarTrends(ranked); // sorted by representative peak score

  // Re-sort by how many distinct videos we found for each dance — that's
  // the real "how many people are doing this" signal, bounded by our own
  // scrape sample (see README) but honest and exact, unlike a global
  // estimate. Peak video score is the tiebreak among equal counts.
  const byPopularity = [...groups].sort((a, b) => {
    if (b.videos.length !== a.videos.length) return b.videos.length - a.videos.length;
    return b.videos[0].scores.virality - a.videos[0].scores.virality;
  });

  const resolvedGroups = await resolveTopGroups(byPopularity, TOP_N);
  const top = resolvedGroups.map(flattenGroup);

  return {
    scrapeFile,
    scrapedAt,
    rawCount: rawVideos.length,
    filteredCount: filtered.length,
    eligibleCount: eligible.length,
    groupedCount: groups.length,
    top,
  };
}

function saveRanked(result) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(CACHE_DIR, `ranked-${stamp}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      { processedAt: new Date().toISOString(), sourceScrapedAt: result.scrapedAt, videos: result.top },
      null,
      2
    )
  );
  return outPath;
}

async function main() {
  const result = await runProcessingPipeline();
  console.log(`Source: ${result.scrapeFile} (scraped ${result.scrapedAt})`);
  console.log(
    `${result.rawCount} raw results -> ${result.filteredCount} pass the dance-trend filter -> ` +
      `${result.eligibleCount} meet the view threshold -> ${result.groupedCount} distinct dances found\n`
  );

  if (result.top.length === 0) {
    console.log(
      'No dances resolved to an official video — check YOUTUBE_API_KEY is valid, or that ' +
        'MAX_CANDIDATES_TO_RESOLVE (src/config.js) is high enough for this scrape.'
    );
  }

  console.log(`Top ${result.top.length} by how many videos we found doing each dance:\n`);
  result.top.forEach((v, i) => {
    console.log(
      `${i + 1}. ${v.sampleVideoCount} version(s) found — "${v.title}" — ${v.channelTitle}\n` +
        `   top video: ${v.viewCount.toLocaleString()} views, virality score ${v.scores.virality}\n` +
        `   official (${v.official.kind}): ${v.official.title} — ${v.official.channelTitle}\n` +
        `   ${v.official.url}\n`
    );
  });

  const outPath = saveRanked(result);
  console.log(`Saved ranked results to ${outPath}`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(`\n[process] Fatal error: ${err.message}`);
    process.exitCode = 1;
  });
}
