// Persistent cache of resolved official videos, keyed by a dance's
// identity tokens. An official MV or dance-practice video doesn't change
// once resolved, and the same trending songs often persist across several
// days/refreshes — caching means a given song only ever costs YouTube API
// quota to resolve ONCE, not on every single run.
//
// Built after hitting the daily search quota (100 search.list calls/day)
// multiple times in one day of testing — this, not a lower
// MAX_CANDIDATES_TO_RESOLVE, is the actual fix for "how many refreshes can
// I realistically do per day."

import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from '../config.js';

const CACHE_FILE = path.join(CACHE_DIR, 'official-resolved.json');

// Sorted rather than insertion-order — the same dance's shared tokens can
// come out in a different order depending on which video happened to be
// the group's representative that run, and this needs to hit the same
// cache entry regardless.
function cacheKey(tokens) {
  return [...tokens].sort().join(' ');
}

function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch (err) {
    console.warn(`[officialCache] cache file unreadable, starting fresh: ${err.message}`);
    return {};
  }
}

function saveCache(cache) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

export function getCachedOfficial(tokens) {
  const cache = loadCache();
  const entry = cache[cacheKey(tokens)];
  return entry ? entry.official : null;
}

// Only successful resolutions get cached — a "no official video found"
// result is deliberately NOT cached, since a song with no official video
// today might get one later (e.g. a rookie group's MV releasing after its
// choreography already started trending as a leak/practice video). A miss
// just gets retried next time instead of being permanently blocked.
export function setCachedOfficial(tokens, official) {
  const cache = loadCache();
  cache[cacheKey(tokens)] = { official, resolvedAt: new Date().toISOString() };
  saveCache(cache);
}
