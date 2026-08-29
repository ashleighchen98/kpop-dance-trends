// Resolves each dance group's OFFICIAL choreography source — a dance
// practice video, or failing that the official MV — via targeted searches,
// verified against the group's own identity tokens before accepting a
// result. A group that resolves to neither is dropped from the final top N
// entirely, rather than shown with a guessed or wrong link: in practice
// this also filters out content that isn't a real, identifiable K-pop
// release (skits, memes, a non-K-pop cover that only matched the search on
// genre words) — see resolveOne's comment for why.
//
// The verification step matters, not just the phrase match: caught on real
// data, a query "girlset itzy chat dance practice" returned a real GIRLSET
// dance-practice video that contained the phrase "dance practice" — for
// their song "Tweak," not "Chat." YouTube's search relevance had weighted
// the distinctive word "girlset" over the common word "chat." Checking that
// the CANDIDATE's own title actually shares the group's identity tokens
// (via dedupe.js's tokensAreSimilar — the same, already-tuned check used to
// group duplicates in the first place) catches that a phrase match alone
// doesn't.

import { searchCandidatesContaining } from '../scrapers/youtube.js';
import { extractIdentityTokens, tokensAreSimilar } from './dedupe.js';
import { MAX_CANDIDATES_TO_RESOLVE } from '../config.js';
import { getCachedOfficial, setCachedOfficial } from './officialCache.js';

// tokensAreSimilar requires 2+ shared words, tuned for comparing whole
// titles — a channel name is usually just the artist name, one word, so
// that check alone would always fail here even for genuinely official
// channels (real case: channel "ENHYPEN" only ever contributes the single
// token "enhypen"). This just checks for any overlap at all, which is
// enough for a channel name specifically.
function channelLooksOfficial(groupTokens, channelTitle) {
  const channelTokens = extractIdentityTokens(channelTitle);
  for (const tok of groupTokens) {
    if (channelTokens.has(tok)) return true;
  }
  return false;
}

async function resolveOne(group) {
  const tokens = [...group.sharedTokens];

  // An empty token set (every word turned out to be filler — a real case:
  // a title that was entirely generic Vietnamese boilerplate) can never
  // pass tokensAreSimilar against anything, so searching is a wasted quota
  // spend on a query that's guaranteed to resolve to null anyway.
  if (tokens.length === 0) return null;

  const base = tokens.join(' ');

  // Reaction/commentary videos routinely put "(Official Music Video)" in
  // their OWN title while quoting what they're reacting to — caught on
  // real data: a search for "official mv" surfaced one such video, and
  // checking for the word "official" alone didn't catch that it wasn't
  // the MV itself. Excluding "reaction" titles from both paths, not just
  // the MV one — a "dance practice reaction" is just as plausible.
  const isNotReaction = (c) => !c.title.toLowerCase().includes('reaction');
  const isVerified = (c) => tokensAreSimilar(group.sharedTokens, extractIdentityTokens(c.title));

  // Priority is "official channel, either kind" before "fan-made, either
  // kind" — not "dance practice before MV" regardless of who made it. Real
  // case that prompted this: KATSEYE "Hootie Frutti" dance-practice search
  // results were dominated by fan channels ("Golden Dance Initiative",
  // "Mikrokosmos"), and the old code took the first verified match
  // immediately — a fan cover — without ever checking whether the
  // official MV was available instead. A real official video is a better
  // link than someone else's cover, even if it's the MV rather than
  // choreography specifically.
  const practiceCandidates = await searchCandidatesContaining(`${base} dance practice`, 'dance practice');
  const verifiedPractice = practiceCandidates.filter((c) => isNotReaction(c) && isVerified(c));
  const officialPractice = verifiedPractice.find((c) => channelLooksOfficial(group.sharedTokens, c.channelTitle));
  if (officialPractice) {
    return { ...officialPractice, kind: 'dance practice', isOfficialChannel: true };
  }

  // No official dance-practice video — try the MV before settling for a
  // fan cover. Only reached when practice search didn't already turn up
  // the official channel, so this doesn't add a second search to the
  // common case (a real official dance practice existing and being found
  // first try).
  const mvCandidates = await searchCandidatesContaining(`${base} official mv`, 'official');
  const verifiedMv = mvCandidates.filter((c) => isNotReaction(c) && isVerified(c));
  const officialMv = verifiedMv.find((c) => channelLooksOfficial(group.sharedTokens, c.channelTitle));
  if (officialMv) {
    // Not 'official mv' — the dashboard template already prepends
    // "official " itself when isOfficialChannel is true (see
    // generate.js), so that value produced a real, shipped bug: "Watch
    // official official mv" on a live customer-facing card.
    return { ...officialMv, kind: 'MV', isOfficialChannel: true };
  }

  // Neither search found the official channel — explicit product decision:
  // no fan-made fallback. A group only gets shown at all if a REAL
  // official channel published an MV or dance practice for it, since
  // that's simultaneously the "link to the artist's own choreography"
  // requirement and a genuine K-pop/KATSEYE verification — a coincidental
  // keyword match never produces this, and neither does an unrelated fan
  // cover. This trades fewer results some weeks (a dance with only fan
  // covers now gets dropped instead of shown as a fallback) for every
  // shown result being fully verified — an explicit, deliberate trade.
  return null;
}

/**
 * Takes groups already ordered best-first. Walks down the list resolving
 * each group's official video, stopping once `limit` have resolved or
 * MAX_CANDIDATES_TO_RESOLVE candidates have been tried, whichever comes
 * first — bounds API cost predictably even when many candidates fail to
 * resolve.
 *
 * Checks the persistent cache (officialCache.js) before spending any API
 * calls on a candidate — a dance seen on a previous run doesn't cost
 * quota again. Cache hits don't count against MAX_CANDIDATES_TO_RESOLVE's
 * API-call budget at all (only real lookups do), so a mostly-cached run can
 * fill far more than 15 slots without touching the daily quota.
 */
export async function resolveTopGroups(groups, limit) {
  const resolved = [];
  let apiLookupsTried = 0;
  // Once true, stop attempting NEW live lookups — but keep scanning the
  // rest of `groups` for cache hits. A `break` here instead of a flag was
  // a real bug caught while testing this against genuinely exhausted
  // quota: it stopped the whole loop the moment quota ran out, which
  // silently dropped every CACHED (free, zero-cost) dance that happened to
  // sort after whichever uncached candidate hit the wall first — exactly
  // the scenario this cache exists to make free.
  let quotaExhausted = false;

  for (const group of groups) {
    if (resolved.length >= limit) break;
    const tokens = [...group.sharedTokens];

    const cached = getCachedOfficial(tokens);
    if (cached) {
      resolved.push({ ...group, official: cached });
      continue;
    }

    if (quotaExhausted || apiLookupsTried >= MAX_CANDIDATES_TO_RESOLVE) continue;
    apiLookupsTried++;

    try {
      const official = await resolveOne(group);
      if (official) {
        resolved.push({ ...group, official });
        setCachedOfficial(tokens, official);
      }
    } catch (err) {
      if (err.quotaExceeded) {
        quotaExhausted = true;
        console.warn(
          `[resolveOfficial] YouTube's daily search quota is exhausted — no more new lookups this run, ` +
            `but still checking remaining candidates against the cache. Resets on Google's clock ` +
            `(Pacific time), not necessarily today in your timezone.`
        );
        continue;
      }
      console.warn(`[resolveOfficial] lookup failed for [${tokens.join(' ')}]: ${err.message}`);
    }
  }

  return resolved;
}
