# K-pop Dance Trends Tracker

Weekly content-planning tool for [dancewithashs](https://www.tiktok.com) — surfaces trending K-pop
dance challenges worth filming.

## Status: Day 4 (scraper + filtering + ranking + dashboard + automation)

### Why this doesn't scrape TikTok (yet)

The original plan was TikTok + YouTube from Day 1. I tested TikTok's public hashtag pages
directly (`tiktok.com/tag/kpopdance`) and TikTok's own Creative Center trends tool before writing
any code, and both are gated:

- Hashtag pages return a bot-detection shell with no video/stat data — real content loads via
  signed XHR calls (`X-Bogus`, `msToken`) that rotate and are designed to block non-browser
  clients.
- TikTok has no public API for hashtag/trend discovery for regular developers. The TikTok
  Research API exists but is restricted to vetted academic applicants.
- Creative Center's trend data API is also gated behind session/auth requirements.

Reverse-engineering TikTok's request signing to get around this would be bot-detection evasion —
not something worth building, and it breaks every time TikTok rotates their scheme anyway.

**Decision (per your call):** ship YouTube-only for v1. TikTok can be revisited later via a
third-party data provider (e.g. Apify's TikTok Scraper, a RapidAPI TikTok endpoint) if you decide
the cost/reliability trade-off is worth it — that just needs an API key dropped into `.env`, the
integration point can be added without restructuring anything.

### What's built

- Project scaffold (this structure)
- `src/scrapers/youtube.js` — pulls candidate dance-trend videos from the **official YouTube Data
  API v3** (`search.list` + `videos.list`), dedupes, attaches view/like/comment counts, caches
  results to `data/cache/`.
- `src/processing/filter.js` — separates real dance-trend content (challenges, covers, practice,
  "in public" covers) from false positives that just match the search keywords (song uploads,
  a mobile game clip that happened to say "kpop dance" — a real example this pulled up on Day 1).
- `src/processing/rank.js` — virality score per video: log-scaled view count (50%) + engagement
  rate (30%) + recency (20%). Videos under `MIN_VIEW_COUNT_FOR_RANKING` (default 10,000) are
  excluded from ranking — otherwise a video with a handful of views and a lucky like ratio can
  outrank something actually spreading (caught this on real data, see `src/config.js` comment).
- `src/processing/index.js` — runs the full filter → threshold → rank pipeline against the latest
  scrape, prints a scored top-10, saves to `data/cache/ranked-<date>.json`.
- `src/dashboard/generate.js` — renders `output/dashboard.html`: a self-contained static page
  (no build step, no external requests except hotlinked YouTube thumbnails) with ranked cards —
  thumbnail, view/like/comment counts, virality score bar, and a link to the original video/
  choreography for each of the top 10.

- `scripts/weekly-run.sh` — runs `scrape:youtube` → `process` → `dashboard` in sequence, logs
  everything to `logs/`, and exits non-zero if the run actually failed. Meant to be driven by
  cron (see below), but also fine to run by hand: `npm run weekly`.

  Two real bugs got caught and fixed while building/testing this against real failure scenarios,
  not just the happy path:
  - The script originally reported "succeeded" even when a step failed, because a trailing
    `echo` inside the tested block masked the real exit code (a `{ }` group's exit status is
    just its last command's status). Fixed by chaining the real commands with `&&` instead.
  - The YouTube scraper treated "every search query failed" (e.g. a revoked/invalid API key) the
    same as "found 0 trends this week" — silently writing an empty dashboard with exit code 0.
    Fixed so an all-queries-failed run throws and the whole pipeline correctly reports failure.

### Automation (cron)

`scripts/weekly-run.sh` sets its own `PATH` so it works from cron's minimal environment, not just
an interactive shell.

To run it every Monday at 9am, add this to your crontab:

```
0 9 * * 1 /Users/ash/Documents/kpop-dance-trends/scripts/weekly-run.sh
```

```bash
crontab -e   # opens your crontab in an editor; paste the line above, save, quit
crontab -l   # confirm it's there
```

Cron jobs only run while your Mac is on and awake at that time — if it's asleep, that week's run
is just skipped until the next scheduled time (no catch-up). Check `logs/` after a scheduled run
to confirm it worked, or to see why it didn't.

### Duplicate dances in the top 10 (fixed)

You caught this on real output: RUKA's solo dance practice showed up twice, and ATEEZ "BAD"
showed up twice (two different creators covering the same song). Root causes, both fixed:

- `src/processing/dedupe.js` — new step, added after ranking. Compares titles with genre/filler
  words stripped out ("dance", "cover", "in public", etc.), and collapses entries whose remaining
  identifying words substantially overlap — catches both a straight re-upload (RUKA) and two
  different channels covering the same song (ATEEZ). Keeps the higher-scoring instance.
- While building that, found the real reason ATEEZ "BAD" didn't dedupe on the first attempt: the
  YouTube API sometimes returns titles with HTML entities un-decoded (`&#39;` instead of `'`) —
  affected 17 of 72 titles in one real scrape. A hashtag-stripping regex was matching straight
  through the `#` in `&#39;` and eating the word "BAD" along with it. Fixed at the source in
  `src/scrapers/youtube.js` (entities are decoded once, right after fetching), which also fixed a
  second bug this had been silently causing: dashboard cards were displaying literal `&#39;` text
  instead of an apostrophe.

### Non-dance content in the top 10 (fixed)

You flagged 3 videos in one dashboard that weren't real choreography content. Traced each to a
distinct root cause and added a targeted `NON_DANCE_EXCLUDE_KEYWORDS` entry (see `src/config.js`):

- `"THIS OR THAT CHALLENGE"` — an interactive game-short format, not a performance
- `"...Macarena Dance Challenge"` — Macarena isn't K-pop at all; the video had hashtag-stuffed
  `#kpop #kpopdance` onto unrelated content purely to ride the search
- `"BTS's Most Famous Dance Challenge"` — compilation/listicle phrasing, not a single performance

Fixing those pulled a 4th case into view during verification (not something to skip past just
because it wasn't the one reported): a trivia channel had hashtag-stuffed `#dance #challenge`
onto "Guess the KATSEYE Member by Their Hairstyle" — same tag-riding pattern, different genre.
Added `'guess the'` / `'trivia'` excludes for that.

**A related dedup limitation, found and deliberately left as-is rather than shipped half-fixed:**
two videos turned out to also be about ATEEZ "BAD" via skit-style titles that never mention the
song — only their descriptions do. Pulling description text into `dedupe.js`'s comparison was
tried, but hashtags like `#kpopdancecover` are single fused words with no internal spaces, so
filler-word stripping can't decompose them — including them as-is diluted the similarity ratio
enough to break the ATEEZ dedup case that was already confirmed working. Regressing a confirmed
fix to chase an edge case you hadn't actually flagged wasn't the right trade, so dedup stays
title-only; the limitation is documented at the top of `src/processing/dedupe.js`.

### ATEEZ "BAD" duplicated AGAIN after a later refresh (fixed)

Hit on a real refresh via the one-click launcher: 3 top-10 entries were all ATEEZ "BAD" again,
even with the dedup fix above still in place. Root cause was different this time, and more
fundamental: the similarity check requires shared identifying words to be at least 60% of the
smaller title's word set — but the 3 titles this time were `"ATEEZ - BAD (couple ver.) in
public..."`, `"She so bad! ateez | Dance cover..."`, and `"...ATEEZ(에이티즈) - 'BAD' | DANCE
COVER..."`. Every pair shared exactly the identifying words `{ateez, bad}`, but each title also
had a couple of unrelated decorative words ("couple ver.", "she so"), which dragged the ratio down
to exactly 0.5 — just under the 0.6 cutoff. The threshold had passed by an equally narrow margin
(0.667) the first time it was tested, so this was always going to fail on some future scrape, just
a question of when.

Lowered `SIMILARITY_THRESHOLD` to 0.5 in `src/processing/dedupe.js` — but not on faith. Tested
against the full real result set first (not just the 3 videos in question): grouped all videos by
similarity at the new threshold and manually reviewed every group of 2+. Every single group was
genuinely the same song — including catching 7 separate ATEEZ "BAD" uploads and 8 separate KATSEYE
"Hootie Frutti" covers that the old 0.6 threshold had been leaving scattered as separate entries
the whole time, not just occasionally slipping past it. Re-ran the actual pipeline afterward and
confirmed 0 repeats in a fresh top 10.

### Ranking by real video count + official video links (major change)

The original ask: rank by how many videos actually exist for a dance (breadth of adoption), not
just how big one video got, and link to the real MV or official dance-practice video instead of
whichever creator's cover happened to score highest.

**Tried first, doesn't work:** using YouTube search's `pageInfo.totalResults` to estimate a global
video count per song. Verified directly against the live API — it caps at a flat **1,000,000** for
any broadly-matching query, dropping to an exact 0 only when nothing matches at all. No gradation
in between, so it can't tell a moderately-known dance from a massive one; every popular song tied
at the same fake number. Removed entirely rather than shipped as a misleading stat.

**What ranking uses instead:** how many distinct videos our own scrape found doing the same dance —
exact and real, just bounded by this week's sample rather than a true site-wide total (the same
grouping infrastructure that already caught the RUKA/ATEEZ duplicates, in `dedupe.js`'s
`groupSimilarTrends`).

**Official video resolution** (`src/processing/resolveOfficial.js`, `resolveOfficialVideo` in
`scrapers/youtube.js`): for each candidate dance, searches for its official dance-practice video
first, falling back to the official MV, and only accepts a result if it's actually verified —
not just found. A group that resolves to neither is **dropped from the top 10 entirely** rather
than shown with a wrong link; in practice this doubles as a K-pop-authenticity filter, since fan
skits, memes, and non-K-pop covers (a Michael Jackson cover turned up in one real run) don't have
an official MV or dance-practice video to find.

Three real accuracy bugs found and fixed by testing against the actual live pipeline, not just
inspecting the code:

- **Wrong-song match:** verifying only that a result's title contained the phrase "dance practice"
  wasn't enough — a search for `"girlset itzy who wins chat dance practice"` returned a real
  GIRLSET dance-practice video, just for their song "Tweak," not "Chat." YouTube's relevance
  ranking had weighted the distinctive word "girlset" over the common word "chat." Fixed by also
  requiring the candidate's own title to pass `tokensAreSimilar` against the group's identity
  tokens — the same, already-tuned check `dedupe.js` uses to group duplicates in the first place,
  exported for reuse rather than inventing a second threshold.
- **Reaction video mistaken for the MV:** checking only for the word "official" in a title matched
  a reaction video whose own title said `"(Official Music Video) - REACTION"` — it was reacting to
  the MV, not the MV itself. Fixed by excluding any candidate whose title contains "reaction".
- **Crew name coincidence:** "Baby Warriors" videos captioned "Choreography by BABY WARRIORS" (an
  original dance crew's own routine, not a song cover) resolved to an unrelated BabyMonster
  practice video that happened to also say "Baby Warriors" — a 2-word coincidental match. Left as
  a known, documented limitation rather than patched: raising the match threshold to fix it would
  break the currently-correct 2-token matches (ATEEZ+BAD, RUKA+solo, CORTIS+REDRED all rely on
  exactly 2 shared tokens), and distinguishing "original crew choreography" from "song cover" isn't
  solvable by tightening a token-overlap number.

**Real quota cost, confirmed by actually hitting the wall:** each candidate costs 1-2 `search.list`
calls, and `search.list` is 100 quota units per call. YouTube's free tier is 10,000 units/day —
only **100 search.list calls total, for the whole day**. `MAX_CANDIDATES_TO_RESOLVE` was 25 (up to
50 searches — half the entire day's quota in a single run); running `npm run process` a handful of
times while testing exhausted the full daily quota outright (a real `429 RESOURCE_EXHAUSTED`, not
a hypothetical). Lowered to 15. **Practical upshot: expect about one full refresh per day**, not
several — the manual refresh button and the weekly cron job both draw from the same daily quota.
The pipeline degrades gracefully when quota runs out mid-run (confirmed live): each candidate that
fails logs a warning and is skipped rather than crashing the whole run; whatever resolved before
running out still gets shown.

### Two more real bugs found the next day, on a clean quota reset

- **Wrong song, again:** KISS OF LIFE's actual song "WHAT!" was being stripped from its own
  identity tokens because `"what"` was in `FILLER_WORDS` (added early on for phrases like "What's
  Her Dance Level?"). That left only the group name ("kiss", "life") as tokens, which matched a
  *different* KISS OF LIFE song ("Lips Hips Kiss") at 100% overlap. A common English word that's
  also a real song title breaks the "generic word" assumption the filler list depends on — removed
  `"what"`/`"whats"` from it, with a comment warning against re-adding words like it. Verified fixed
  against the real case: it now resolves to itself.
- **"Official" wasn't always official:** content verification (does the candidate's title match
  the right song) was working, but nothing checked whether the *channel* was genuinely the artist's
  own — repeated real runs showed KATSEYE "Hootie Frutti" and "Animal" both resolving to fan mirror-
  dance channels ("Golden Dance Initiative", "Mikrokosmos") rather than KATSEYE's own channel, and
  once even ILLIT resolving to a random fan channel on one run (search result ordering isn't fully
  stable between calls). Rather than drop these — a fan dance-practice video is still useful
  choreography content — added a channel-overlap check (`channelLooksOfficial` in
  `resolveOfficial.js`) and made the dashboard honest about the difference: the button only says
  "official" when the channel name itself matches the artist, otherwise it says "Watch dance
  practice" with a "(fan-made, not the artist's own channel)" caption. Confirmed both label states
  render correctly on real data.

### Caching resolved official videos (the real fix for daily quota)

Lowering `MAX_CANDIDATES_TO_RESOLVE` only bounds cost per run — it doesn't help with the actual
problem, which is that the same trending songs get re-resolved from scratch on every single
refresh even though their official video never changes. `src/processing/officialCache.js` fixes
that properly: a persistent, non-date-stamped cache (`data/cache/official-resolved.json`) keyed by
a dance's identity tokens. Once ATEEZ "BAD" resolves once, every future run — that day, the next
day, weeks later — reuses it for free. Only genuinely new dances spend quota; a cache hit doesn't
count against `MAX_CANDIDATES_TO_RESOLVE` at all, so a mostly-cached run can fill far more than 15
slots without touching the daily limit.

Verified this for real, not just by reading the code: seeded the cache with 6 dances already
confirmed correct from earlier the same day (derived their real cache keys using the actual local
grouping logic — `groupSimilarTrends`'s token intersection — not guessed), then ran the full
pipeline again with the daily quota still genuinely exhausted (confirmed with a live test call
first). All 6 resolved with zero new API calls and zero errors; every other, uncached candidate
still correctly attempted a live lookup and failed with the same real `429`, proving the cache
doesn't silently fake data for anything it hasn't actually resolved.

A cache miss (no official video found) is deliberately NOT cached — a song with no official video
today might get one later (e.g. a rookie group's MV releasing after the choreography already
started trending as a leak or practice-room video), so it's retried next time instead of being
permanently blocked.

### Quota resets on Google's clock, not your calendar day — and a bug that fix exposed

Worth knowing for planning: YouTube's daily search quota resets at midnight **Pacific time**, not
midnight in your own timezone. For AEST (UTC+10) that's roughly a 17-hour gap — "it's a new day
here" doesn't mean the quota's actually back yet.

While quota was still down, fixed the noisy failure mode: hitting exhausted quota used to dump a
full raw error blob for every single candidate tried (up to 15 times, identical failure each
time). `searchCandidatesContaining` in `scrapers/youtube.js` now flags a `quotaExceeded` error
specifically, and `resolveOfficial.js` stops attempting new lookups after the first one — one clean
message instead of fifteen.

Building that exposed a real regression, caught by testing against the actual exhausted quota
rather than trusting the fix on read: the first version used `break` to stop the whole loop
immediately, which also skipped every remaining **cached** (free, zero-cost) dance that happened
to sort after whichever uncached candidate hit the wall first — silently dropping KISS OF LIFE
from a real run despite it costing nothing to include. Fixed with a `quotaExhausted` flag instead
of `break`: stop trying new API calls, but keep scanning the rest of the list for cache hits.
Re-verified against live exhausted quota afterward — one clean warning, all 6 cached dances
present, in the right order.

### Manual refresh button

`output/dashboard.html` has a "↻ Refresh trends" button. It needs `src/server.js` running behind
it — a static file opened via `file://` can't execute the scraper (browsers don't allow that), so:

```bash
npm run serve   # -> http://localhost:4173
```

Open that URL (not the raw `output/dashboard.html` file) and the button re-scrapes, re-ranks, and
reloads the page in place, usually 15–30s. If you open the file directly instead, the button
disables itself with a note telling you to use `npm run serve`, rather than failing silently.

**No terminal needed:** double-click `Open Dashboard.command` in the project folder. It starts
the server and opens your browser to it automatically — same as `npm run serve` above, just
without typing anything. Closing that Terminal window (or Ctrl+C in it) stops the server.

If you just want to look at last week's results without refreshing anything, there's an even
simpler zero-setup option: double-click `output/dashboard.html` directly. No server, no terminal
— just the refresh button won't work from there (it'll tell you why and how to switch over).

### What's next

- Nothing required — the core pipeline (scrape → filter → rank → dashboard → automate → manual
  refresh) is done. Revisit TikTok as a data source later if you land on a third-party provider
  you're comfortable with (see "Why this doesn't scrape TikTok" above).

## Setup

```bash
cd kpop-dance-trends
cp .env.example .env
```

Get a free YouTube Data API v3 key (instructions also in `.env.example`):

1. https://console.cloud.google.com/ → create/select a project
2. APIs & Services → Library → enable "YouTube Data API v3"
3. APIs & Services → Credentials → Create Credentials → API key
4. Paste it into `.env` as `YOUTUBE_API_KEY=...`

No `npm install` needed yet — everything so far uses Node's built-in `fetch` (Node 18+), zero
dependencies.

## Usage

```bash
npm run scrape:youtube   # fetch this week's candidate videos -> data/cache/youtube-<date>.json
npm run process           # filter + rank the latest scrape -> data/cache/ranked-<date>.json
npm run dashboard         # render the latest ranked results -> output/dashboard.html
npm run weekly             # all three of the above in one go, with logging (what cron runs)
```

Open `output/dashboard.html` directly in a browser afterward — no server needed.

`process` reuses whatever the latest cached scrape is — it doesn't call the YouTube API, so you
can re-tune `src/config.js` and re-run ranking freely without burning API quota.

## Project structure

```
kpop-dance-trends/
├── package.json
├── .env.example          # copy to .env, add your YouTube API key
├── .gitignore
├── src/
│   ├── config.js          # search queries, keywords, lookback window, ranking thresholds
│   ├── loadEnv.js          # tiny dependency-free .env loader
│   ├── scrapers/
│   │   └── youtube.js      # YouTube Data API v3 scraper (search + stats)
│   ├── processing/
│   │   ├── filter.js        # real dance-trend content vs. false positives
│   │   ├── rank.js           # virality scoring (views + engagement + recency)
│   │   └── index.js          # pipeline: latest scrape -> filter -> rank -> save
│   ├── dashboard/
│   │   └── generate.js       # renders output/dashboard.html from ranked data
│   └── server.js              # local server for the "Refresh trends" button (npm run serve)
├── scripts/
│   └── weekly-run.sh          # scrape -> process -> dashboard, cron-safe, logs to logs/
├── data/
│   └── cache/              # raw + ranked JSON, gitignored
├── logs/                    # weekly-run.sh output, gitignored
└── output/
    └── dashboard.html       # generated weekly dashboard, gitignored
```

## Tuning what counts as a "dance trend"

Edit `src/config.js`:

- `YOUTUBE_SEARCH_QUERIES` — the search terms sent to YouTube
- `DANCE_SIGNAL_KEYWORDS` / `NON_DANCE_EXCLUDE_KEYWORDS` — keyword heuristics `filter.js` uses to
  separate real dance-challenge content from plain song uploads (matching ignores spaces/case, so
  `"dance cover"` also matches hashtags like `#dancecover`)
- `MIN_VIEW_COUNT_FOR_RANKING` — videos below this are excluded from ranking (avoids tiny-sample
  engagement-rate noise dominating the top 10)
- `LOOKBACK_DAYS` — the "this week" window (default 7)
- `RESULTS_PER_QUERY` — how many results to pull per search term before filtering
- `TOP_N` — how many ranked results the pipeline (and later the dashboard) shows
