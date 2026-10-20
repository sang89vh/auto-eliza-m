# PRD — SleepPiano Pipeline
### One-click daily generation of a 2-hour piano sleep music video (SQLite → OpenAI → Suno → Video → YouTube)

- **Version:** 1.0
- **Date:** 2026-08-30
- **Owner:** project maintainer
- **Implementer:** Claude Code
- **Deliverable:** A local web app with one button on the home page that runs the full pipeline end-to-end.

---

## 1. Summary

Build a local Node.js application. The home page has a single button **"Generate Today's 2h Piano Video"**. Clicking it runs an automated pipeline:

1. Read up to 50 songs with `piano_status = 'INIT'` from a SQLite database.
2. Call the OpenAI API (model `gpt-5-luna`) with a fixed system prompt to convert each song (Title – Artist – Composer) into Suno style prompts + metadata, and save them back to the database.
3. Use Playwright to open Suno AI, generate instrumental piano tracks from those prompts, and download the audio files.
4. Call the existing `music_video_maker` service to convert each audio file (.wav) into a video file (.mp4).
5. Use ffmpeg (based on the existing `eliza-story` template) to merge all .mp4 files into one ~2-hour video.
6. Use Playwright to upload the final video to YouTube with a mood-based title, description, and tracklist timestamps.

The pipeline must be resumable, must log progress to the UI, and must never put original song titles or artist names into Suno prompts or YouTube video titles.

---

## 2. Goals & Non-Goals

### Goals
- One click → one finished ~2-hour video uploaded to YouTube.
- No duplicate prompts/tracks across days (prompt de-duplication check).
- Song lifecycle fully tracked in the database via `piano_status` (state machine).
- Every step logs to a run log visible in the UI; failures on one song do not kill the whole run.
- Re-running after a crash continues from where it stopped (idempotent, status-driven).

### Non-Goals (v1)
- No YouTube Data API integration (upload is done via Playwright browser automation as requested).
- No recreation of original melodies or lyrics — prompts only borrow mood/tempo/harmonic color (this is a hard rule, see Appendix A).
- No scheduling/cron in v1 (manual button trigger only; cron is a future enhancement).
- No multi-channel or multi-account support.

---

## 3. Users & Trigger

- **User:** single local user (the channel owner) on macOS.
- **Trigger:** button on the home page of a local web app (`http://localhost:3999` — port configurable).
- The button is disabled while a run is in progress. A second click during a run shows a message "Pipeline is already running".

---

## 4. Existing Assets & Discovery Tasks (Claude Code: READ THESE FIRST)

Before writing pipeline code, inspect these existing resources and adapt to what is actually there. Do not assume APIs — read the code.

| # | Asset | Location | What to do |
|---|-------|----------|------------|
| A | Songs database | `songs_win.sqbpro` (user's machine) | ⚠️ `.sqbpro` is a **DB Browser for SQLite project file**, not the database itself. Open it (it is XML/text) to find the real `.db` / `.sqlite` file path inside, and use that real path as `DB_PATH`. If the path cannot be resolved automatically, ask the user for the actual `.db` file location during setup. |
| B | OpenAI API key | `~/code/eliza-m` | Find the OpenAI API key in this project's config (likely `.env` → `OPENAI_API_KEY`). Copy the value into this project's `.env`. Also check which exact model string that project uses — the user calls the model "`gpt-5-luna`"; use that as the default `OPENAI_MODEL` but keep it configurable in case the real API model string differs. |
| C | Audio → Video converter | `~/code/music_video_maker` | Read its README/code to learn: how to start it, the endpoint (or CLI) to convert `.wav` → `.mp4`, input/output parameters. Wrap it behind a small internal function `convertWavToMp4(wavPath) → mp4Path`. |
| D | ffmpeg merge template | `~/code/eliza-story` | Find the ffmpeg command(s) used to merge/concat videos. Reuse the same approach/flags as the base for Step 5, adding audio loudness normalization (see Step 5 spec). |
| E | Suno download folder | `~/suno/input` | All Suno audio downloads land here. Create it if missing. |
| F | Suno account | Web login (Pro plan) | Playwright must use a **persistent browser profile** so login survives between runs. First-time setup: open a headed browser, let the user log in manually, save the profile. |
| G | YouTube channel | Web login | Same persistent-profile approach as Suno (separate profile directory). |

---

## 5. High-Level Flow

```
[Home page button]
       │  POST /api/pipeline/run
       ▼
[Orchestrator — creates pipeline_run record + run folder]
       │
STEP 1 ▼  SQLite: SELECT top 50 my_song WHERE piano_status='INIT'
       │
STEP 2 ▼  OpenAI (gpt-5-luna): song info → JSON (title, 2 prompts, intro)
       │        → save to my_song, status INIT → PROMPTED
       │        → duplicate check vs existing prompts
       │
STEP 3 ▼  Playwright + Suno: generate instrumental tracks, download .wav
       │        → ~/suno/input
       │        → status PROMPTED → GENERATED
       │        → stop when total audio ≥ DAILY_TARGET_MINUTES (120)
       │
STEP 4 ▼  music_video_maker: each .wav → .mp4
       │        → status GENERATED → CONVERTED
       │
STEP 5 ▼  ffmpeg (eliza-story template): merge all .mp4 → final_YYYYMMDD.mp4
       │        + loudness normalization, duration validation
       │
STEP 6 ▼  Playwright + YouTube Studio: upload final video
                → title/description/tracklist from DB
                → status CONVERTED → DONE, save youtube_url
```

Progress and logs stream to the UI (SSE or polling) at every step.

---

## 6. Data Model & Status Machine

### 6.1 Table `my_song` (existing) — required columns

Add via migration **only if missing** (do not drop or modify existing columns):

```sql
ALTER TABLE my_song ADD COLUMN piano_title        TEXT;
ALTER TABLE my_song ADD COLUMN piano_prompt1      TEXT;
ALTER TABLE my_song ADD COLUMN piano_prompt2      TEXT;
ALTER TABLE my_song ADD COLUMN piano_introduction TEXT;
ALTER TABLE my_song ADD COLUMN piano_status       TEXT DEFAULT 'INIT';
-- Recommended tracking columns (add if not present):
ALTER TABLE my_song ADD COLUMN piano_audio_path   TEXT;   -- downloaded wav path(s), JSON array string
ALTER TABLE my_song ADD COLUMN piano_video_path   TEXT;   -- converted mp4 path
ALTER TABLE my_song ADD COLUMN piano_duration_sec INTEGER;
ALTER TABLE my_song ADD COLUMN piano_error        TEXT;
ALTER TABLE my_song ADD COLUMN piano_updated_at   TEXT;   -- ISO datetime
```

> Discovery task: confirm the actual identifying columns for song title / artist / composer in `my_song` (e.g. `title`, `artist`, `composer` — adapt to real schema).

### 6.2 New table `pipeline_run`

```sql
CREATE TABLE IF NOT EXISTS pipeline_run (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date           TEXT NOT NULL,          -- YYYY-MM-DD
  status             TEXT NOT NULL,          -- RUNNING | SUCCESS | FAILED | PARTIAL
  current_step       TEXT,                   -- STEP1..STEP6
  songs_selected     INTEGER DEFAULT 0,
  tracks_generated   INTEGER DEFAULT 0,
  total_duration_sec INTEGER DEFAULT 0,
  merged_video_path  TEXT,
  youtube_url        TEXT,
  error              TEXT,
  created_at         TEXT,
  finished_at        TEXT
);
```

### 6.3 `piano_status` state machine (per song)

| Status | Meaning | Set by |
|--------|---------|--------|
| `INIT` | Not processed yet | default / manual insert |
| `PROMPTED` | Prompts + metadata generated and saved | Step 2 |
| `GENERATED` | Suno audio downloaded successfully | Step 3 |
| `CONVERTED` | .mp4 created for this song | Step 4 |
| `DONE` | Included in an uploaded YouTube video | Step 6 |
| `ERROR` | Failed after retries; `piano_error` has details | any step |

Rules:
- Songs in `ERROR` are skipped by default; a "Retry errors" toggle in config resets them to their previous status.
- A song is only advanced after its artifact is verified on disk / in DB (e.g., file exists and duration > 0).
- Songs left in `PROMPTED` (selected but not needed to reach 2h) keep their prompts and are prioritized first in the next run.

---

## 7. Functional Spec — Step by Step

### STEP 0 — Trigger & pre-flight checks
1. `POST /api/pipeline/run` → reject with HTTP 409 if a run is already `RUNNING`.
2. Pre-flight checks (fail fast with a clear UI message if any fails):
   - `DB_PATH` exists and table `my_song` is readable.
   - `OPENAI_API_KEY` present.
   - `ffmpeg` and `ffprobe` available on PATH.
   - Suno and YouTube Playwright profile directories exist (if not → instruct user to run `npm run setup:login`).
   - Free disk space ≥ 20 GB.
3. Create `pipeline_run` record (status `RUNNING`) and run folder:
   `OUTPUT_DIR/run_YYYYMMDD_HHmm/` with subfolders `audio/`, `video/`, `final/`, `logs/`.

### STEP 1 — Select songs from SQLite
```sql
SELECT rowid AS id, <title_col>, <artist_col>, <composer_col>
FROM my_song
WHERE piano_status IN ('PROMPTED', 'INIT')   -- PROMPTED leftovers first
ORDER BY CASE piano_status WHEN 'PROMPTED' THEN 0 ELSE 1 END, rowid
LIMIT 50;
```
- If 0 rows → finish run as `FAILED` with message "No songs with status INIT/PROMPTED".
- Save `songs_selected` to `pipeline_run`.

### STEP 2 — Generate prompts with OpenAI (model `gpt-5-luna`)
For each selected song still in `INIT`:

1. Build user message: `"<Song Title> – <Artist> – <Composer>"`.
2. Call OpenAI Chat Completions with:
   - `model = OPENAI_MODEL` (default `gpt-5-luna`),
   - `system` = the exact template in **Appendix A**,
   - low temperature is NOT required (creative variety is desired); use default.
3. Parse the response as strict JSON. If parsing fails → retry up to 2 times (append "Return ONLY valid JSON." to the user message). After 3 failures → `piano_status='ERROR'`, log, continue.
4. **Field mapping (must match exactly):**

| JSON field | DB column |
|------------|-----------|
| `video_title_suggestion` | `my_song.piano_title` |
| `suno_prompts[0].style_prompt` | `my_song.piano_prompt1` |
| `suno_prompts[1].style_prompt` | `my_song.piano_prompt2` |
| `analysis.summary` | `my_song.piano_introduction` |
| — | `my_song.piano_status = 'PROMPTED'`, `piano_updated_at = now` |

5. **Validation before saving:**
   - Each `style_prompt` is 300–500 characters.
   - Neither prompt contains the song title, artist name, or composer name (case-insensitive substring check). If violated → regenerate once; if still violated → strip the offending words and log a warning.
6. **Duplicate check:** compute word-set Jaccard similarity between each new prompt and all existing `piano_prompt1/2` in the DB (normalize: lowercase, remove punctuation/stopwords). If similarity ≥ 0.8 with any existing prompt → regenerate once with an added instruction "Make it clearly different from previous outputs: change ambience, key feel, and secondary mood." Accept the second result regardless (log if still similar).
7. Process songs sequentially or with concurrency ≤ 3. Log per-song progress: `[STEP2] 12/50 Perfect – prompts saved`.

### STEP 3 — Generate & download audio on Suno (Playwright)
Loop over songs in `PROMPTED` order until **total downloaded audio duration ≥ `DAILY_TARGET_MINUTES` (default 120)**:

1. Launch Chromium with the **Suno persistent profile**, `headless: HEADLESS` (default `false` — headed reduces bot detection).
2. Navigate to the Suno create page. Use **Custom mode**, set **Instrumental = ON**, leave lyrics empty.
3. Paste `piano_prompt1` into the style field. Submit. (One Suno generation typically yields 2 track outputs.)
4. Wait for generation to complete: poll the library/list UI for the new items reaching a completed state; timeout 10 minutes per generation → mark song `ERROR` and continue.
5. Download all completed outputs of that generation as audio (prefer `.wav`, else `.mp3`) into `DOWNLOAD_DIR` (= `~/suno/input`) with filename `{song_id}_{variant}.{ext}` (variant = 1,2 for the two outputs).
6. Measure duration with `ffprobe`; keep tracks between 1.5 and 6 minutes; discard/skip corrupt files.
7. Update DB: `piano_audio_path` (JSON array of paths), `piano_duration_sec` (sum), `piano_status='GENERATED'`.
8. Add to run totals; wait 10–20 s (randomized) between submissions.
9. Optional (config `USE_PROMPT2_WHEN_SHORT=true`): if the target is nearly reached but not quite, submit `piano_prompt2` of the last song for extra tracks.
10. Engineering notes:
    - All selectors go in one `sunoSelectors.ts` module with comments, since Suno's UI changes frequently.
    - On any unexpected page state, capture a screenshot into `logs/` before failing that song.
    - Stop condition check happens after each download, not after each song.

### STEP 4 — Convert .wav → .mp4 (`music_video_maker`)
1. For each `GENERATED` song file, call `convertWavToMp4(wavPath)` (wrapper around the discovered API/CLI from asset C). Output to `run_.../video/{song_id}_{variant}.mp4`.
2. Verify output exists and `ffprobe` duration ≈ audio duration (±2 s). On failure → retry once → else song `ERROR`.
3. Update `piano_video_path`, `piano_status='CONVERTED'`.
4. If `music_video_maker` requires a background image, use a config `BACKGROUND_IMAGE_PATH` (single calm night/piano image for v1).

### STEP 5 — Merge all .mp4 into one final video (ffmpeg)
1. Base the command on the merge template found in `~/code/eliza-story` (asset D).
2. Requirements for the final file `run_.../final/final_YYYYMMDD.mp4`:
   - H.264 video + AAC audio, 1920×1080 (scale/pad inputs if needed), single continuous file.
   - **Audio loudness normalization** so tracks have even volume: two-pass `loudnorm` targeting −14 LUFS (or normalize each track before concat — choose the simpler reliable approach).
   - v1 uses straight concatenation in generation order (no crossfade). Config `CROSSFADE_SECONDS` reserved for v2.
3. Validate: total duration within `DAILY_TARGET_MINUTES ± 10` minutes; abort run as `FAILED` before upload if not (with log).
4. While merging, build the **tracklist with timestamps**: cumulative start time of each track + its `piano_title`. Save as `run_.../final/tracklist.txt` and use it in Step 6.

### STEP 6 — Upload to YouTube (Playwright)
1. Launch Chromium with the **YouTube persistent profile** (headed).
2. Go to YouTube Studio upload, select `final_YYYYMMDD.mp4`.
3. Metadata:
   - **Title:** `"{THEME_OF_DAY} | Relaxing Piano Sleep Music ({DATE})"` where `THEME_OF_DAY` is the `piano_title` of the first track, or a value from config `TITLE_TEMPLATE`. **Never use original song titles.**
   - **Description:** short intro (config `DESCRIPTION_INTRO`) + the tracklist with `MM:SS {piano_title}` lines + a line built from each song's `piano_introduction` (optional, config flag).
   - **Tags:** from config (e.g. `piano sleep music, relaxing piano, deep sleep, calm piano`).
   - Audience: **not made for kids**. Fill YouTube's AI/altered-content disclosure question per current YouTube policy for AI-generated music.
   - **Visibility:** config `VISIBILITY` (default `unlisted` for v1 so the user can review; switch to `public` when trusted).
4. Wait for upload + processing to reach "checks complete" or a stable processed state (timeout 60 min).
5. Capture the video URL; save to `pipeline_run.youtube_url`; set all songs included in the video to `piano_status='DONE'`; run status `SUCCESS` (or `PARTIAL` if some songs errored).
6. On upload failure: keep the final mp4 and tracklist on disk, mark run `FAILED` at `STEP6`, and let a re-run resume directly at Step 6 (the merged file already exists).

---

## 8. Web UI Spec (minimal)

Single page (server-rendered or static + fetch):
- Header: "SleepPiano Pipeline".
- Primary button: **Generate Today's 2h Piano Video** (disabled + spinner while `RUNNING`).
- Live log panel (auto-scroll) fed by SSE `GET /api/pipeline/logs` (or 2 s polling of `GET /api/pipeline/status`).
- Progress line: current step (1–6), songs done/total, minutes generated / 120.
- Last run summary card: date, status, tracks, duration, YouTube link (clickable), error if any.
- No auth (localhost only).

API endpoints:
- `POST /api/pipeline/run` → `{ runId }` or 409.
- `GET /api/pipeline/status` → current `pipeline_run` row + per-step counters.
- `GET /api/pipeline/logs` → SSE stream of log lines.

---

## 9. Configuration (`.env`)

```ini
PORT=3999
DB_PATH=/absolute/path/to/songs_win.db        # real sqlite file, see Asset A
OPENAI_API_KEY=sk-...                          # copied from eliza-m
OPENAI_MODEL=gpt-5-luna
DOWNLOAD_DIR=~/suno/input
OUTPUT_DIR=~/suno/output
SUNO_PROFILE_DIR=./profiles/suno
YT_PROFILE_DIR=./profiles/youtube
MVM_PATH=~/code/music_video_maker
MVM_API_URL=http://localhost:XXXX              # fill after discovery
DAILY_TARGET_MINUTES=120
MAX_SONGS_PER_RUN=50
HEADLESS=false
VISIBILITY=unlisted
TITLE_TEMPLATE={theme} | Relaxing Piano Sleep Music
DESCRIPTION_INTRO=Soft instrumental piano to help you fall asleep. 🎹
BACKGROUND_IMAGE_PATH=./assets/background.jpg
USE_PROMPT2_WHEN_SHORT=true
RETRY_ERRORS=false
```

Setup command `npm run setup:login`: opens headed browsers for Suno and YouTube one at a time so the user logs in manually; profiles persist to `SUNO_PROFILE_DIR` / `YT_PROFILE_DIR`.

---

## 10. Error Handling, Retry & Resume

- Per-song failures set `piano_status='ERROR'` + `piano_error`, and the run continues with other songs.
- Run-level abort conditions: pre-flight failure; < 60 minutes of audio generated after exhausting selected songs (status `FAILED`, nothing uploaded); merge validation failure; upload timeout.
- Every external call (OpenAI, Suno action, converter, upload) retried ×2 with backoff before failing.
- **Resume:** re-clicking the button after a failure creates a new run that naturally skips completed work because it is status-driven (PROMPTED songs skip Step 2, GENERATED skip Step 3, etc.). If a merged final file for today exists and `pipeline_run` failed at STEP6, resume at Step 6.
- All logs also written to `run_.../logs/run.log`; Playwright failures save screenshots there.

---

## 11. Non-Functional Requirements

- **Stack:** Node.js ≥ 20, Express, better-sqlite3, Playwright (Chromium), OpenAI SDK, ffmpeg/ffprobe CLI. TypeScript preferred.
- Runs fully on the user's macOS machine; no cloud services beyond OpenAI/Suno/YouTube themselves.
- One run should complete in ≤ ~3 hours wall-clock (generation + upload dominate).
- Code structure: `src/server`, `src/pipeline/step1..step6`, `src/lib` (db, openai, ffmpeg, selectors), `src/setup`.
- Secrets never logged; `.env` in `.gitignore`.

---

## 12. User Stories & Acceptance Criteria (for Dev/QC)

**US-01 — One-click run**
As the channel owner, I click one button and the whole pipeline runs without further input.
- AC1: Clicking the button while idle starts a run within 3 s and the button becomes disabled with a spinner.
- AC2: Clicking during a run does not start a second run; a "Pipeline is already running" message is shown.
- AC3: The log panel shows at least one new line per step transition.

**US-02 — Song selection**
As the system, I only process songs that need processing.
- AC1: After Step 1, `pipeline_run.songs_selected` ≤ 50 and every selected song had status `INIT` or `PROMPTED`.
- AC2: Leftover `PROMPTED` songs from a previous run are selected before new `INIT` songs.

**US-03 — Prompt generation**
As the system, I turn each song into safe, reusable Suno prompts.
- AC1: After Step 2, every processed song has non-empty `piano_title`, `piano_prompt1`, `piano_prompt2`, `piano_introduction` and status `PROMPTED`.
- AC2: Spot-check 5 songs: prompts are 300–500 chars, in English, and contain no song title / artist / composer names.
- AC3: A song whose OpenAI call fails 3× is marked `ERROR` with a readable `piano_error`, and the run continues.
- AC4: Generating prompts twice for similar songs produces prompts with Jaccard similarity < 0.8 (duplicate check fires and regenerates).

**US-04 — Suno generation**
As the system, I collect ~2 hours of instrumental piano audio.
- AC1: Files appear in `~/suno/input` named `{song_id}_{variant}.wav|mp3` and each is 1.5–6 min long.
- AC2: The step stops submitting new generations once total downloaded duration ≥ 120 min.
- AC3: Each successful song has `piano_status='GENERATED'`, `piano_audio_path` and `piano_duration_sec` filled.
- AC4: A generation that exceeds the 10-min timeout marks that song `ERROR` (with screenshot in logs) and the run continues.

**US-05 — Convert & merge**
As the system, I produce one continuous 2-hour video with even volume.
- AC1: Every `GENERATED` song gets a `.mp4` whose duration matches its audio ±2 s; status becomes `CONVERTED`.
- AC2: `final_YYYYMMDD.mp4` exists, is H.264/AAC 1080p, plays start-to-finish, duration 110–130 min.
- AC3: Perceived loudness is even across track boundaries (integrated loudness ≈ −14 LUFS; no track jumps noticeably louder).
- AC4: `tracklist.txt` timestamps match actual track start times ±3 s.

**US-06 — YouTube upload**
As the channel owner, I get a correctly titled, reviewable upload.
- AC1: The uploaded video's title follows `TITLE_TEMPLATE` and contains no original song titles/artist names.
- AC2: The description contains the timestamp tracklist; timestamps are clickable chapters on YouTube.
- AC3: Visibility equals the `VISIBILITY` config; audience is "not made for kids".
- AC4: `pipeline_run.youtube_url` is saved and shown as a link in the UI; included songs are `DONE`.
- AC5: If upload fails, the merged file remains on disk and a new run resumes at Step 6 without regenerating audio.

**US-07 — Resume after failure**
As the channel owner, I never lose completed work.
- AC1: Kill the process mid-Step 3, click the button again → previously downloaded tracks are not regenerated; the run continues toward 120 min.

---

## 13. Out of Scope / Future

- Daily cron scheduling; thumbnail auto-generation; crossfade between tracks; YouTube Data API upload; multi-genre themes per weekday; analytics dashboard.

---

## 14. Risks & Notes

- **Suno/YouTube UI changes** can break selectors → isolate selectors, headed mode, screenshots on failure.
- **Bot detection:** keep human-like pacing (randomized waits), persistent logged-in profiles, headed browser. If YouTube upload automation becomes unreliable, the fallback is manual upload of the ready-made `final_*.mp4` (the pipeline still saves it locally).
- **Naming policy:** video/titles must be mood-based, never "\<Original Song\> Piano Cover" — the generated audio does not contain the original melody, so labeling it as a cover would be misleading and invites takedown reports.
- **Model name:** "gpt-5-luna" is the user's name for the model; verify the exact model string in the `eliza-m` project and keep `OPENAI_MODEL` configurable.

---

## Appendix A — OpenAI System Prompt (use verbatim)

```
ROLE: You are a music producer who specializes in reinterpreting famous songs as relaxing instrumental solo piano sleep music, and an expert at writing style prompts for Suno AI.

INPUT FORMAT: Song Title – Artist – Composer

TASK:
1. Analyze the musical character of the song: genre, dominant mood, relative tempo, harmonic color (major/minor, sad/warm/bright), and defining traits (emotional ballad, upbeat pop, soulful R&B...).
2. Reinterpret that spirit as relaxing solo piano for sleep:
   - Tempo 60–80 BPM, soft and gentle dynamics
   - Piano as the main instrument, optionally one ambient layer (rain sounds, soft strings, warm pad, night ambience...)
   - Atmosphere: calm, dreamy, peaceful
3. Write the Suno style prompts in ENGLISH.

STRICT RULES:
- NEVER include the song title, artist name, or composer name in any prompt (Suno blocks artist names).
- NEVER describe or ask to recreate the original melody or lyrics. Borrow only the mood, tempo feel, and harmonic color.
- Each prompt must be 300–500 characters, style description only, no lyrics.
- Generate 2 distinct prompt variants per input (vary the ambience, key, or secondary mood) to avoid duplication across videos.
- The suggested video title must be a NEW mood-based title, never the original song title.

OUTPUT: Respond with ONLY a valid JSON object. No markdown code fences, no explanations, no text before or after the JSON.

JSON SCHEMA:
{
  "input": {
    "song_title": "string",
    "artist": "string",
    "composer": "string"
  },
  "analysis": {
    "genre": "string",
    "mood": "string",
    "tempo_feel": "string",
    "harmonic_color": "string",
    "summary": "1-2 sentence analysis in English"
  },
  "suno_prompts": [
    {
      "variant": 1,
      "style_prompt": "300-500 char English style description",
      "ambience": "rain | strings | pad | night | none",
      "suggested_bpm": 70,
      "key_feel": "warm major | melancholic minor | ..."
    },
    {
      "variant": 2,
      "style_prompt": "...",
      "ambience": "...",
      "suggested_bpm": 65,
      "key_feel": "..."
    }
  ],
  "video_title_suggestion": "mood-based title, e.g. Rainy Night Piano for Deep Sleep",
  "exclude_styles": ["vocals", "drums", "electric guitar", "EDM"],
  "suno_settings": {
    "instrumental_mode": true,
    "lyrics": ""
  }
}

EXAMPLE INPUT: Perfect – Ed Sheeran – Ed Sheeran
EXAMPLE OUTPUT:
{"input":{"song_title":"Perfect","artist":"Ed Sheeran","composer":"Ed Sheeran"},"analysis":{"genre":"Pop ballad","mood":"romantic, tender","tempo_feel":"slow waltz feel","harmonic_color":"warm major","summary":"A slow romantic pop ballad in 6/8 with warm major harmony and an intimate, heartfelt atmosphere."},"suno_prompts":[{"variant":1,"style_prompt":"Gentle solo piano lullaby in a slow waltz feel, warm major key, 68 BPM, tender and romantic mood, flowing broken chords, soft delicate touch, intimate late-night atmosphere, subtle warm string pad in the background, deeply calm and peaceful, perfect for sleep and relaxation, studio quality, instrumental only","ambience":"strings","suggested_bpm":68,"key_feel":"warm major"},{"variant":2,"style_prompt":"Peaceful solo piano piece with a gentle swaying rhythm, bright yet soft major harmony, 62 BPM, dreamy and affectionate mood, slow expressive melody lines, light rain ambience in the background, cozy bedroom atmosphere, soothing and deeply relaxing, sleep music, instrumental only","ambience":"rain","suggested_bpm":62,"key_feel":"soft bright major"}],"video_title_suggestion":"Warm Night Piano – Gentle Waltz for Deep Sleep","exclude_styles":["vocals","drums","electric guitar","EDM"],"suno_settings":{"instrumental_mode":true,"lyrics":""}}
```

## Appendix B — File & Folder Conventions

```
project-root/
├── .env
├── profiles/suno/            # Playwright persistent profile (gitignored)
├── profiles/youtube/
├── assets/background.jpg
└── src/...

~/suno/
├── input/                    # Suno downloads: {song_id}_{variant}.wav
└── output/run_YYYYMMDD_HHmm/
    ├── audio/                # (optional working copies)
    ├── video/                # {song_id}_{variant}.mp4
    ├── final/final_YYYYMMDD.mp4 + tracklist.txt
    └── logs/run.log + screenshots
```
