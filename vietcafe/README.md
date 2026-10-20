# VietCafe Pipeline

One click on the home page turns 50 rows of the songs database into one ~2-hour
**chill Vietnamese café music video with vocals** ("nhạc chill quán cà phê có lời")
on YouTube.

```
SQLite (my_song)  →  OpenAI  →  Suno  →  music_video_maker  →  ffmpeg  →  YouTube
   STEP 1            STEP 2     STEP 3        STEP 4            STEP 5     STEP 6
```

This is the café-with-vocals sibling of `../sleeppiano` (instrumental piano sleep
music). Same architecture, same resumable status machine driven by
`my_song.cafe_status`, same one-button server. The differences are listed below;
everything not mentioned here works exactly as described in
[`../sleeppiano/README.md`](../sleeppiano/README.md).

---

## Quick start

```bash
cd vietcafe
cp .env.example .env        # then set OPENAI_API_KEY, DB_PATH and your folders
npm install
npx playwright install chromium
npm run setup:login         # sign in to Suno, then YouTube — once, per THIS project's profiles
npm start                   # http://localhost:4999
```

Open <http://localhost:4999> and press **Generate Today's 2h Vietnamese Cafe Video**. After a
failed run, the **Resume** button next to it continues from where the work stopped — see
[Resume button](#resume-button).

On Windows, `start-vietcafe.bat` in the repo root does the install-and-start step in one go,
and `scripts/run_daily.ps1` is the Task Scheduler entry point. Everything else about running
on Windows — Mjudio's `%APPDATA%\Mjudio\Automation\endpoint.json`, the download
tree, the encoder choice — is described in
[`../sleeppiano/README.md`](../sleeppiano/README.md#on-windows); this pipeline's own copies
live under `~/suno/vietcafe` by default.

`profiles/` was deliberately NOT copied from sleeppiano: the café channel is normally
a different YouTube channel, and the Chrome profiles weigh 1.2 GB. Until
`npm run setup:login` has been run once, Steps 3 and 6 refuse to start.

---

## How this differs from sleeppiano

| Aspect | sleeppiano | vietcafe |
|---|---|---|
| Genre | Instrumental solo piano sleep music | Chill Vietnamese café music **with Vietnamese vocals** |
| Database | `data/songs_win.db`, `piano_*` columns | `data/songs_vietcafe.db` (full clone, all rows reset), `cafe_*` columns |
| Step 2 output | 2 style prompts | 2 style prompts **+ one original Vietnamese lyric** (`cafe_lyrics`) |
| Suno mode | Advanced ▸ Instrumental | Advanced ▸ **Write** (custom lyrics pasted per song) |
| Song selection | PROMPTED first, then id | PROMPTED first, then **Vietnamese-titled seeds first** (~600 rows), then id |
| Port | 3999 | 4999 |
| Downloads | `~/suno/input` | `~/suno/vietcafe/input` (ids overlap between the cloned DBs — sharing would overwrite files) |
| Titles/tags | English sleep-music metadata | Vietnamese café metadata (`{theme} \| Nhạc Chill Quán Cà Phê`) |

### Lyrics contract (Step 2)

The OpenAI system prompt asks for a brand-new, 100% Vietnamese lyric (600–1400
chars, `[Verse]`/`[Chorus]` tags) that borrows only the seed song's *mood* — never
its melody or words. Step 2 validates: presence, 400–2500 char window, Vietnamese
diacritics present, section tags present. A structural failure after one
regeneration marks the song `ERROR`.

### The naming policy, adapted

Style prompts (English) keep sleeppiano's strict substring ban on the seed song's
title/artist. Lyrics and the Vietnamese video title use **whole-word** matching
instead: banned mononyms like "Đen" are ordinary Vietnamese words ("cà phê đen"),
and substring matching would reject nearly every café lyric. Lyrics are never
word-stripped — a residual whole-word hit after one regeneration is accepted and
logged, because deleting words mid-verse leaves an unsingable text.

### Suno Write mode (Step 3)

Step 3 selects the Advanced tab, then the `Write` option of the
`Write | Prompt | Instrumental` radio group, pastes `cafe_lyrics` into the lyrics
editor, the style prompt into the Styles box, and submits. The positive proof that
Write mode took is the lyrics editor becoming visible (Instrumental renders none),
plus a read-back check that a `[Verse]` tag survived in the editor. Both generated
variants are sung from the same lyric — two different arrangements of the same song,
which is intentional (matches Suno's two-clips-per-generation economics).

**Steps 3 and 6 are code-complete but unverified against the live sites** — same
caveat as sleeppiano: the Write-mode selectors were written blind and the first
supervised run (after `npm run setup:login`) will show which selector, if any,
needs updating. Screenshots land in `logs/` on any unexpected state.

---

## The database

`data/songs_vietcafe.db` was created with:

```sql
-- from data/: sqlite3 songs_win.db "VACUUM INTO 'songs_vietcafe.db'"
DROP TABLE pipeline_run;            -- piano run history
DROP INDEX idx_my_song_piano_status;
ALTER TABLE my_song DROP COLUMN piano_*;   -- all ten piano columns
```

so all 5,150 rows start at `cafe_status='INIT'` regardless of what the piano
pipeline did with them, and `npm run migrate` (or the first server start) adds the
`cafe_*` columns and a fresh `pipeline_run` table. ~600 rows have Vietnamese
titles; Step 1 hands those out first.

## Suno Studio downloads

Since 2026-09-03 Suno counts library downloads against a monthly cap (Free 7 total, Pro
20, Premier 60), which a 2-hour run would exhaust in a day or two. Suno Studio exports are
exempt, so Step 3 now downloads every finished clip through Studio
(`src/lib/sunoStudio.ts`, selectors in `src/lib/sunoSelectors.ts`):

1. Generation is unchanged: prompts are still submitted on `/create`, and the two clips of
   each generation are still tracked by id from their rows.
2. Each finished clip is opened in a second tab at
   `https://suno.com/studio?for_clip_id=<id>&create_new=1`, which builds a single-track
   Studio project around it (the URL the create page's *Edit ▸ Open in Studio ▸
   Single-track* chooser uses; the *Multi-track* option costs 50 credits and is never
   clicked).
3. The timeline clip is right-clicked and **Download .WAV** is taken. Studio renders the
   WAV server-side first, so a 3–4 minute clip takes 40–65 s to arrive.
4. The file is saved as `${DOWNLOAD_DIR}/<songId>_<n>.wav` exactly as before; Steps 4–6
   do not know the difference.

What that costs and what to expect:

- **Premier plan required.** Studio is a Premier feature. Step 3 opens Studio *before*
  the first prompt is submitted and fails the run if the workstation does not render, so
  a wrong plan never burns two hours of credits. There is deliberately no automatic
  fallback to the library download — that would spend the cap silently. Set
  `SUNO_DOWNLOAD_VIA=library` to choose it explicitly.
- **~45 s more per clip**, roughly 30–40 minutes more per run.
- **One Studio project per clip** accumulates under *Library ▸ Studio Projects*. They are
  harmless, but nothing deletes them yet.
- **One Studio session per account at a time.** Two browsers using Studio on the same
  account left every render pending until the 5-minute timeout (verified 2026-09-09 by
  running the sleeppiano and vietcafe smoke tests together; alone, each passes). The
  two daily jobs are hours apart, but do not start a manual run of one pipeline while
  the other is in Step 3, and do not open Studio by hand during a run. After four
  consecutive failed downloads Step 3 aborts rather than keep spending credits.
- **`Export ▸ Full Song` is not a download.** It renders a copy into the library, which
  would then need a capped library download — do not "fix" the flow to use it.
- The timeline is a WebGL canvas, so the clip is hit by position (fractions of the canvas
  box, tried at a few spots). A Studio redesign shows up as a
  `suno_studio_no_clip_menu_*.png` screenshot in the run's `logs/`.

Dry test against the live site, no credits spent (ids are the `/song/<uuid>` part of any
library link):

```bash
npx tsx tests/smoke_studio_download.ts <clipId> [<clipId> ...]
```

## Status machine

Identical to sleeppiano, on `cafe_status`: `INIT → PROMPTED → GENERATED →
CONVERTED → DONE`, `ERROR` on failure, artifacts verified on disk before a status
advances, carry-over folding for interrupted runs, STEP6 resume from
`final/tracklist.json`.

## Resume button

**Resume N failed songs**, next to the main button, starts a run that first moves every
`ERROR` song back to the furthest step its files **on disk** justify, so whatever survived the
failure is reused rather than paid for again:

| What survived | Back to | What the run redoes |
|---|---|---|
| audio and clips | `CONVERTED` | only the merge and the upload |
| audio | `GENERATED` | Step 4 conversion onward — no Suno credits |
| prompts and lyrics | `PROMPTED` | Suno generation onward — no OpenAI spend |
| nothing | `INIT` | everything |

- **Files, not paths.** The recorded paths are checked against the disk: a song whose audio
  was deleted by hand lands at `PROMPTED`, not as a `GENERATED` ghost that Step 3 would count
  toward the target and Step 4 would fail on again.
- **Only once pre-flight passes.** The re-queue runs after STEP0, so a run that cannot start
  changes nothing.
- **Everything else resumes on its own.** Leftover `GENERATED`/`CONVERTED` songs and a merged
  file that failed to upload are picked up by any run. With no song at `ERROR` but a failed
  last run the button reads **Resume failed run** and does what the main button does; with
  nothing failed it is disabled.
- **`RETRY_ERRORS=true`** is the automatic alternative: it re-queues at the start of every run,
  judged on the recorded paths only. The button does it once, on demand.

**A backlog is worked off one video at a time.** Each run carries over at most one video's
worth of leftover `GENERATED`/`CONVERTED` songs — `CONVERTED` first, then oldest first — until
`DAILY_TARGET_MINUTES` is met, and never past the merge window's upper edge (target + 10 min,
less 2 min of headroom). The rest wait for the next runs. Without the cap, re-queuing several
failed runs at once would merge them into one oversized file that fails Step 5 and wedges
every later run. The 48 songs / 362 min that failed at Step 4 on 2026-09-22/23 (Mjudio
`DXGI_ERROR_DEVICE_REMOVED`, then `insufficient_disk_space`) become three ~120-min videos with
no new Suno generation.

**Fix the cause first**: restart Mjudio after a GPU device-removed error, free disk after
`insufficient_disk_space`. If the cause is still there the songs simply fail again and return
to `ERROR` with their audio kept, ready for the next Resume.

`POST /api/pipeline/resume` → `202 { runId, failedSongs }`, `409 already_running`, or
`409 nothing_to_resume`.

---

## Smoke tests

Run these against a **copy** of the database — `data/songs_vietcafe.db` is live.

```bash
cp ../data/songs_vietcafe.db /tmp/songs_cafe_test.db

npx tsx tests/smoke_model.ts                                     # is OPENAI_MODEL usable
DB_PATH=/tmp/songs_cafe_test.db npx tsx tests/smoke_db.ts        # migration + selection + name parsing
DB_PATH=/tmp/songs_cafe_test.db npx tsx tests/smoke_step2.ts     # real OpenAI call on 2 songs, checks prompts AND lyrics
npx tsx tests/smoke_convert.ts /tmp                              # loudnorm + a real Mjudio render
DB_PATH=/tmp/songs_cafe_test.db npx tsx tests/smoke_step5.ts /tmp/clips
DB_PATH=/tmp/songs_cafe_test.db npx tsx tests/smoke_validation.ts /tmp/clips
DB_PATH=/tmp/songs_cafe_test.db npx tsx tests/smoke_resume.ts    # carry-over + STEP6 resume
DB_PATH=/tmp/songs_cafe_test.db npx tsx tests/smoke_resume_failed.ts   # Resume button: ERROR re-queue + one-video carry-over cap

DB_PATH=/tmp/songs_cafe_test.db OUTPUT_DIR=/tmp/loop/out DOWNLOAD_DIR=/tmp/loop/in \
  npx tsx tests/smoke_daily_loop.ts      # unique run folders, resume lookup, per-run cleanup
```

`smoke_resume.ts` and `smoke_resume_failed.ts` rewrite `cafe_status` across the database they
point at, so they must only ever be given a copy (`smoke_resume_failed.ts` refuses a database
that sits in a `data/` folder). `smoke_daily_loop.ts` does that **and** deletes files under
the `OUTPUT_DIR`/`DOWNLOAD_DIR` it is given — point both at throwaway folders, never at
`E:\suno\vietcafe`.

---

## Known constraints

- **Disk is the binding constraint.** The machine hovers near full; pre-flight
  enforces `MIN_FREE_GB=20` and a run writes per-track wavs, per-track mp4s and a
  2-hour master. Clear space before expecting a full run to survive. At
  `DAILY_VIDEO_TARGET=10` only one session's worth is ever on disk at a time, and only
  because `CLEANUP_AFTER_EACH_RUN` frees each one as it uploads.
- **Mjudio free plan: 3 exports/day.** A full Step 4 needs ~25–35 per-track
  conversions, so a complete daily run requires a paid Mjudio plan (or spreading
  Step 4 across days via resume — the status machine tolerates that). Ten videos a day
  multiply that by ten: ~300 conversions, which no free or entry plan covers.
- **Backgrounds are inherited from sleeppiano** (night/nature stills). They work,
  but café-themed backdrops (rainy window café, phin filter, warm interior) would
  fit the genre better — drop replacements into `assets/backgrounds/`.
- The generated vocals imitate no real singer, and the naming policy keeps original
  titles/artists out of prompts, lyrics, titles and descriptions — the same
  takedown-avoidance posture as sleeppiano, extended to lyrics.

---

## Daily schedule

`~/Library/LaunchAgents/com.example.vietcafe.daily.plist` runs `scripts/run_daily.sh`
every day at **23:00 local time** (sleeppiano's twin fires at 12:00); on Windows the
equivalent is `scripts/run_daily.ps1` under Task Scheduler. The script opens Mjudio in the
background, then `src/setup/run_daily.ts`:

1. marks a crash-stale `RUNNING` row FAILED (a row younger than 10 h is assumed live
   and blocks the new run instead);
2. demotes GENERATED/CONVERTED songs whose recorded files were deleted by hand to
   the furthest status their surviving artifacts justify;
3. deletes the previous session's consumed artifacts — downloaded audio, per-track
   clips, the merged master — **only if that session finished SUCCESS/PARTIAL**
   (an interrupted session keeps everything for resume);
4. produces up to `DAILY_VIDEO_TARGET` videos back to back (see below), each one
   triggered over HTTP on the already-listening server when one is up (a `npm start`
   left running since yesterday is reused, never duplicated), otherwise in-process via
   the same orchestrator — and waited for either way.

`npm run prepare:daily` performs steps 1–3 and stops. It is a preview of what the scheduled
job would start with, not a read-only one: step 3 really does delete files.

### Several videos per firing

One firing produces `DAILY_VIDEO_TARGET` videos (default **10**), one after another. Each
iteration is a complete independent run — its own STEP1–6, its own run folder, its own
YouTube upload — so `DAILY_VIDEO_TARGET=1` is exactly the old single-video behaviour.

```bash
npm run run:daily              # the scheduled job: up to DAILY_VIDEO_TARGET videos
npm run run:one                # one video, for a supervised check after a change
npm run run:daily -- --videos=3
```

The loop stops early on any of three conditions, so a bad day costs one failure instead of
ten:

| Setting | Default | What it stops |
|---|---|---|
| `LOOP_STOP_AFTER_FAILURES` | 2 | consecutive FAILED runs. Songs exhausted, Suno credits gone, Mjudio's export cap, a signed-out profile — every one of them repeats, and each retry spends an hour of browser work to fail identically |
| `LOOP_MAX_HOURS` | 20 | wall clock for one firing. No new video starts once it is spent. **Keep it under 24**: a loop still running at the next scheduled firing makes that day's job find a live run and skip the day |
| `LOOP_COOLDOWN_MINUTES` | 2 | not a stop — the pause between videos, so a loop that is failing fast does not hammer Suno and the finished run's processes are gone before the next starts |

**Ten 2-hour videos do not fit in a day.** One video costs roughly 2.5–3 h (Suno generation,
~45 s of Studio rendering per clip, Mjudio's per-track conversions, the merge, the upload),
so `LOOP_MAX_HOURS` will stop the loop around video 7–8 and the rest carry over to tomorrow
— songs already prompted keep their prompts, so nothing is paid for twice. Halving
`DAILY_TARGET_MINUTES` to 60 roughly doubles how many fit.

Two other limits bite before the clock does: Suno allows **one Studio session per account at
a time**, so a loop this long will overlap sleeppiano's daily run and leave both pipelines'
renders pending until they time out (use separate Suno accounts, or keep the two loops from
overlapping); and the ~600 Vietnamese-titled seed rows last about two days at ten videos a
day, after which Step 1 falls back to non-Vietnamese titles.

### Disk: each session is deleted as soon as it uploads

With `CLEANUP_AFTER_EACH_RUN=true` (the default) the pre-run cleanup of step 3 also runs
straight after **every** video of the loop, against the run that just finished. Ten sessions
of downloads, per-track clips and 2-hour masters cannot sit on this disk at once, so each one
is freed the moment its video is on YouTube:

- files recorded on songs now DONE — the Suno downloads in `DOWNLOAD_DIR` and the per-track
  `.mp4` clips;
- media inside **every** `run_*` folder — normalised wavs, per-track clips, the `_uniform`
  re-encodes, the merged master. `logs/` and `tracklist.json` stay as the paper trail. This
  reaches the folders of runs that failed *before* Step 5 too: those never recorded a merged
  video, so nothing used to delete their leftovers, and every one of those files is
  regenerated from scratch by the next run anyway;
- with `CLEANUP_ORPHAN_DOWNLOADS=true`, files in `DOWNLOAD_DIR` matching Step 3's own
  `<songId>_<n>.<ext>` naming that no song row points at — a download that arrived after its
  generation had already thrown. Nothing else in that folder is ever globbed, because it may
  hold unrelated files.

Never deleted: anything recorded on a GENERATED/CONVERTED/ERROR song — that is the next
video's carry-over material — and anything belonging to a run that did **not** finish
SUCCESS/PARTIAL, whose artifacts are what make its resume cheap.

On Windows a file still open in ffmpeg, Mjudio or Chromium refuses to delete and the cleanup
swallows the error, so a finished run that frees less than 1 GB logs a warning naming that
cause. The next cleanup retries it; if free space keeps falling, pre-flight's `MIN_FREE_GB`
fails the following video rather than letting the disk fill.

`npm run setup:login` is automation-friendly too: a target that is already signed
in is skipped without a keypress, and an unconfirmed target continues after
`LOGIN_WAIT_MINUTES` (default 5) as if confirmed — signed-in detection, Enter, or
the timeout, whichever comes first. A profile "assumed" without a real sign-in
fails later at Step 3, with the Step 2 prompts preserved for the next attempt.

Three logs, and the first is the one to read after a multi-video firing:

- `logs/daily_YYYY-MM-DD.log` — the whole firing: each video's outcome, what each post-run
  cleanup freed, and why the loop stopped. The only place the between-runs lines survive,
  since Task Scheduler keeps no stdout;
- `<run folder>/logs/run.log` — one per video, the per-step detail and any screenshots;
- `logs/launchd_daily.log` — launchd's own capture of stdout on macOS.

Notes:
- launchd fires the job on wake if the Mac was asleep at 23:00; a powered-off Mac
  skips that day. The run itself is wrapped in `caffeinate -i`.
- Runs are owned per process: `pipeline_run.pid` records the owner, and staleness
  is judged by pid liveness with a 10 h age backstop. A server (re)start therefore
  no longer kills a scheduled run that is genuinely in flight, and a wedged row
  never blocks the next day's firing.
- Disable / re-enable:
  `launchctl bootout gui/$(id -u)/com.example.vietcafe.daily`
  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.vietcafe.daily.plist`
