/**
 * Smoke test for the Suno Studio download path (lib/sunoStudio.ts) against the live
 * site, using this project's saved Suno profile. No credits are spent: it only opens
 * clips that already exist in the library.
 *
 *   npx tsx tests/smoke_studio_download.ts <clipId> [<clipId> ...] [--keep]
 *
 * Clip ids are the `/song/<uuid>` part of any library link. Files land in a temp
 * folder and are deleted afterwards unless --keep is given. Screenshots of any failure
 * go to that same folder.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchPersistentContext } from '../src/lib/browser.js';
import { config } from '../src/lib/config.js';
import { probeDuration } from '../src/lib/ffmpeg.js';
import { StudioDownloader } from '../src/lib/sunoStudio.js';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const clipIds = args.filter((arg) => /^[0-9a-f-]{36}$/i.test(arg));

if (clipIds.length === 0) {
  console.error('Usage: npx tsx tests/smoke_studio_download.ts <clipId> [<clipId> ...] [--keep]');
  process.exit(2);
}

async function main(): Promise<void> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-studio-smoke-'));
  console.log(`Profile: ${config.sunoProfileDir}`);
  console.log(`Work dir: ${workDir}`);

  const context = await launchPersistentContext(config.sunoProfileDir, { downloadDir: workDir });
  const studio = new StudioDownloader(context, workDir);
  let failures = 0;

  try {
    const t0 = Date.now();
    await studio.verifyAccess();
    console.log(`Studio access verified in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    for (const [index, clipId] of clipIds.entries()) {
      const started = Date.now();
      const downloaded = await studio.download(clipId, path.join(workDir, `clip_${index + 1}`));
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (!downloaded) {
        failures += 1;
        console.log(`FAIL ${clipId}: no file after ${seconds}s (see screenshots in ${workDir})`);
        continue;
      }
      const duration = await probeDuration(downloaded);
      const size = fs.statSync(downloaded).size;
      console.log(`OK   ${clipId}: ${path.basename(downloaded)} ${(size / 1_048_576).toFixed(1)} MB, ${duration.toFixed(1)}s audio, ${seconds}s wall`);
      if (!keep) fs.rmSync(downloaded, { force: true });
    }
  } finally {
    await studio.close();
    await context.close().catch(() => undefined);
  }

  console.log(failures === 0 ? 'All clips downloaded through Studio.' : `${failures} clip(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
