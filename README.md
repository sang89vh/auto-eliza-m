# auto-eliza-m

Automated pipelines that turn a list of seed songs into long-form music videos on
YouTube: write prompts with OpenAI, generate the tracks on Suno, render each track
into a music-visualizer video with **[Mjudio](#mjudio--the-music-visualizer-behind-these-videos)**,
merge everything with ffmpeg, and upload the result.

```
SQLite (my_song)  →  OpenAI  →  Suno  →  Mjudio  →  ffmpeg  →  YouTube
   STEP 1            STEP 2     STEP 3   STEP 4     STEP 5     STEP 6
```

Free and open source under the [MIT License](LICENSE): use it, change it, share it.

> 🎬 **The videos are rendered with Mjudio**, a music visualizer and lyric-video
> maker for Mac and Windows, free to download.
> **[Get it on the Mac App Store](https://apps.apple.com/us/app/mjudio-music-visualizer/id6803313758?mt=12)** ·
> **[Get it from the Microsoft Store](https://aka.ms/AA13geoy)**

---

## Mjudio — the music visualizer behind these videos

Mjudio turns a song into a music video. Drop in an audio file and it drives everything
on the canvas from the track's own analysis: spectrum bars, waveforms, circular and
spherical fields that move with the music, plus text, lyrics, images and effects on
their own layers.

- **Music visualizers and lyric videos**: import `.lrc` / `.srt` lyrics, or time them by hand
- **Any platform's format**: landscape 16:9, portrait 9:16 and square 1:1 canvases
- **A real editor**: layers, scenes, a keyframe timeline, custom fonts, audio-reactive effects
- **Export MP4 up to 4K at 60 fps**, sized for YouTube, TikTok, Instagram Reels and Shorts
- **Private**: everything is analysed and rendered on your own computer; your music is
  never uploaded and there is no account to create
- **Scriptable**: an optional local automation API (off by default) renders videos from
  a script, which is exactly how Step 4 of these pipelines uses it

| Platform | Download | Price | Requirements |
|---|---|---|---|
| macOS | [Mac App Store](https://apps.apple.com/us/app/mjudio-music-visualizer/id6803313758?mt=12) | Free: up to 3 exports a day at 720p with a watermark. **Mjudio Premium** (monthly, yearly with a 3-day free trial, or a one-time lifetime purchase) removes the watermark and unlocks unlimited exports up to 4K 60 fps. | macOS 14 or later |
| Windows | [Microsoft Store](https://aka.ms/AA13geoy) | Completely free: no subscription, no in-app purchase, no watermark. | Windows 10 version 2004 or later, x64 |

Mjudio is a separate app by the same author. It is not part of this repository and
is not covered by this repository's license.

---

## What is in this repository

| Path | What it does |
|---|---|
| [`sleeppiano/`](sleeppiano/README.md) | One click turns 50 seed songs into a ~2-hour **instrumental piano sleep-music** video on YouTube. Resumable at every step. |
| [`vietcafe/`](vietcafe/README.md) | The same pipeline for **chill Vietnamese café music with vocals**: Step 2 also writes an original Vietnamese lyric. |
| `server.js`, `src/`, `public/` | The original React + Express app that shows and manages the songs in the SQLite database. |
| `shscript/` | ffmpeg helpers that merge audio and video (bash for macOS/Linux, batch for Windows). |
| `pyscript/` | Python helpers that build seed-song lists (YouTube Music charts, JSON converters). |
| `autokey/` | An AutoHotkey upload helper for Windows. |
| `PRD.md` | The product requirements the pipelines implement. |

## Requirements

- **Node.js 22.13 or newer** (the pipelines use the built-in `node:sqlite`)
- **ffmpeg** and **ffprobe** on your `PATH`
- **[Mjudio](#mjudio--the-music-visualizer-behind-these-videos)**, running, with
  **Settings ▸ Automation** turned on. A full run renders 25–35 tracks, so on a Mac it
  needs Mjudio Premium (the free plan allows 3 exports a day); the Windows app is free
  with no in-app purchase
- An **OpenAI API key**
- A **Suno** account (Studio downloads need the Premier plan; see
  [`sleeppiano/README.md`](sleeppiano/README.md#suno-studio-downloads)) and a **YouTube** channel

## Quick start

```bash
git clone <this repository>
cd auto-eliza-m

# 1. Create a songs database with the my_song table (5 sample rows)
npm install
node setup-db.js ./data/songs_win.db

# 2. Configure and start the SleepPiano pipeline
cd sleeppiano
cp .env.example .env            # set OPENAI_API_KEY and your folders
npm install
npx playwright install chromium
npm run migrate                 # adds the pipeline's piano_* columns
npm run setup:login             # sign in to Suno, then YouTube, once
npm start                       # open http://localhost:3999
```

For the café pipeline, run `node setup-db.js ./data/songs_vietcafe.db` instead, then
follow the same steps in `vietcafe/` (it serves on port 4999). On Windows,
`start-sleeppiano.bat` and `start-vietcafe.bat` install and start each pipeline in one go.

Each run uses rows of `my_song` as seeds. Add your own rows with `original_title` set
to `"Title - Artist"`; the pipelines only borrow the mood of a seed song, never its
title, artist, lyrics or melody. The per-pipeline READMEs cover configuration, resume,
the daily schedule and the smoke tests.

## Keep your secrets out of git

Everything private stays on your machine and is already listed in `.gitignore`:

- `.env` files: your OpenAI API key and local paths (only the `.env.example` templates are committed)
- `profiles/`: the Playwright browser profiles that hold your signed-in Suno and YouTube sessions
- `data/*.db`: your songs databases and run history
- `logs/`: run logs and screenshots

Generating and uploading content is subject to the terms of Suno, YouTube and OpenAI.
Use the automation responsibly and only with accounts you own.

## Support

Questions, bugs or ideas: open an issue, or contact
**sang89vh@icloud.com** · **+84356054323**.

## License

[MIT](LICENSE) © 2025-2026 Nguyen Van Sang
