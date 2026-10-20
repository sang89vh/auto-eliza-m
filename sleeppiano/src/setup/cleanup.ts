import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config.js';
import { db, latestRun, parseJsonPaths, songsByStatus } from '../lib/db.js';
import { runLogger } from '../lib/logger.js';

export interface CleanupSummary {
  deletedFiles: number;
  freedBytes: number;
  prunedDirs: number;
  /** Set when nothing was deleted, with the reason. */
  skippedReason: string | null;
}

/**
 * Artifacts of these statuses may still be consumed by a future run: GENERATED and
 * CONVERTED feed the carry-over, and RETRY_ERRORS can move ERROR songs back to the
 * status their recorded artifacts justify.
 */
const PROTECTED_STATUSES = ['GENERATED', 'CONVERTED', 'ERROR'] as const;

const MEDIA_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.mp4']);

function allowedRoots(): string[] {
  return [path.resolve(config.downloadDir), path.resolve(config.outputDir)];
}

/**
 * Deletion is confined to DOWNLOAD_DIR and OUTPUT_DIR. The download directory can be
 * shared with unrelated files, so nothing is ever globbed there -- only paths the
 * database recorded are deleted, and even those are checked for containment.
 */
function isInsideAllowedRoots(resolvedPath: string): boolean {
  return allowedRoots().some((root) => resolvedPath === root || resolvedPath.startsWith(root + path.sep));
}

function tryUnlink(filePath: string, protectedPaths: Set<string>): { deleted: boolean; bytes: number } {
  const resolved = path.resolve(filePath);
  if (!isInsideAllowedRoots(resolved) || protectedPaths.has(resolved)) return { deleted: false, bytes: 0 };
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return { deleted: false, bytes: 0 };
    fs.rmSync(resolved);
    return { deleted: true, bytes: stat.size };
  } catch {
    // Already gone (e.g. a manual disk cleanup) or unreadable -- either way not ours to count.
    return { deleted: false, bytes: 0 };
  }
}

function listFilesRecursively(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

/** Remove now-empty directories bottom-up; never removes `root` itself. */
function pruneEmptyDirs(root: string): number {
  let pruned = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
    if (dir !== root) {
      try {
        if (fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
          pruned += 1;
        }
      } catch {
        // A non-empty or vanished directory is simply left alone.
      }
    }
  };
  walk(root);
  return pruned;
}

/**
 * Pre-run cleanup: once the previous run has finished successfully, the audio the
 * pipeline downloaded and the videos it rendered are consumed -- the uploaded result
 * lives on YouTube -- so they only occupy disk on a machine where disk is the
 * binding constraint.
 *
 * Deleted, in this order:
 *   1. every file recorded on a DONE song (input .wav/.mp3 downloads and per-track
 *      .mp4 clips) -- DB-recorded paths only, because DOWNLOAD_DIR can be shared;
 *   2. media files inside the run folders of SUCCESS/PARTIAL runs (normalised wavs,
 *      clips, the merged master), keeping logs and tracklists for the paper trail.
 *
 * Never deleted: anything recorded on a GENERATED/CONVERTED/ERROR song (those files
 * are the resume/carry-over material), and anything outside DOWNLOAD_DIR/OUTPUT_DIR.
 * If the latest run did not finish SUCCESS (or PARTIAL, which also uploaded),
 * nothing is touched at all -- an interrupted run's artifacts are what make its
 * resume cheap.
 */
export function cleanupConsumedArtifacts(): CleanupSummary {
  const latest = latestRun();
  if (!latest) {
    return { deletedFiles: 0, freedBytes: 0, prunedDirs: 0, skippedReason: 'no previous run on record' };
  }
  if (latest.status !== 'SUCCESS' && latest.status !== 'PARTIAL') {
    return {
      deletedFiles: 0,
      freedBytes: 0,
      prunedDirs: 0,
      skippedReason: `previous run finished ${latest.status}; artifacts kept for resume/carry-over`,
    };
  }

  const protectedPaths = new Set<string>();
  for (const song of songsByStatus([...PROTECTED_STATUSES])) {
    for (const p of [...parseJsonPaths(song.piano_audio_path), ...parseJsonPaths(song.piano_video_path)]) {
      protectedPaths.add(path.resolve(p));
    }
  }

  let deletedFiles = 0;
  let freedBytes = 0;

  // 1. Consumed per-song artifacts, by DB-recorded path.
  for (const song of songsByStatus(['DONE'])) {
    for (const p of [...parseJsonPaths(song.piano_audio_path), ...parseJsonPaths(song.piano_video_path)]) {
      const result = tryUnlink(p, protectedPaths);
      if (result.deleted) {
        deletedFiles += 1;
        freedBytes += result.bytes;
      }
    }
  }

  // 2. Media inside the run folders of finished runs (located via merged_video_path:
  //    <outputDir>/run_*/final/final_*.mp4 -> the run_* folder two levels up).
  const finishedRuns = db()
    .prepare(
      `SELECT merged_video_path FROM pipeline_run
        WHERE status IN ('SUCCESS', 'PARTIAL') AND merged_video_path IS NOT NULL AND TRIM(merged_video_path) <> ''`,
    )
    .all() as Array<{ merged_video_path: string }>;

  const outputRoot = path.resolve(config.outputDir);
  const sweptFolders = new Set<string>();
  for (const run of finishedRuns) {
    const runRoot = path.resolve(path.dirname(path.dirname(run.merged_video_path)));
    if (!runRoot.startsWith(outputRoot + path.sep) || !path.basename(runRoot).startsWith('run_')) continue;
    if (sweptFolders.has(runRoot)) continue;
    sweptFolders.add(runRoot);

    for (const file of listFilesRecursively(runRoot)) {
      if (!MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      const result = tryUnlink(file, protectedPaths);
      if (result.deleted) {
        deletedFiles += 1;
        freedBytes += result.bytes;
      }
    }
  }

  const prunedDirs = fs.existsSync(outputRoot) ? pruneEmptyDirs(outputRoot) : 0;

  return { deletedFiles, freedBytes, prunedDirs, skippedReason: null };
}

export function logCleanupSummary(summary: CleanupSummary): void {
  if (summary.skippedReason) {
    runLogger.info(`Cleanup skipped: ${summary.skippedReason}`);
    return;
  }
  const freedGb = summary.freedBytes / 1024 ** 3;
  runLogger.info(
    `Cleanup: deleted ${summary.deletedFiles} consumed file(s), freed ${freedGb.toFixed(2)} GB, ` +
      `pruned ${summary.prunedDirs} empty folder(s)`,
  );
}
