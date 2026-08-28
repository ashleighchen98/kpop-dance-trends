// Collapses near-duplicate trend entries so the top N represents N
// distinct dances worth considering, not the same dance taking multiple
// slots. Real cases this was built to catch:
//
//   1. Two near-identical "RUKA's solo dance practice" uploads — same
//      official channel, different video IDs, basically the same video
//      posted twice (a re-upload/edit).
//   2. Two different creators both covering ATEEZ "BAD" — genuinely
//      different videos and channels, but the same underlying dance trend,
//      so showing both doesn't give you two ideas, it gives you one idea
//      twice.
//
// Exact video-ID dedup (already done in the scraper) doesn't catch either
// of these. This compares titles instead, after stripping the genre/filler
// words that show up in nearly every dance-trend title.
//
// KNOWN LIMITATION, found and deliberately not "fixed": a couple of videos
// turned out to ALSO be about ATEEZ "BAD" (skit-style titles like "Worker
// Dancing in Secret..?" that never mention the song — only their
// descriptions do, via hashtags like "#ateez #dancechallenge"). Pulling
// description text into the comparison to catch that was tried, but
// hashtags like "#kpopdancecover" are single fused words with no internal
// spaces, so filler-word stripping can't decompose them — including them
// as-is inflates token sets enough to dilute the ratio below threshold,
// which broke the ATEEZ merge case above that was already confirmed
// working. Regressing a confirmed fix to chase an edge case that hasn't
// actually been reported wasn't the right trade — title-only stays.
export const KNOWN_LIMITATION =
  'Dedup only compares titles, not descriptions — a duplicate whose only ' +
  'connection to another video is in its description (not its title) can slip through.';

// Words that carry no identifying information about WHICH dance a video is
// — they show up across almost every result (that's the point, they're
// what we searched for) so they're noise for telling two trends apart.
// NOTE: "what" and "whats" were removed from here after a real bug —
// KISS OF LIFE's actual song "WHAT!" was being stripped as filler,
// leaving only the group name as identity tokens ("kiss", "life"), which
// then matched a DIFFERENT KISS OF LIFE song at 100% overlap and resolved
// to the wrong official video. A common word that's also a real song
// title breaks the "generic word" assumption this list depends on — kept
// here as a warning against re-adding words like it without checking
// whether they're a real song title first.
const FILLER_WORDS = new Set([
  'dance', 'dancing', 'cover', 'covers', 'practice', 'challenge', 'challenges',
  'choreo', 'choreography', 'tutorial', 'mirrored', 'mirror', 'cam',
  'public', 'in', 'kpop', 'trend', 'trending', 'trends', 'blooper', 'bloopers',
  'one', 'take', 'official', 'mv', 'audio', 'lyrics', 'lyric', 'video', 'videos',
  'the', 'of', 'with', 'by', 'vs', 'and', 'feat', 'ft', 'featuring', 'from',
  'shorts', 'short', 'viral', 'funny', 'game', 'games', 'level', 'her', 'his',
  'this', 'that', 'my', 'your', 'how', 'to',
]);

// Fraction of the smaller token set that must overlap. Was 0.6, lowered to
// 0.5 after hitting the exact same real bug twice: 3 ATEEZ "BAD" videos
// shared the identifying tokens {ateez, bad} (2, same in both cases) but
// each also had a couple of unrelated decorative words in its title
// ("(couple ver.)", "She so bad!") that dragged the ratio to exactly 0.5 —
// just under the 0.6 cutoff, so they stayed as 3 separate entries in the
// dashboard instead of 1. Verified against the full real result set
// (not just this case) before lowering — every group it produces at 0.5 is
// genuinely the same song, nothing unrelated merges.
const SIMILARITY_THRESHOLD = 0.5;
const MIN_SHARED_TOKENS = 2; // require at least 2 shared words, not one coincidental match

export function extractIdentityTokens(title) {
  const tokens = (title || '')
    .toLowerCase()
    // Hashtags repeat words already in the title — drop the whole tag
    // rather than fuse it into surrounding text (a fused word like
    // "kpopdancecover" can't be matched against separate filler words, and
    // letting it survive as one blob just adds noise). Matches word
    // characters only (not #\S+ — that was greedy enough to eat past stray
    // "#" characters from un-decoded HTML entities like "&#39;", a real bug
    // caught while testing; entities are decoded upstream now, but this
    // stays narrow regardless.
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // strip punctuation/emoji, keep letters (incl. Korean) + digits
    .split(/\s+/)
    .filter((tok) => tok.length >= 2 && !FILLER_WORDS.has(tok));
  return new Set(tokens);
}

function sharedTokenCount(a, b) {
  let count = 0;
  for (const tok of a) {
    if (b.has(tok)) count++;
  }
  return count;
}

/**
 * The same "is this the same dance" check used to group duplicates,
 * exported so other code (resolveOfficial.js, verifying a candidate
 * official video is actually about the right song) can reuse the exact
 * logic that's already been tuned and tested against real data, rather
 * than inventing a second, differently-tuned threshold.
 */
export function tokensAreSimilar(a, b) {
  if (a.size === 0 || b.size === 0) return false;
  const shared = sharedTokenCount(a, b);
  if (shared < MIN_SHARED_TOKENS) return false;
  return shared / Math.min(a.size, b.size) >= SIMILARITY_THRESHOLD;
}

/**
 * Takes videos already sorted by descending virality score. Groups them so
 * each group is one distinct dance — matching new videos against each
 * group's representative (its first, highest-scoring member), same
 * comparison dedupeSimilarTrends always used. Because the input is sorted
 * by score and a new group only starts when a video matches no existing
 * one, the returned groups are themselves already ordered by their
 * representative's peak score, highest first — callers that only care
 * about that ordering (not group membership) don't need to re-sort.
 *
 * Each group also gets `sharedTokens`: the intersection of every member's
 * identity tokens. Decorative per-video words ("(couple ver.)", "feat
 * brother") differ between members and drop out of an intersection, while
 * the actual identifying words (artist + song — the reason they grouped
 * together in the first place) survive. That makes it a natural,
 * heuristic-free source for a search query representing "this dance" —
 * used by resolveOfficial.js to find its official dance-practice/MV video.
 */
export function groupSimilarTrends(rankedVideos) {
  const groups = [];

  for (const video of rankedVideos) {
    const tokens = extractIdentityTokens(video.title);

    const group = groups.find((g) => tokensAreSimilar(tokens, g.tokenSets[0]));

    if (group) {
      group.videos.push(video);
      group.tokenSets.push(tokens);
    } else {
      groups.push({ videos: [video], tokenSets: [tokens] });
    }
  }

  return groups.map((g) => {
    let sharedTokens = new Set(g.tokenSets[0]);
    for (let i = 1; i < g.tokenSets.length; i++) {
      const next = g.tokenSets[i];
      sharedTokens = new Set([...sharedTokens].filter((tok) => next.has(tok)));
    }
    // A chain of pairwise matches (A~B, B~C) can leave an empty three-way
    // intersection even though every pair is genuinely related — fall back
    // to the representative's own tokens rather than hand countTrends.js an
    // empty query.
    if (sharedTokens.size === 0) sharedTokens = g.tokenSets[0];

    return { videos: g.videos, sharedTokens };
  });
}

/**
 * Keeps the best-scoring instance of each distinct dance and drops later
 * entries whose title strongly overlaps with one already kept — a thin
 * wrapper over groupSimilarTrends for callers that just want deduped
 * videos, not group membership.
 */
export function dedupeSimilarTrends(rankedVideos) {
  return groupSimilarTrends(rankedVideos).map((g) => g.videos[0]);
}
