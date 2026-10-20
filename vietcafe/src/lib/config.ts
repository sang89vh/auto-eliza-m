import { config as loadDotenv } from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

loadDotenv({ path: path.join(PROJECT_ROOT, '.env') });

/** Expand a leading `~` and resolve relative paths against the project root. */
function resolvePath(value: string): string {
  const expanded = value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value;
  return path.isAbsolute(expanded) ? expanded : path.resolve(PROJECT_ROOT, expanded);
}

function str(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function num(key: string, fallback: number): number {
  const parsed = Number(str(key, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  return str(key, String(fallback)).trim().toLowerCase() === 'true';
}

/**
 * Mjudio publishes its automation endpoint.json in a different place on each platform.
 * The Mac app is sandboxed and writes inside its container; the Windows app writes to
 * %APPDATA%\Mjudio\Automation. MVM_ENDPOINT_FILE overrides whichever applies.
 */
const DEFAULT_MVM_ENDPOINT_FILE =
  process.platform === 'win32'
    ? path.join(
        process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
        'Mjudio',
        'Automation',
        'endpoint.json',
      )
    : path.join(
        os.homedir(),
        'Library/Containers/com.mjudio.musicvideomaker/Data/Library/Application Support/Mjudio/Automation/endpoint.json',
      );

export const config = {
  projectRoot: PROJECT_ROOT,
  port: num('PORT', 4999),

  dbPath: resolvePath(str('DB_PATH', '../data/songs_vietcafe.db')),

  openaiApiKey: str('OPENAI_API_KEY', ''),
  openaiModel: str('OPENAI_MODEL', 'gpt-5-luna'),

  // Not the piano pipeline's directory: song ids overlap between the cloned databases,
  // so sharing a download dir would overwrite the other pipeline's `${id}_${variant}` files.
  downloadDir: resolvePath(str('DOWNLOAD_DIR', '~/suno/vietcafe/input')),
  outputDir: resolvePath(str('OUTPUT_DIR', '~/suno/vietcafe/output')),

  sunoProfileDir: resolvePath(str('SUNO_PROFILE_DIR', './profiles/suno')),
  ytProfileDir: resolvePath(str('YT_PROFILE_DIR', './profiles/youtube')),

  // The converter is the Mjudio app (macOS and Windows). Its loopback automation server
  // publishes its own port and bearer token in endpoint.json, so the base URL is
  // discovered at call time rather than configured.
  mvmEndpointFile: resolvePath(str('MVM_ENDPOINT_FILE', DEFAULT_MVM_ENDPOINT_FILE)),
  mvmTemplateId: str('MVM_TEMPLATE_ID', ''),
  mvmResolution: str('MVM_RESOLUTION', '1080p'),
  mvmCodec: str('MVM_CODEC', 'h264'),
  mvmFrameRate: num('MVM_FRAME_RATE', 30),

  // Where Step 3 downloads the finished audio from. `studio` opens each clip in Suno
  // Studio and downloads it from the timeline -- exempt from the monthly library
  // download cap Suno introduced on 2026-09-03 (Pro 20, Premier 60), but it needs the
  // Premier plan and costs ~45 s of server-side rendering per clip. `library` is the
  // old per-row Download menu on the create page, which spends that cap.
  sunoDownloadVia: (str('SUNO_DOWNLOAD_VIA', 'studio').trim().toLowerCase() === 'library' ? 'library' : 'studio') as
    | 'studio'
    | 'library',

  dailyTargetMinutes: num('DAILY_TARGET_MINUTES', 120),
  maxSongsPerRun: num('MAX_SONGS_PER_RUN', 50),
  headless: bool('HEADLESS', false),

  // ---- The daily loop: one scheduled firing, several videos ----

  // How many videos one firing of the daily job produces, back to back. Each iteration is
  // a complete independent run -- its own STEP1-6, its own run folder, its own upload --
  // so 1 restores the original single-video behaviour exactly.
  dailyVideoTarget: num('DAILY_VIDEO_TARGET', 10),

  // Pause between iterations, so a loop that is failing fast does not hammer Suno, and so
  // the finished run's browser and ffmpeg processes are gone before the next one starts. Any
  // file they still held open when the cleanup ran is picked up by the cleanup after the
  // next video.
  loopCooldownMinutes: num('LOOP_COOLDOWN_MINUTES', 2),

  // Wall-clock budget for one firing. No new iteration starts once it is spent. Keep this
  // below 24 h: a loop still running at the next scheduled firing makes that day's job
  // find a live run and skip the day.
  loopMaxHours: num('LOOP_MAX_HOURS', 20),

  // Consecutive FAILED runs that end the day. Whatever repeats -- songs exhausted, Suno
  // credits gone, disk full, a signed-out profile -- would otherwise be retried for every
  // remaining video, each attempt costing an hour of browser work to fail the same way.
  loopStopAfterFailures: num('LOOP_STOP_AFTER_FAILURES', 2),

  // Delete a session's consumed artifacts as soon as that session has uploaded, instead of
  // waiting for the next day's pre-run cleanup. Ten sessions of wavs, per-track clips and
  // 2-hour masters do not fit on this disk at once.
  cleanupAfterEachRun: bool('CLEANUP_AFTER_EACH_RUN', true),

  // Also delete files in DOWNLOAD_DIR that match Step 3's own `<songId>_<n>.<ext>` naming
  // but that no song row points at -- leftovers of an aborted download. Nothing else is
  // ever globbed there, because the folder may hold unrelated files.
  cleanupOrphanDownloads: bool('CLEANUP_ORPHAN_DOWNLOADS', true),

  visibility: str('VISIBILITY', 'unlisted').toLowerCase(),
  titleTemplate: str('TITLE_TEMPLATE', '{theme} | Nhạc Chill Quán Cà Phê'),
  descriptionIntro: str('DESCRIPTION_INTRO', 'Nhạc chill quán cà phê Việt Nam có lời – thư giãn, học bài, làm việc. ☕🎶'),
  descriptionIncludeIntroductions: bool('DESCRIPTION_INCLUDE_INTRODUCTIONS', false),
  // YouTube's synthetic/altered-content question. Current policy requires the
  // disclosure for *realistic* depictions of people, places or events; an AI singing
  // voice that imitates no real, identifiable artist over an abstract visualiser is
  // not one, so the default stays "no". Set ALTERED_CONTENT_DISCLOSURE=yes to answer
  // the other way -- and switch it if a generated voice ever resembles a known singer.
  alteredContentDisclosure: str('ALTERED_CONTENT_DISCLOSURE', 'no').toLowerCase(),

  // A monetised channel gets a mandatory "Ads on watch page and YouTube Premium" step
  // in the upload wizard, and Studio will not advance until it is answered. Only
  // meaningful on channels that are actually in the Partner Programme; elsewhere the
  // step never appears and this is ignored.
  youtubeMonetisation: str('YOUTUBE_MONETISATION', 'on').toLowerCase(),

  // Scheduled publishing. With this on, VISIBILITY is not applied directly: the video is
  // set to publish automatically at a future date/time, which Studio treats as Private
  // until then and Public afterwards. The time is randomised inside the hour window so a
  // daily run does not always land in the same slot.
  youtubeSchedule: bool('YOUTUBE_SCHEDULE', true),
  youtubeScheduleDaysAhead: num('YOUTUBE_SCHEDULE_DAYS_AHEAD', 1),
  youtubeScheduleHourMin: num('YOUTUBE_SCHEDULE_HOUR_MIN', 0),
  youtubeScheduleHourMax: num('YOUTUBE_SCHEDULE_HOUR_MAX', 23),

  youtubeTags: str('YOUTUBE_TAGS', 'nhạc chill quán cà phê, nhạc cafe việt nam, acoustic việt, nhạc chill có lời, vpop chill')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean),

  backgroundImagePath: resolvePath(str('BACKGROUND_IMAGE_PATH', './assets/background.jpg')),

  // A folder of interchangeable backdrops. One is picked at random per clip, so a merged
  // video does not stare at the same still image for two hours. Falls back to the single
  // BACKGROUND_IMAGE_PATH when the folder is absent or empty, and to the Mjudio template's
  // own backdrop when neither exists.
  backgroundDir: resolvePath(str('BACKGROUND_DIR', './assets/backgrounds')),
  usePrompt2WhenShort: bool('USE_PROMPT2_WHEN_SHORT', true),
  retryErrors: bool('RETRY_ERRORS', false),

  minFreeGb: num('MIN_FREE_GB', 20),
  loudnormTargetLufs: num('LOUDNORM_TARGET_LUFS', -14),
  trackMinSeconds: num('TRACK_MIN_SECONDS', 90),
  trackMaxSeconds: num('TRACK_MAX_SECONDS', 360),
  crossfadeSeconds: num('CROSSFADE_SECONDS', 0),

  // Step 2 concurrency is capped at 3 by the PRD.
  openaiConcurrency: Math.min(3, num('OPENAI_CONCURRENCY', 3)),
} as const;

export type Config = typeof config;
