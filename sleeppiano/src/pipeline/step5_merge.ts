import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config.js';
import { parseJsonPaths, type SongRow } from '../lib/db.js';
import { concatVideos, ensureUniform, measureIntegratedLoudness, probeDuration } from '../lib/ffmpeg.js';
import { runLogger } from '../lib/logger.js';
import type { RunFolder } from '../lib/runFolder.js';

export interface TracklistEntry {
  songId: number;
  title: string;
  startSec: number;
  durationSec: number;
  videoPath: string;
}

export interface Step5Result {
  finalVideoPath: string;
  tracklistPath: string;
  tracklist: TracklistEntry[];
  durationSec: number;
  includedSongIds: number[];
}

export class MergeValidationError extends Error {}

/** MM:SS below an hour, H:MM:SS above it — the format YouTube turns into chapters. */
export function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

/**
 * Repeated titles get a numeric suffix. A song contributes two variants, and two
 * identical consecutive chapter names read as a mistake on YouTube.
 */
function uniqueTitle(base: string, seen: Map<string, number>): string {
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base} (${count})`;
}

/**
 * STEP 5 -- concatenate every converted video into one continuous file and write the
 * timestamped tracklist alongside it.
 *
 * The ffmpeg flags come from this project's own merge template
 * (shscript/merge_processed_videos.sh), the macOS sibling of the eliza-story
 * merge helper. v1 concatenates in generation order with no crossfade.
 */
export async function step5Merge(songs: SongRow[], runFolder: RunFolder): Promise<Step5Result> {
  runLogger.setStep('STEP5');

  const converted = songs.filter((song) => song.piano_status === 'CONVERTED');
  const clips: Array<{ song: SongRow; videoPath: string }> = [];

  for (const song of converted) {
    for (const videoPath of parseJsonPaths(song.piano_video_path)) {
      if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0) {
        clips.push({ song, videoPath });
      } else {
        runLogger.warn(`[STEP5] skipping missing clip ${videoPath} for song ${song.id}`);
      }
    }
  }

  if (clips.length === 0) {
    throw new MergeValidationError('No converted videos are available to merge');
  }

  runLogger.info(`[STEP5] merging ${clips.length} clip(s) from ${converted.length} song(s)`);

  // The concat demuxer needs a uniform stream layout. Mjudio exports already match,
  // so this is normally a no-op.
  const workDir = path.join(runFolder.video, '_uniform');
  const uniformPaths: string[] = [];
  for (const clip of clips) {
    uniformPaths.push(await ensureUniform(clip.videoPath, workDir));
  }

  // Tracklist is built from the real per-clip durations, in the same order the
  // concat list uses, so the timestamps match what a viewer will hear.
  const tracklist: TracklistEntry[] = [];
  const seenTitles = new Map<string, number>();
  let cursorSec = 0;

  for (const [index, clip] of clips.entries()) {
    const uniformPath = uniformPaths[index] as string;
    const durationSec = await probeDuration(uniformPath);
    tracklist.push({
      songId: clip.song.id,
      title: uniqueTitle(clip.song.piano_title?.trim() || 'Relaxing Piano', seenTitles),
      startSec: cursorSec,
      durationSec,
      videoPath: uniformPath,
    });
    cursorSec += durationSec;
  }

  const finalVideoPath = path.join(runFolder.final, `final_${runFolder.dateStamp}.mp4`);
  const listFilePath = path.join(runFolder.final, 'concat_list.txt');
  await concatVideos(uniformPaths, finalVideoPath, listFilePath);

  if (!fs.existsSync(finalVideoPath) || fs.statSync(finalVideoPath).size === 0) {
    throw new MergeValidationError(`ffmpeg produced no output at ${finalVideoPath}`);
  }

  const actualDurationSec = await probeDuration(finalVideoPath);
  const actualMinutes = actualDurationSec / 60;
  const lowerBound = config.dailyTargetMinutes - 10;
  const upperBound = config.dailyTargetMinutes + 10;

  const tracklistPath = path.join(runFolder.final, 'tracklist.txt');
  fs.writeFileSync(
    tracklistPath,
    `${tracklist.map((entry) => `${formatTimestamp(entry.startSec)} ${entry.title}`).join('\n')}\n`,
    'utf8',
  );
  // A machine-readable twin, so a Step 6 resume can rebuild the tracklist without
  // re-merging. tracklist.txt stays human-readable and is what the PRD specifies.
  fs.writeFileSync(path.join(runFolder.final, 'tracklist.json'), JSON.stringify(tracklist, null, 2), 'utf8');
  runLogger.info(`[STEP5] tracklist written to ${tracklistPath}`);

  const loudness = await measureIntegratedLoudness(finalVideoPath);
  if (loudness !== null) {
    runLogger.info(`[STEP5] integrated loudness of the merged file: ${loudness.toFixed(1)} LUFS (target ${config.loudnormTargetLufs})`);
  }

  if (actualMinutes < lowerBound || actualMinutes > upperBound) {
    throw new MergeValidationError(
      `Merged video is ${actualMinutes.toFixed(1)} min, outside the required ` +
        `${lowerBound}-${upperBound} min window. The file is kept at ${finalVideoPath} but will not be uploaded.`,
    );
  }

  runLogger.info(`[STEP5] done: ${finalVideoPath} (${actualMinutes.toFixed(1)} min)`);

  return {
    finalVideoPath,
    tracklistPath,
    tracklist,
    durationSec: Math.round(actualDurationSec),
    includedSongIds: [...new Set(clips.map((clip) => clip.song.id))],
  };
}
