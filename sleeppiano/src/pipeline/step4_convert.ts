import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config.js';
import { markSongError, parseJsonPaths, saveVideo, type SongRow } from '../lib/db.js';
import { normalizeLoudness, probeDuration } from '../lib/ffmpeg.js';
import { runLogger } from '../lib/logger.js';
import { convertWavToMp4, pickTemplate } from '../lib/mjudio.js';
import { withRetry } from '../lib/retry.js';
import type { RunFolder } from '../lib/runFolder.js';

export interface Step4Summary {
  converted: number;
  skipped: number;
  errored: number;
}

const DURATION_TOLERANCE_SEC = 2;

/**
 * Loudness is normalised here, on the audio, rather than after the merge.
 *
 * PRD Step 5 allows either; doing it per-track before conversion is the simpler
 * reliable option, because the alternative means re-encoding the audio of a
 * finished two-hour file, and because it keeps every track independently correct
 * instead of letting one loud track skew the whole mix.
 */
async function prepareAudio(sourcePath: string, runFolder: RunFolder): Promise<string> {
  const normalizedPath = path.join(runFolder.audio, `${path.parse(sourcePath).name}_norm.wav`);
  if (fs.existsSync(normalizedPath) && fs.statSync(normalizedPath).size > 0) return normalizedPath;
  await normalizeLoudness(sourcePath, normalizedPath);
  return normalizedPath;
}

async function convertOne(
  song: SongRow,
  audioPath: string,
  variant: number,
  runFolder: RunFolder,
): Promise<string> {
  const outputPath = path.join(runFolder.video, `${song.id}_${variant}.mp4`);
  // The project name reaches the video's text layer, so the naming policy applies:
  // it is the mood-based piano_title, never the original song title.
  const projectName = song.piano_title?.trim() || 'Relaxing Piano Sleep Music';

  const normalizedAudio = await prepareAudio(audioPath, runFolder);
  const audioDuration = await probeDuration(normalizedAudio);

  // Rolled per clip so a merged video cycles through looks instead of repeating one.
  const templateId = await pickTemplate();
  await convertWavToMp4(normalizedAudio, { projectName, outputPath, templateId });

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error(`Converter produced no file at ${outputPath}`);
  }

  const videoDuration = await probeDuration(outputPath);
  const drift = Math.abs(videoDuration - audioDuration);
  if (drift > DURATION_TOLERANCE_SEC) {
    fs.rmSync(outputPath, { force: true });
    throw new Error(
      `Video duration ${videoDuration.toFixed(1)}s differs from audio ${audioDuration.toFixed(1)}s ` +
        `by ${drift.toFixed(1)}s (tolerance ${DURATION_TOLERANCE_SEC}s)`,
    );
  }

  return outputPath;
}

/**
 * STEP 4 -- turn every downloaded track into an .mp4 via music_video_maker (Mjudio).
 *
 * Songs already at CONVERTED are skipped, so a re-run does not re-render work that
 * survived a crash.
 */
export async function step4ConvertToVideo(songs: SongRow[], runFolder: RunFolder): Promise<Step4Summary> {
  runLogger.setStep('STEP4');

  const pending = songs.filter((song) => song.piano_status === 'GENERATED');
  const skipped = songs.filter((song) => song.piano_status === 'CONVERTED').length;
  if (skipped > 0) runLogger.info(`Skipping ${skipped} song(s) already at CONVERTED`);
  if (pending.length === 0) {
    runLogger.info('[STEP4] nothing to convert');
    return { converted: 0, skipped, errored: 0 };
  }

  runLogger.info(`Converting ${pending.length} song(s) to video`);

  let converted = 0;
  let errored = 0;

  for (const [index, song] of pending.entries()) {
    const label = `${index + 1}/${pending.length} song ${song.id}`;
    const audioPaths = parseJsonPaths(song.piano_audio_path).filter((audioPath) => fs.existsSync(audioPath));

    if (audioPaths.length === 0) {
      errored += 1;
      markSongError(song.id, 'STEP4: none of the recorded audio files exist on disk');
      runLogger.error(`[STEP4] ${label} – no audio on disk, marked ERROR`);
      continue;
    }

    const videoPaths: string[] = [];
    let failure: string | null = null;

    for (const [variantIndex, audioPath] of audioPaths.entries()) {
      try {
        // Every external call gets one retry before the song is failed.
        const videoPath = await withRetry(
          () => convertOne(song, audioPath, variantIndex + 1, runFolder),
          { label: `[STEP4] ${label} ${path.basename(audioPath)}`, attempts: 2, baseDelayMs: 5000 },
        );
        videoPaths.push(videoPath);
        runLogger.info(`[STEP4] ${label} – ${path.basename(videoPath)} created`);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    if (videoPaths.length === audioPaths.length) {
      saveVideo(song.id, videoPaths);
      converted += 1;
    } else {
      errored += 1;
      markSongError(song.id, `STEP4: ${failure ?? 'conversion incomplete'}`);
      runLogger.error(`[STEP4] ${label} – failed, marked ERROR: ${failure}`);
    }
  }

  runLogger.info(`[STEP4] done: ${converted} converted, ${errored} errored, ${skipped} skipped`);
  return { converted, skipped, errored };
}
