// Virality ranking: combines view count, engagement rate, and recency into
// a single 0-1 score per video. All three are relative to the current
// result set / lookback window — this ranks "what's hot this week among
// what we found," not an absolute cross-week virality metric.

import { LOOKBACK_DAYS } from '../config.js';

const WEIGHTS = {
  views: 0.5,
  engagement: 0.3,
  recency: 0.2,
};

// Engagement rate (likes+comments / views) for real viral videos is
// usually in the low single-digit percent. Treat 10% as "maxed out" so
// scores don't get crushed into a tiny range at the top end.
const ENGAGEMENT_RATE_CEILING = 0.1;

function daysSince(isoDateString) {
  return (Date.now() - new Date(isoDateString).getTime()) / (1000 * 60 * 60 * 24);
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Scores and sorts videos by virality. Returns new objects with the
 * component scores attached, so the dashboard/CLI can show its work
 * instead of just an opaque number.
 */
export function rankByVirality(videos, { lookbackDays = LOOKBACK_DAYS } = {}) {
  if (videos.length === 0) return [];

  // Log scale for views: a 65M-view video and a 2M-view video shouldn't
  // be ~30x apart in score — view counts are heavy-tailed, raw scaling
  // would let one outlier dominate the whole ranking.
  const logViews = videos.map((v) => Math.log10(v.viewCount + 1));
  const maxLogViews = Math.max(...logViews, 1);

  const scored = videos.map((v, i) => {
    const viewScore = clamp01(logViews[i] / maxLogViews);

    const engagementRate = v.viewCount > 0 ? (v.likeCount + v.commentCount) / v.viewCount : 0;
    const engagementScore = clamp01(engagementRate / ENGAGEMENT_RATE_CEILING);

    const ageDays = daysSince(v.publishedAt);
    const recencyScore = clamp01(1 - ageDays / lookbackDays);

    const viralityScore =
      viewScore * WEIGHTS.views + engagementScore * WEIGHTS.engagement + recencyScore * WEIGHTS.recency;

    return {
      ...v,
      scores: {
        view: Number(viewScore.toFixed(3)),
        engagement: Number(engagementScore.toFixed(3)),
        recency: Number(recencyScore.toFixed(3)),
        virality: Number(viralityScore.toFixed(3)),
      },
    };
  });

  scored.sort((a, b) => b.scores.virality - a.scores.virality);
  return scored;
}
