# SleepPiano Pipeline

One click on the home page turns 50 rows of the songs database into one ~2-hour piano
sleep-music video on YouTube.

```
SQLite (my_song)  →  OpenAI  →  Suno  →  music_video_maker  →  ffmpeg  →  YouTube
   STEP 1            STEP 2     STEP 3        STEP 4            STEP 5     STEP 6
```

Implements `../PRD.md`. The pipeline is resumable: every step is driven by
`my_song.piano_status`, so a crashed run continues where it stopped rather than paying
for the same prompts, tracks or renders twice.

---

## Quick start

```bash
cd sleeppiano
cp .env.example .env    # then set OPENAI_API_KEY, DB_PATH and your folders
npm install
npx playwright install chromium
npm run setup:login     # sign in to Suno, then YouTube — once
npm start               # http://localhost:3999
```

Open <http://localhost:3999> and press **Generate Today's 2h Piano Video**.

### On Windows

The pipeline runs natively on Windows; once `.env` points at your own paths, the quick
start above works as written. There is also a one-click launcher:

```bat
start-sleeppiano.bat        REM from the repo root: installs deps if needed, then starts on :3999
```

| Piece | macOS | Windows |
|---|---|---|
| Converter | Mjudio.app, sandboxed container | the Mjudio Windows port, installed to `%LOCALAPPDATA%\Programs\Mjudio\Mjudio.UI.exe` |
| `MVM_ENDPOINT_FILE` | `~/Library/Containers/com.mjudio.musicvideomaker/.../endpoint.json` | `%APPDATA%\Mjudio\Automation\endpoint.json` |
| Suno downloads | `~/suno` (VietCafe uses `~/suno/vietcafe`) | same defaults under `%USERPROFILE%`; set `DOWNLOAD_DIR` / `OUTPUT_DIR` to move them |
| Daily run | `scripts/run_daily.sh` via launchd | `scripts/run_daily.ps1` via Task Scheduler |
| Video encoder | `h264_videotoolbox` | `libx264` — picked automatically by `pickVideoEncoder()` |

`config.ts` chooses the right `endpoint.json` default per platform, so `MVM_ENDPOINT_FILE`
only has to be set when Mjudio stores it somewhere non-standard.

Without GNU make on Windows, the `make sleeppiano-*` targets are macOS-only;
use `start-sleeppiano.bat` or the `npm run …` scripts directly.


---

## What the discovery step resolved

The PRD asked for four existing assets to be located before any code was written. What
was actually found, and the decision each fact forced:

| Asset | Resolved to |
|---|---|
| **A** Songs DB | `songs_win.sqbpro` is a DB Browser *project* file; its `<db path="songs_win.db">` points at **`../data/songs_win.db`** — 5150 rows, all `piano_status='INIT'`. |
| **B** OpenAI | `eliza-m` reads `${OPENAI_API_KEY}` from the environment (it is in `~/.zshrc`) and pins `gpt-4.1-2025-04-14`. See **Model** below. |
| **C** Converter | `music_video_maker` is the **Mjudio** macOS app. It exposes a loopback REST automation API, so `convertWavToMp4` talks HTTP to it — see **music_video_maker** below. |
| **D** ffmpeg merge | `eliza-story/video_helper.py::merge_videos_ffmpeg` uses the concat demuxer; this repo's own `shscript/merge_processed_videos.sh` is the macOS sibling with `h264_videotoolbox`. Step 5 uses those flags. |

### Song names

`my_song` has **no artist or composer column**. `original_title` holds `"Title - Artist"`
(e.g. `菊花台 - 周杰伦`), so `parseSongName()` splits on the first separator, splits
multi-artist values on `/`, and sends OpenAI `"<Title> – <Artist> – Unknown"`. The parsed
title and every artist become the banned-substring list that prompts and the video title
are checked against.

### Model

The PRD calls the model `gpt-5-luna`. **That exact string is rejected by the API.** The
model on this key with that name is **`gpt-5.6-luna`**, which is what `.env` now uses and
what pre-flight verified. `eliza-m`'s own `gpt-4.1-2025-04-14` is a valid fallback.

Pre-flight calls `models.retrieve` and fails with a message naming both alternatives
rather than silently substituting a model.

```bash
npx tsx tests/list_openai_models.ts    # what this key can actually use
```

### music_video_maker

Three facts from `music_video_maker/docs/AUTOMATION-API.md` shape `src/lib/mjudio.ts`:

- **The app is sandboxed** — no endpoint accepts a path. Audio goes in as request bytes
  and the finished mp4 comes back over HTTP.
- **Port and token live in `endpoint.json`**, written at start-up and deleted when the app
  stops. That is why there is no `MVM_API_URL` setting: both are read per call.
- **One export runs at a time, app-wide.** Step 4 serialises its conversions to match.

The app must be running with **Settings ▸ Automation** enabled. Pre-flight checks this —
deliberately, because otherwise a run can burn two hours of Suno credits and only then
discover at Step 4 that the converter was never up.

---

## Configuration

Copy `.env.example` to `.env` and edit. Every value is documented there. The ones worth
knowing:

| Key | Why it matters |
|---|---|
| `DB_PATH` | The real `.db`, not the `.sqbpro` project file. |
| `OPENAI_MODEL` | `gpt-5.6-luna`. See **Model** above. |
| `DAILY_TARGET_MINUTES` | 120. Step 3 stops submitting once total downloaded audio reaches it; Step 5 rejects a merge outside ±10 min. |
| `VISIBILITY` | `unlisted` for v1 so uploads can be reviewed before going public. |
| `SUNO_DOWNLOAD_VIA` | `studio`. Step 3 downloads every clip through **Suno Studio**, which Suno exempts from the monthly download cap it introduced on 2026-09-03 (Free 7 total, Pro 20, Premier 60). Needs the Premier plan. `library` restores the old per-row Download menu, which spends that cap. See **Suno Studio downloads**. |
| `HEADLESS` | `false`. Headed browsers are markedly less likely to be flagged as automation. |
| `MIN_FREE_GB` | 20. See **Known constraints**. |
| `ALTERED_CONTENT_DISCLOSURE` | `no`. YouTube requires the disclosure for *realistic* depictions of people, places or events; AI-generated instrumental music over an abstract visualiser is not one. Set to `yes` to answer the other way. |
| `RETRY_ERRORS` | Moves `ERROR` songs back to the furthest status their artifacts justify, then reprocesses them. |

`.env` is gitignored, as are `profiles/`.

---

## The naming policy

The generated audio does not contain the original melody, so labelling a video
"*\<Original Song\>* Piano Cover" would be misleading and invites takedown reports. Three
layers enforce this:

1. The system prompt (PRD Appendix A, used verbatim) forbids the model from using the
   song title, artist or composer.
2. Step 2 checks every prompt **and** the suggested video title against the banned list,
   regenerates once, then strips any term that still survives.
3. Step 6 builds the title from `piano_title` — a mood-based name — never from
   `original_title`.

---

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

| Status | Meaning | Set by |
|---|---|---|
| `INIT` | Not processed | default |
| `PROMPTED` | Prompts + metadata saved | Step 2 |
| `GENERATED` | Suno audio downloaded and probed | Step 3 |
| `CONVERTED` | `.mp4` rendered and duration-checked | Step 4 |
| `DONE` | Included in an uploaded video | Step 6 |
| `ERROR` | Failed after retries; `piano_error` has the detail | any step |

A song advances only after its artifact is verified on disk. Leftover `PROMPTED` songs are
selected before new `INIT` songs, so prompts already paid for are used first.

---

## Resume

- Re-clicking the button starts a new run that skips completed work, because selection and
  every step are status-driven.
- **Carry-over.** Step 1 selects `INIT`/`PROMPTED` only, as the PRD specifies — so songs an
  interrupted run left at `GENERATED` or `CONVERTED` would never come back. The
  orchestrator folds them into the working set for Steps 3–5. Without this, Step 3 starts
  its minute count at zero and generates a *second* two hours on top of the audio already
  on disk, Step 4 never converts the orphans, and a run that failed merge validation once
  merges an ever-growing video every time after.
- Songs already `GENERATED` count toward the 120-minute target, so a run killed mid-Step 3
  continues toward the target instead of regenerating.
- If a run failed at **STEP6** and today's `final_YYYYMMDD.mp4` is still on disk, the next
  run resumes directly at Step 6, rebuilding the tracklist from `final/tracklist.json`.
- A crash leaves a `pipeline_run` row at `RUNNING`, which would 409 every future click.
  The server marks such rows `FAILED` on startup.

---

## Layout

```
src/
  server/index.ts        Express + the three API endpoints + SSE log stream
  server/public/         The one-button UI
  pipeline/step1..step6  One file per PRD step
  pipeline/orchestrator  Run lifecycle, pre-flight, resume, run/song bookkeeping
  lib/db.ts              node:sqlite access, migration, status machine
  lib/openai.ts          Chat Completions + JSON recovery + model verification
  lib/mjudio.ts          convertWavToMp4 — the music_video_maker wrapper
  lib/ffmpeg.ts          probe, two-pass loudnorm, uniformity, concat
  lib/sunoSelectors.ts   Every Suno selector, one file
  lib/youtubeSelectors.ts Every YouTube Studio selector, one file
  setup/login.ts         npm run setup:login
```

`better-sqlite3` does not build on this machine's Node 25 (stale `node-gyp`, and Python
3.12 dropped `distutils`), so the DB layer uses Node's built-in **`node:sqlite`**. Same
synchronous API, no native build.

---

## Loudness

Each downloaded track is normalised to −14 LUFS with a **two-pass** `loudnorm` *before* it
becomes video. The PRD allows either placement; per-track-before-conversion is the simpler
reliable one, because the alternative means re-encoding the audio of a finished two-hour
file, and because it keeps every track independently correct rather than letting one loud
track skew the whole mix. Measured end to end: −22.05 → −14.05 LUFS after Step 4, −14.06
after the Step 5 concat.

---

## Smoke tests

Run these against a **copy** of the database — `data/songs_win.db` is live with 5150 rows.

```bash
cp ../data/songs_win.db /tmp/songs_test.db

npx tsx tests/smoke_model.ts                                   # is OPENAI_MODEL usable
DB_PATH=/tmp/songs_test.db npx tsx tests/smoke_db.ts           # migration + selection + name parsing
DB_PATH=/tmp/songs_test.db npx tsx tests/smoke_step2.ts        # real OpenAI call on 2 songs, checks every US-03 AC
npx tsx tests/smoke_convert.ts /tmp                            # loudnorm + a real Mjudio render
DB_PATH=/tmp/songs_test.db npx tsx tests/smoke_step5.ts /tmp/clips   # merge + tracklist timestamps
DB_PATH=/tmp/songs_test.db npx tsx tests/smoke_validation.ts /tmp/clips  # merge guard + title/description
DB_PATH=/tmp/songs_test.db npx tsx tests/smoke_resume.ts       # carry-over + STEP6 resume (US-07, US-06 AC5)
```

`smoke_resume.ts` rewrites `piano_status` across the database it points at, so it must
only ever be given a copy.

---

## Known constraints

- **Disk.** The machine sits at ~20 GB free against a 20 GB pre-flight floor. Runs will
  fail pre-flight, or die mid-run, until space is cleared. `MIN_FREE_GB` lowers the floor
  but not the underlying need — a run writes per-track wavs, per-track mp4s and a 2-hour
  master.
- **Steps 3 and 6 are code-complete but unverified against the live sites.** They need
  logged-in Suno and YouTube profiles, and a real run spends Suno credits and publishes to
  the channel — only a supervised click should do that. Both drive their sites through
  candidate-selector lists and screenshot into `logs/` on any unexpected state, so the
  first supervised run will show exactly which selector to update.
- **`DOWNLOAD_DIR` may be shared.** It can already hold
  unrelated files, so nothing globs it — downloaded paths are tracked per song in
  `piano_audio_path` and the 120-minute stop condition is computed from
  `piano_duration_sec`.

---

## Daily schedule

`~/Library/LaunchAgents/com.example.sleeppiano.daily.plist` runs `scripts/run_daily.sh`
every day at **12:00 local time** (vietcafe's twin fires at 23:00). The script opens Mjudio in the
background, then `src/setup/run_daily.ts`:

1. marks a crash-stale `RUNNING` row FAILED (a row younger than 10 h is assumed live
   and blocks the new run instead);
2. demotes GENERATED/CONVERTED songs whose recorded files were deleted by hand to
   the furthest status their surviving artifacts justify;
3. deletes the previous session's consumed artifacts — downloaded audio, per-track
   clips, the merged master — **only if that session finished SUCCESS/PARTIAL**
   (an interrupted session keeps everything for resume);
4. starts today's run — triggered over HTTP on the already-listening server when
   one is up (a `npm start` left running since yesterday is reused, never
   duplicated), otherwise in-process via the same orchestrator — and waits for it
   to finish either way.

`npm run prepare:daily` performs steps 1–3 and stops — a safe dry check of what the
scheduled job would do.

`npm run setup:login` is automation-friendly too: a target that is already signed
in is skipped without a keypress, and an unconfirmed target continues after
`LOGIN_WAIT_MINUTES` (default 5) as if confirmed — signed-in detection, Enter, or
the timeout, whichever comes first. A profile "assumed" without a real sign-in
fails later at Step 3, with the Step 2 prompts preserved for the next attempt. Output lands in `logs/launchd_daily.log` plus the usual
per-run `logs/run.log`.

Notes:
- launchd fires the job on wake if the Mac was asleep at 12:00; a powered-off Mac
  skips that day. The run itself is wrapped in `caffeinate -i`.
- Runs are owned per process: `pipeline_run.pid` records the owner, and staleness
  is judged by pid liveness with a 10 h age backstop. A server (re)start therefore
  no longer kills a scheduled run that is genuinely in flight, and a wedged row
  never blocks the next day's firing.
- Disable / re-enable:
  `launchctl bootout gui/$(id -u)/com.example.sleeppiano.daily`
  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.sleeppiano.daily.plist`
