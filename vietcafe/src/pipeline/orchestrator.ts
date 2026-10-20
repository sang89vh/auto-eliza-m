import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config.js';
import {
  createRun,
  getSong,
  markSongDone,
  previousRun,
  requeueErroredSongs,
  songsByStatus,
  updateRun,
  type SongRow,
} from '../lib/db.js';
import { runLogger } from '../lib/logger.js';
import { preflight, preflightFailures } from '../lib/preflight.js';
import { createRunFolder, finalVideoAt, findExistingFinalVideo, stampFor, type RunFolder } from '../lib/runFolder.js';
import { NoSongsError, step1SelectSongs } from './step1_select.js';
import { step2GeneratePrompts } from './step2_prompts.js';
import { step3GenerateAudio } from './step3_suno.js';
import { step4ConvertToVideo } from './step4_convert.js';
import {
  MERGE_WINDOW_MINUTES,
  MergeValidationError,
  step5Merge,
  type Step5Result,
  type TracklistEntry,
} from './step5_merge.js';
import { step6Upload } from './step6_youtube.js';

export interface RunProgress {
  runId: number | null;
  step: string;
  songsSelected: number;
  songsDone: number;
  tracksGenerated: number;
  minutesGenerated: number;
  targetMinutes: number;
}

export interface RunOptions {
  /** The Resume button: re-queue every ERROR song before this run selects anything. */
  retryErrors?: boolean;
}

/** A run-level abort: nothing is uploaded and the run finishes FAILED. */
class RunAbortedError extends Error {}

function idleProgress(): RunProgress {
  return {
    runId: null,
    step: 'IDLE',
    songsSelected: 0,
    songsDone: 0,
    tracksGenerated: 0,
    minutesGenerated: 0,
    targetMinutes: config.dailyTargetMinutes,
  };
}

let progress: RunProgress = idleProgress();

let inFlight: Promise<void> | null = null;

export function currentProgress(): RunProgress {
  return { ...progress };
}

export function isRunning(): boolean {
  return inFlight !== null;
}

/**
 * The "Reset" button: drop the last run's numbers so the page shows an idle pipeline
 * again. The caller has already checked that no run is in flight.
 */
export function resetProgress(): void {
  progress = idleProgress();
}

function setProgress(patch: Partial<RunProgress>): void {
  progress = { ...progress, ...patch };
}

/** Re-read the selected songs so each step sees statuses the previous one wrote. */
function refresh(songs: SongRow[]): SongRow[] {
  return songs.map((song) => getSong(song.id) ?? song);
}

/**
 * PRD §10: a run that produced a merged file but failed to upload resumes directly at
 * Step 6. Regenerating two hours of audio to reproduce a file already on disk is
 * exactly the waste the resume rule exists to prevent.
 *
 * The file resumed is the one *that* run recorded, never "today's merged file": with the
 * daily loop producing several videos a day there are several `final_YYYYMMDD.mp4` files,
 * and a date-based search could hand this run a video an earlier one already uploaded. A
 * recorded path that no longer exists means the file was cleaned up — then there is
 * nothing to resume, and no substitute is acceptable.
 */
function findStep6Resume(currentRunId: number): { videoPath: string; folder: RunFolder; tracklist: TracklistEntry[] } | null {
  const previous = previousRun(currentRunId);
  if (!previous || previous.status !== 'FAILED' || previous.current_step !== 'STEP6') return null;

  const existing = previous.merged_video_path
    ? finalVideoAt(previous.merged_video_path)
    : // Rows written before merged_video_path was recorded: fall back to the date scan.
      findExistingFinalVideo(stampFor().dateStamp);
  if (!existing) return null;

  const tracklistJsonPath = path.join(existing.folder.final, 'tracklist.json');
  if (!fs.existsSync(tracklistJsonPath)) return null;

  try {
    const tracklist = JSON.parse(fs.readFileSync(tracklistJsonPath, 'utf8')) as TracklistEntry[];
    if (!Array.isArray(tracklist) || tracklist.length === 0) return null;
    return { videoPath: existing.videoPath, folder: existing.folder, tracklist };
  } catch {
    return null;
  }
}

/** The Resume button: every ERROR song goes back to its last good step before anything is selected. */
function retryErroredSongs(): void {
  const { requeued, landed, demoted } = requeueErroredSongs();

  if (requeued === 0) {
    runLogger.info('Resume: no song is at ERROR; continuing from what earlier runs left behind');
  } else {
    const breakdown = Object.entries(landed)
      .map(([status, n]) => `${n} → ${status}`)
      .join(', ');
    runLogger.info(`Resume: ${requeued} failed song(s) re-queued at their last good step (${breakdown})`);
  }

  if (demoted > 0) {
    runLogger.warn(`Resume: ${demoted} song(s) moved further back because their files are no longer on disk`);
  }
}

/**
 * How far below Step 5's upper bound the carry-over stops. The bound is checked against the
 * merged file's probed length, which can run slightly longer than the recorded audio
 * durations add up to -- each Mjudio clip may drift up to 2 s from its audio.
 */
const CARRY_OVER_HEADROOM_SEC = 120;

/**
 * The songs an earlier run left at GENERATED/CONVERTED that this run takes over -- capped
 * at one video's worth.
 *
 * Steps 3-5 put everything in the working set into one merge, and nothing else limits how
 * much is waiting. After the Resume button re-queues three runs that all failed at Step 4,
 * some six hours of audio sit at GENERATED; folding all of it in makes Step 5 produce a
 * six-hour file, fail its window, and leave every one of those songs CONVERTED -- so each
 * later run folds the same six hours in again and fails the same way.
 *
 * So CONVERTED songs are taken first (they need no Mjudio export), then GENERATED, oldest
 * first within each, until the target is met. A song that would push the total past the
 * merge window's upper edge is left for the next run and a smaller one tried instead.
 * Whatever is not taken keeps its status and is the next run's carry-over: a backlog is
 * worked off one video at a time, with no Suno generation.
 */
export function selectCarryOver(
  selected: SongRow[],
  targetSeconds: number = config.dailyTargetMinutes * 60,
): { carriedOver: SongRow[]; deferred: SongRow[] } {
  const selectedIds = new Set(selected.map((song) => song.id));
  const ceilingSeconds = targetSeconds + MERGE_WINDOW_MINUTES * 60 - CARRY_OVER_HEADROOM_SEC;
  const rank = (song: SongRow): number => (song.cafe_status === 'CONVERTED' ? 0 : 1);

  const candidates = songsByStatus(['GENERATED', 'CONVERTED'])
    .filter((song) => !selectedIds.has(song.id))
    .sort((a, b) => rank(a) - rank(b) || a.id - b.id);

  const carriedOver: SongRow[] = [];
  const deferred: SongRow[] = [];
  let totalSeconds = 0;

  for (const song of candidates) {
    const seconds = song.cafe_duration_sec ?? 0;
    if (totalSeconds >= targetSeconds || totalSeconds + seconds > ceilingSeconds) {
      deferred.push(song);
      continue;
    }
    carriedOver.push(song);
    totalSeconds += seconds;
  }

  return { carriedOver, deferred };
}

async function runPipeline(runId: number, runFolder: RunFolder, options: RunOptions): Promise<void> {
  // runPipeline only starts once pre-flight has passed, so a Resume that cannot start changes
  // nothing. And this comes before the Step 6 check, so a resumed upload does not leave the
  // failed songs waiting for yet another click.
  if (options.retryErrors) retryErroredSongs();

  const resume = findStep6Resume(runId);

  let merge: Step5Result;
  let songs: SongRow[] = [];
  let anyErrors = false;

  if (resume) {
    runLogger.info(
      `Resuming at STEP6: ${path.basename(resume.videoPath)} already exists from a run that failed at upload`,
    );
    merge = {
      finalVideoPath: resume.videoPath,
      tracklistPath: path.join(resume.folder.final, 'tracklist.txt'),
      tracklist: resume.tracklist,
      durationSec: resume.tracklist.reduce((sum, entry) => sum + entry.durationSec, 0),
      includedSongIds: [...new Set(resume.tracklist.map((entry) => entry.songId))],
    };
    runFolder = resume.folder;
    runLogger.attachFile(path.join(runFolder.logs, 'run.log'));
    updateRun(runId, {
      current_step: 'STEP6',
      merged_video_path: merge.finalVideoPath,
      total_duration_sec: merge.durationSec,
      tracks_generated: merge.tracklist.length,
    });
    setProgress({ step: 'STEP6', minutesGenerated: merge.durationSec / 60, tracksGenerated: merge.tracklist.length });
  } else {
    // ---- STEP 1 ----
    setProgress({ step: 'STEP1' });
    updateRun(runId, { current_step: 'STEP1' });
    songs = step1SelectSongs();
    updateRun(runId, { songs_selected: songs.length });
    setProgress({ songsSelected: songs.length });

    // ---- STEP 2 ----
    setProgress({ step: 'STEP2' });
    updateRun(runId, { current_step: 'STEP2' });
    const step2 = await step2GeneratePrompts(songs);
    anyErrors ||= step2.errored > 0;
    songs = refresh(songs);

    // Step 1 selects INIT/PROMPTED only, by design. But an interrupted run leaves songs
    // at GENERATED or CONVERTED with their audio and video already on disk, and Step 1
    // will never hand those back. Folding them in here is what makes a crashed run
    // continue: without it Step 3 starts its minute count at zero and generates a second
    // two hours on top of the first, and Step 4 never converts the orphans. The fold is
    // capped at one video's worth (see selectCarryOver); a larger backlog -- several failed
    // runs re-queued at once by the Resume button -- waits for the runs after this one.
    const { carriedOver, deferred } = selectCarryOver(songs);
    if (carriedOver.length > 0) {
      const carriedMinutes = carriedOver.reduce((sum, song) => sum + (song.cafe_duration_sec ?? 0), 0) / 60;
      runLogger.info(
        `Carrying over ${carriedOver.length} song(s) left mid-flight by an earlier run ` +
          `(${carriedMinutes.toFixed(1)} min already on disk)`,
      );
    }
    if (deferred.length > 0) {
      const deferredMinutes = deferred.reduce((sum, song) => sum + (song.cafe_duration_sec ?? 0), 0) / 60;
      runLogger.info(
        `Leaving ${deferred.length} more song(s) (${deferredMinutes.toFixed(1)} min) for the next run — ` +
          "more than one video's worth is waiting",
      );
    }
    let working: SongRow[] = [...songs, ...carriedOver];

    // ---- STEP 3 ----
    setProgress({ step: 'STEP3' });
    updateRun(runId, { current_step: 'STEP3' });
    const step3 = await step3GenerateAudio(working, runFolder);
    anyErrors ||= step3.errored > 0;
    working = refresh(working);
    updateRun(runId, {
      tracks_generated: step3.tracksGenerated,
      total_duration_sec: step3.totalDurationSec,
    });
    setProgress({
      tracksGenerated: step3.tracksGenerated,
      minutesGenerated: step3.totalDurationSec / 60,
    });

    // Run-level abort: too little audio to be worth converting and uploading.
    const minutesGenerated = step3.totalDurationSec / 60;
    const minimumMinutes = Math.min(60, config.dailyTargetMinutes / 2);
    if (minutesGenerated < minimumMinutes) {
      throw new RunAbortedError(
        `Only ${minutesGenerated.toFixed(1)} min of audio was generated after exhausting the selected songs ` +
          `(minimum ${minimumMinutes} min). Nothing was uploaded.`,
      );
    }

    // ---- STEP 4 ----
    setProgress({ step: 'STEP4' });
    updateRun(runId, { current_step: 'STEP4' });
    const step4 = await step4ConvertToVideo(working, runFolder);
    anyErrors ||= step4.errored > 0;
    working = refresh(working);

    // ---- STEP 5 ----
    setProgress({ step: 'STEP5' });
    updateRun(runId, { current_step: 'STEP5' });
    merge = await step5Merge(working, runFolder);
    updateRun(runId, {
      merged_video_path: merge.finalVideoPath,
      total_duration_sec: merge.durationSec,
    });
    setProgress({ minutesGenerated: merge.durationSec / 60 });
  }

  // ---- STEP 6 ----
  setProgress({ step: 'STEP6' });
  updateRun(runId, { current_step: 'STEP6' });
  const upload = await step6Upload(merge.finalVideoPath, merge.tracklist, runFolder);

  for (const songId of merge.includedSongIds) markSongDone(songId);
  setProgress({ songsDone: merge.includedSongIds.length, step: 'DONE' });

  updateRun(runId, {
    status: anyErrors ? 'PARTIAL' : 'SUCCESS',
    youtube_url: upload.youtubeUrl,
    current_step: 'STEP6',
    finished_at: new Date().toISOString(),
    error: anyErrors ? 'Completed with some songs marked ERROR — see the run log' : null,
  });

  runLogger.setStep('DONE');
  runLogger.info(
    `Run ${runId} finished ${anyErrors ? 'PARTIAL' : 'SUCCESS'}: ${merge.includedSongIds.length} song(s) marked DONE — ${upload.youtubeUrl}`,
  );
}

/** Starts a run in the background. The caller has already checked that none is active. */
export function startRun(options: RunOptions = {}): { runId: number } {
  const { runDate } = stampFor();
  const runFolder = createRunFolder();
  const runId = createRun(runDate);

  runLogger.attachFile(path.join(runFolder.logs, 'run.log'));
  runLogger.setStep('STEP0');
  progress = { ...idleProgress(), runId, step: 'STEP0' };

  runLogger.info(
    `Run ${runId} started${options.retryErrors ? ' to resume failed work' : ''} — output folder ${runFolder.root}`,
  );

  inFlight = (async () => {
    try {
      // ---- STEP 0: pre-flight ----
      const checks = await preflight();
      for (const check of checks) {
        const marker = check.ok ? (check.warning ? 'WARN' : 'ok') : 'FAIL';
        runLogger.log(`[preflight] ${check.name}: ${marker} — ${check.detail}`, check.ok ? (check.warning ? 'warn' : 'info') : 'error');
      }
      const failures = preflightFailures(checks);
      if (failures.length > 0) {
        throw new RunAbortedError(`Pre-flight failed: ${failures.map((f) => `${f.name} (${f.detail})`).join('; ')}`);
      }

      await runPipeline(runId, runFolder, options);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const isExpected =
        error instanceof RunAbortedError || error instanceof NoSongsError || error instanceof MergeValidationError;

      runLogger.error(`Run ${runId} failed: ${detail}`);
      if (!isExpected && error instanceof Error && error.stack) runLogger.error(error.stack);

      updateRun(runId, {
        status: 'FAILED',
        error: detail.slice(0, 4000),
        finished_at: new Date().toISOString(),
      });
      setProgress({ step: 'FAILED' });
    } finally {
      runLogger.detachFile();
      inFlight = null;
    }
  })();

  return { runId };
}
