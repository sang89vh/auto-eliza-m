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
  port: num('PORT', 3999),

  dbPath: resolvePath(str('DB_PATH', '../data/songs_win.db')),

  openaiApiKey: str('OPENAI_API_KEY', ''),
  openaiModel: str('OPENAI_MODEL', 'gpt-5-luna'),

  downloadDir: resolvePath(str('DOWNLOAD_DIR', '~/suno/input')),
  outputDir: resolvePath(str('OUTPUT_DIR', '~/suno/output')),

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

  visibility: str('VISIBILITY', 'unlisted').toLowerCase(),
  titleTemplate: str('TITLE_TEMPLATE', '{theme} | Relaxing Piano Sleep Music'),
  descriptionIntro: str('DESCRIPTION_INTRO', 'Soft instrumental piano to help you fall asleep.'),
  descriptionIncludeIntroductions: bool('DESCRIPTION_INCLUDE_INTRODUCTIONS', false),
  // YouTube's synthetic/altered-content question. Current policy requires the
  // disclosure for *realistic* depictions of people, places or events; AI-generated
  // instrumental music over an abstract visualiser is not one, so the default is
  // "no". Set ALTERED_CONTENT_DISCLOSURE=yes to answer the other way.
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

  youtubeTags: str('YOUTUBE_TAGS', 'piano sleep music, relaxing piano, deep sleep, calm piano')
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
