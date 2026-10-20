import fs from 'node:fs';
import { config } from './config.js';
import { db } from './db.js';
import { freeSpaceGb, isOnPath } from './ffmpeg.js';
import { ensureWritableDir } from './folderAccess.js';
import { health as mjudioHealth, MjudioUnavailableError } from './mjudio.js';
import { verifyModel } from './openai.js';
import { profileExists } from './browser.js';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** A warning is reported but does not block the run. */
  warning?: boolean;
}

/**
 * Fail fast, and fail *before* the expensive steps. Mjudio's health check is here
 * even though the PRD's list omits it: without it a run can burn two hours of Suno
 * credits and only then discover at Step 4 that the converter was never running.
 */
export async function preflight(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // DB_PATH exists and my_song is readable.
  try {
    if (!fs.existsSync(config.dbPath)) throw new Error('file does not exist');
    const row = db().prepare('SELECT COUNT(*) AS n FROM my_song').get() as { n: number };
    results.push({ name: 'Database', ok: true, detail: `${config.dbPath} (${row.n} songs)` });
  } catch (error) {
    results.push({
      name: 'Database',
      ok: false,
      detail: `Cannot read my_song from DB_PATH=${config.dbPath}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // OPENAI_API_KEY present, and the configured model actually resolves.
  if (!config.openaiApiKey) {
    results.push({ name: 'OpenAI key', ok: false, detail: 'OPENAI_API_KEY is not set in .env' });
  } else {
    results.push({ name: 'OpenAI key', ok: true, detail: 'present' });
    try {
      await verifyModel();
      results.push({ name: 'OpenAI model', ok: true, detail: config.openaiModel });
    } catch (error) {
      results.push({
        name: 'OpenAI model',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ffmpeg + ffprobe on PATH.
  for (const binary of ['ffmpeg', 'ffprobe'] as const) {
    const ok = await isOnPath(binary);
    results.push({ name: binary, ok, detail: ok ? 'on PATH' : `${binary} was not found on PATH` });
  }

  // Playwright persistent profiles.
  for (const [name, dir] of [
    ['Suno profile', config.sunoProfileDir],
    ['YouTube profile', config.ytProfileDir],
  ] as const) {
    const ok = profileExists(dir);
    results.push({
      name,
      ok,
      detail: ok ? dir : `${dir} has no saved session — run \`npm run setup:login\` and sign in`,
    });
  }

  // music_video_maker (Mjudio) reachable.
  try {
    const info = await mjudioHealth();
    results.push({
      name: 'music_video_maker',
      ok: true,
      detail: `Mjudio ${info.version ?? '?'} up, plan=${info.plan ?? 'unknown'}`,
    });
  } catch (error) {
    const hint =
      error instanceof MjudioUnavailableError
        ? 'Launch Mjudio and turn on Settings ▸ Automation.'
        : '';
    results.push({
      name: 'music_video_maker',
      ok: false,
      detail: `${error instanceof Error ? error.message : String(error)} ${hint}`.trim(),
    });
  }

  // OUTPUT_DIR and DOWNLOAD_DIR writable. Step 3 saves every Suno download into
  // DOWNLOAD_DIR, so a folder this account cannot write would otherwise only surface once
  // the whole run's credits were spent.
  for (const [name, setting, dir] of [
    ['Output folder', 'OUTPUT_DIR', config.outputDir],
    ['Download folder', 'DOWNLOAD_DIR', config.downloadDir],
  ] as const) {
    try {
      ensureWritableDir(dir, setting);
      results.push({ name, ok: true, detail: dir });
    } catch (error) {
      results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  // Free disk space.
  try {
    const freeGb = freeSpaceGb(config.outputDir);
    results.push({
      name: 'Disk space',
      ok: freeGb >= config.minFreeGb,
      detail: `${freeGb.toFixed(1)} GB free on the OUTPUT_DIR volume (need ${config.minFreeGb} GB)`,
    });
  } catch (error) {
    results.push({
      name: 'Disk space',
      ok: false,
      detail: `Could not measure free space: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // Missing backgrounds are survivable — Mjudio renders its template backdrop.
  const backgroundCount = (() => {
    try {
      return fs
        .readdirSync(config.backgroundDir)
        .filter((name) => /\.(jpe?g|png|webp)$/i.test(name)).length;
    } catch {
      return 0;
    }
  })();

  if (backgroundCount > 0) {
    results.push({
      name: 'Background images',
      ok: true,
      detail: `${backgroundCount} backdrop(s) in ${config.backgroundDir}, one picked at random per clip`,
    });
  } else if (fs.existsSync(config.backgroundImagePath)) {
    results.push({
      name: 'Background images',
      ok: true,
      detail: `single backdrop ${config.backgroundImagePath} (add more to ${config.backgroundDir} to vary them)`,
    });
  } else {
    results.push({
      name: 'Background images',
      ok: true,
      warning: true,
      detail: `no images in ${config.backgroundDir}; the Mjudio template's own backdrop will be used`,
    });
  }

  return results;
}

export function preflightFailures(results: CheckResult[]): CheckResult[] {
  return results.filter((result) => !result.ok && !result.warning);
}
