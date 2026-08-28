// Renders the latest ranked results into a static HTML dashboard.
// No build step, no external requests at render time — one self-contained
// file you can open directly in a browser (thumbnails hotlink to YouTube's
// CDN, everything else is inline).
//
// Usage:
//   npm run dashboard
//   node src/dashboard/generate.js

import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, OUTPUT_DIR, TOP_N } from '../config.js';

function findLatestRankedFile() {
  if (!fs.existsSync(CACHE_DIR)) return null;
  const files = fs
    .readdirSync(CACHE_DIR)
    .filter((f) => /^ranked-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (files.length === 0) return null;
  return path.join(CACHE_DIR, files[files.length - 1]);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCompact(n) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function daysAgo(isoDateString) {
  const days = Math.floor((Date.now() - new Date(isoDateString).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function renderCard(video, rank) {
  const scorePct = Math.round(video.scores.virality * 100);
  const versionWord = video.sampleVideoCount === 1 ? 'version' : 'versions';

  return `
    <article class="card">
      <div class="rank">#${rank}</div>
      <a class="thumb-link" href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer">
        <img class="thumb" src="${escapeHtml(video.thumbnail || '')}" alt="" loading="lazy" />
      </a>
      <div class="card-body">
        <h2 class="title">
          <a href="${escapeHtml(video.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(video.title)}</a>
        </h2>
        <div class="channel">${escapeHtml(video.channelTitle)} · ${daysAgo(video.publishedAt)} · trending example</div>

        <div class="count-hero">
          <span class="count-value">${video.sampleVideoCount}</span>
          <span class="count-label">${versionWord} of this dance found this week</span>
        </div>

        <div class="stats">
          <div class="stat"><span class="stat-label">Top video views</span><span class="stat-value">${formatCompact(video.viewCount)}</span></div>
          <div class="stat"><span class="stat-label">Likes</span><span class="stat-value">${formatCompact(video.likeCount)}</span></div>
          <div class="stat"><span class="stat-label">Comments</span><span class="stat-value">${formatCompact(video.commentCount)}</span></div>
        </div>

        <div class="score-row">
          <span class="score-label">Top video score</span>
          <div class="score-bar"><div class="score-fill" style="width:${scorePct}%"></div></div>
          <span class="score-value">${scorePct}</span>
        </div>

        <a class="watch-btn" href="${escapeHtml(video.official.url)}" target="_blank" rel="noopener noreferrer">
          ▶ Watch ${video.official.isOfficialChannel ? 'official ' : ''}${escapeHtml(video.official.kind)} ↗
        </a>
        <div class="official-caption">
          ${escapeHtml(video.official.channelTitle)}${video.official.isOfficialChannel ? '' : ' (fan-made, not the artist\'s own channel)'}
        </div>
      </div>
    </article>`;
}

function renderDashboard({ videos, sourceScrapedAt, processedAt }) {
  const weekLabel = new Date(processedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const cards = videos.map((v, i) => renderCard(v, i + 1)).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>K-pop Dance Trends — ${escapeHtml(weekLabel)}</title>
<style>
  :root {
    --bg: #0f1117;
    --card-bg: #171a23;
    --card-border: #262b38;
    --text: #f1f2f6;
    --text-dim: #9aa1b4;
    --accent: #ff3d77;
    --accent-2: #7c5cff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: 32px 20px 64px;
  }
  header {
    max-width: 1100px;
    margin: 0 auto 32px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
  }
  header h1 {
    font-size: 28px;
    margin: 0 0 4px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  header p {
    margin: 0;
    color: var(--text-dim);
    font-size: 14px;
  }
  .refresh-panel {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  #refresh-btn {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    color: var(--text);
    font-weight: 600;
    font-size: 13.5px;
    padding: 10px 16px;
    border-radius: 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  #refresh-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  #refresh-btn:disabled { opacity: 0.6; cursor: default; }
  #refresh-status {
    font-size: 12px;
    color: var(--text-dim);
    max-width: 220px;
    text-align: right;
  }
  #refresh-status.error { color: var(--accent); }
  .grid {
    max-width: 1100px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
  }
  .card {
    position: relative;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .rank {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(0,0,0,0.65);
    color: var(--text);
    font-weight: 700;
    font-size: 13px;
    padding: 4px 10px;
    border-radius: 999px;
    z-index: 1;
  }
  .thumb-link { display: block; background: #000; }
  .thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    display: block;
  }
  .card-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
  .title { font-size: 15px; line-height: 1.35; margin: 0; }
  .title a { color: var(--text); text-decoration: none; }
  .title a:hover { color: var(--accent); }
  .channel { font-size: 12.5px; color: var(--text-dim); }
  .count-hero {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 10px 12px;
    background: linear-gradient(90deg, rgba(255,61,119,0.12), rgba(124,92,255,0.12));
    border: 1px solid var(--card-border);
    border-radius: 10px;
  }
  .count-value { font-size: 22px; font-weight: 800; color: var(--text); }
  .count-label { font-size: 12px; color: var(--text-dim); line-height: 1.3; }
  .stats { display: flex; gap: 16px; padding: 8px 0; border-top: 1px solid var(--card-border); border-bottom: 1px solid var(--card-border); }
  .stat { display: flex; flex-direction: column; gap: 2px; }
  .stat-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
  .stat-value { font-size: 15px; font-weight: 700; }
  .score-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-dim); }
  .score-bar { flex: 1; height: 6px; background: var(--card-border); border-radius: 999px; overflow: hidden; }
  .score-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
  .score-value { font-weight: 700; color: var(--text); width: 22px; text-align: right; }
  .watch-btn {
    margin-top: auto;
    text-align: center;
    background: var(--accent);
    color: #fff;
    text-decoration: none;
    font-weight: 600;
    font-size: 13.5px;
    padding: 10px 12px;
    border-radius: 8px;
  }
  .watch-btn:hover { background: var(--accent-2); }
  .official-caption { text-align: center; font-size: 11px; color: var(--text-dim); margin-top: -4px; }
  footer {
    max-width: 1100px;
    margin: 32px auto 0;
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
</head>
<body>
  <header>
    <div>
      <h1>Top K-pop Dance Trends this week</h1>
      <p>For dancewithashs · generated ${escapeHtml(weekLabel)} · source data scraped ${escapeHtml(new Date(sourceScrapedAt).toLocaleString('en-US'))}</p>
    </div>
    <div class="refresh-panel">
      <button id="refresh-btn">↻ Refresh trends</button>
      <span id="refresh-status"></span>
    </div>
  </header>
  <main class="grid">
    ${cards}
  </main>
  <footer>
    Ranked by how many distinct videos were found doing each dance this week — a real, exact
    count, not an estimate, but bounded by this week's scrape sample, not a true site-wide total.
    "Top video score" per card (view count + engagement rate + recency) describes that one
    trending example, not the whole trend. The "Watch official" link is a separately-verified
    dance practice or official MV — anything that didn't resolve to one of those wasn't included
    at all. Source: YouTube Data API v3, public data only.
  </footer>
  <script>
    (function () {
      var btn = document.getElementById('refresh-btn');
      var status = document.getElementById('refresh-status');

      if (location.protocol === 'file:') {
        // No server behind this file — a static file can't run the scraper.
        btn.disabled = true;
        btn.textContent = '↻ Refresh (needs server)';
        status.textContent = 'Run "npm run serve" and open http://localhost:4173 to refresh from here.';
        return;
      }

      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Refreshing…';
        status.className = '';
        status.textContent = 'Re-scraping YouTube, this can take 15–30s…';

        fetch('/refresh', { method: 'POST' })
          .then(function (res) { return res.json().then(function (body) { return { res: res, body: body }; }); })
          .then(function (result) {
            if (result.res.ok && result.body.ok) {
              status.textContent = 'Done — reloading…';
              location.reload();
            } else {
              btn.disabled = false;
              btn.textContent = '↻ Refresh trends';
              status.className = 'error';
              status.textContent = 'Refresh failed: ' + (result.body.error || 'exit code ' + result.body.exitCode) + '. Check logs/.';
            }
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.textContent = '↻ Refresh trends';
            status.className = 'error';
            status.textContent = 'Request failed: ' + err.message;
          });
      });
    })();
  </script>
</body>
</html>
`;
}

function main() {
  const rankedFile = findLatestRankedFile();
  if (!rankedFile) {
    throw new Error('No ranked data found in data/cache/. Run "npm run process" first.');
  }

  const { processedAt, sourceScrapedAt, videos } = JSON.parse(fs.readFileSync(rankedFile, 'utf8'));
  const top = videos.slice(0, TOP_N);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, 'dashboard.html');
  fs.writeFileSync(outPath, renderDashboard({ videos: top, sourceScrapedAt, processedAt }));

  console.log(`Source: ${rankedFile}`);
  console.log(`Dashboard written to ${outPath} (${top.length} videos)`);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
