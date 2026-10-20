import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config.js';
import { latestRun, parseJsonPaths, songsByStatus } from '../lib/db.js';
import { runLogger } from '../lib/logger.js';

export interface CleanupSummary {
  deletedFiles: number;
  freedBytes: number;
  prunedDirs: number;
  /** Of `deletedFiles`, how many were unreferenced downloads rather than consumed artifacts. */
  orphanFiles: number;
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

const ALL_STATUSES = ['INIT', 'PROMPTED', 'GENERATED', 'CONVERTED', 'DONE', 'ERROR'] as const;

/**
 * Step 3 names its downloads `<songId>_<n>.<ext>`, and `<songId>_p2_<n>.<ext>` for the
 * prompt2 top-up. Nothing a human would drop into the folder looks like that, which is what
 * makes the orphan sweep safe in a directory the rest of this file refuses to glob.
 */
const DOWNLOAD_NAME_PATTERN = /^\d+(?:_p2)?_\d+\.(?:wav|mp3|m4a)$/i;

/**
 * The comparable form of a path. `path.resolve` preserves whatever drive-letter and folder
 * case it was handed, and this project is launched from git-bash, PowerShell and Task
 * Scheduler in turn -- so on Windows two spellings of the same file would otherwise miss
 * each other in a Set. Here that matters in the deleting direction: a protected path that
 * fails to match is a file still recorded on a song being deleted anyway.
 */
function pathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function allowedRoots(): string[] {
  return [pathKey(config.downloadDir), pathKey(config.outputDir)];
}

/**
 * Deletion is confined to DOWNLOAD_DIR and OUTPUT_DIR. The download directory can be
 * shared with unrelated files, so only paths the database recorded and names matching this
 * pipeline's own download pattern are ever deleted there -- and both are checked for
 * containment.
 */
function isInsideAllowedRoots(key: string): boolean {
  return allowedRoots().some((root) => key === root || key.startsWith(root + path.sep));
}

function tryUnlink(filePath: string, protectedPaths: Set<string>): { deleted: boolean; bytes: number } {
  const key = pathKey(filePath);
  if (!isInsideAllowedRoots(key) || protectedPaths.has(key)) return { deleted: false, bytes: 0 };
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { deleted: false, bytes: 0 };
    fs.rmSync(filePath);
    return { deleted: true, bytes: stat.size };
  } catch {
    // Already gone (e.g. a manual disk cleanup) or unreadable -- either way not ours to count.
    return { deleted: false, bytes: 0 };
  }
}

/** Directory entries, or nothing when the folder is absent or unreadable. */
function safeReaddir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
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

/** Every path any song row still points at, whatever its status. */
function recordedPaths(): Set<string> {
  const out = new Set<string>();
  for (const song of songsByStatus([...ALL_STATUSES])) {
    for (const p of [...parseJsonPaths(song.cafe_audio_path), ...parseJsonPaths(song.cafe_video_path)]) {
      out.add(pathKey(p));
    }
  }
  return out;
}

/**
 * A Suno download that arrived but never made it into a song row -- the generation threw
 * between `saveAs` and `saveAudio`, or an earlier attempt wrote a different extension for
 * the same clip. Those files are invisible to the path-based cleanup above and would sit in
 * DOWNLOAD_DIR forever, which on ten runs a day is tens of gigabytes.
 *
 * Only the top level is scanned, and only names matching Step 3's own pattern that no row
 * references.
 */
function sweepOrphanDownloads(): { deletedFiles: number; freedBytes: number } {
  const root = path.resolve(config.downloadDir);
  const referenced = recordedPaths();
  let deletedFiles = 0;
  let freedBytes = 0;

  for (const entry of safeReaddir(root)) {
    if (!entry.isFile() || !DOWNLOAD_NAME_PATTERN.test(entry.name)) continue;
    const result = tryUnlink(path.join(root, entry.name), referenced);
    if (result.deleted) {
      deletedFiles += 1;
      freedBytes += result.bytes;
      runLogger.info(`Cleanup: removed unreferenced download ${entry.name}`);
    }
  }

  return { deletedFiles, freedBytes };
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
 * Once a run has finished successfully, the audio the pipeline downloaded and the videos
 * it rendered are consumed -- the uploaded result lives on YouTube -- so they only occupy
 * disk on a machine where disk is the binding constraint.
 *
 * Called at two moments, with identical behaviour because both look at the newest run row:
 * before a firing starts (tidying whatever the last one left) and, with
 * `CLEANUP_AFTER_EACH_RUN`, straight after each video of the daily loop uploads -- which is
 * the only way ten sessions fit through one disk in a day.
 *
 * Deleted, in this order:
 *   1. every file recorded on a DONE song (input .wav/.mp3 downloads and per-track
 *      .mp4 clips) -- DB-recorded paths only, because DOWNLOAD_DIR can be shared;
 *   2. media files inside every `run_*` folder (normalised wavs, per-track clips, the
 *      `_uniform` re-encodes, the merged master), keeping logs and tracklists for the
 *      paper trail;
 *   3. with `CLEANUP_ORPHAN_DOWNLOADS`, downloads in DOWNLOAD_DIR that match Step 3's own
 *      naming but that no song row points at.
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
    return { deletedFiles: 0, freedBytes: 0, prunedDirs: 0, orphanFiles: 0, skippedReason: 'no previous run on record' };
  }
  if (latest.status !== 'SUCCESS' && latest.status !== 'PARTIAL') {
    return {
      deletedFiles: 0,
      freedBytes: 0,
      prunedDirs: 0,
      orphanFiles: 0,
      skippedReason: `run ${latest.id} finished ${latest.status}; artifacts kept for resume/carry-over`,
    };
  }

  const protectedPaths = new Set<string>();
  for (const song of songsByStatus([...PROTECTED_STATUSES])) {
    for (const p of [...parseJsonPaths(song.cafe_audio_path), ...parseJsonPaths(song.cafe_video_path)]) {
      protectedPaths.add(pathKey(p));
    }
  }

  let deletedFiles = 0;
  let freedBytes = 0;

  // 1. Consumed per-song artifacts, by DB-recorded path.
  for (const song of songsByStatus(['DONE'])) {
    for (const p of [...parseJsonPaths(song.cafe_audio_path), ...parseJsonPaths(song.cafe_video_path)]) {
      const result = tryUnlink(p, protectedPaths);
      if (result.deleted) {
        deletedFiles += 1;
        freedBytes += result.bytes;
      }
    }
  }

  // 2. Media inside *every* run folder, not only the folders of runs that finished.
  //
  //    The status gate above already established that the newest run uploaded, and that is
  //    what makes the whole tree disposable: the one unrecorded file a later run can still
  //    need is the `final_*.mp4` of a run that failed at Step 6, and findStep6Resume only
  //    ever looks at previousRun() -- which is now this SUCCESS/PARTIAL run, never that one
  //    again. Recorded clips of carry-over songs are held by protectedPaths.
  //
  //    Sweeping by directory rather than by recorded merged_video_path is what reaches the
  //    folders of runs that failed *before* Step 5: those have no merged_video_path at all,
  //    so their normalised wavs, half-rendered clips and `_uniform` re-encodes -- every one
  //    of them regenerated from scratch by the next run -- were previously never deleted.
  const outputRoot = path.resolve(config.outputDir);
  for (const entry of safeReaddir(outputRoot)) {
    if (!entry.isDirectory() || !entry.name.startsWith('run_')) continue;

    for (const file of listFilesRecursively(path.join(outputRoot, entry.name))) {
      if (!MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
      const result = tryUnlink(file, protectedPaths);
      if (result.deleted) {
        deletedFiles += 1;
        freedBytes += result.bytes;
      }
    }
  }

  // 3. Downloads nothing points at any more.
  let orphanFiles = 0;
  if (config.cleanupOrphanDownloads) {
    const orphans = sweepOrphanDownloads();
    orphanFiles = orphans.deletedFiles;
    deletedFiles += orphans.deletedFiles;
    freedBytes += orphans.freedBytes;
  }

  const prunedDirs = fs.existsSync(outputRoot) ? pruneEmptyDirs(outputRoot) : 0;

  return { deletedFiles, freedBytes, prunedDirs, orphanFiles, skippedReason: null };
}

/**
 * `warnIfLittleFreed` is for the post-run call: a session that really uploaded two hours of
 * video had tens of gigabytes to give back, so a near-zero figure means the deletes were
 * refused. On Windows that is almost always a file still held open by ffmpeg, Mjudio or
 * Chromium -- `tryUnlink` swallows the error, and without this line the only symptom would
 * be tomorrow's pre-flight failing on free space.
 */
export function logCleanupSummary(
  summary: CleanupSummary,
  options: { phase?: string; warnIfLittleFreed?: boolean } = {},
): void {
  const phase = options.phase ?? 'Cleanup';

  if (summary.skippedReason) {
    runLogger.info(`${phase} skipped: ${summary.skippedReason}`);
    return;
  }

  const freedGb = summary.freedBytes / 1024 ** 3;
  runLogger.info(
    `${phase}: deleted ${summary.deletedFiles} consumed file(s)` +
      `${summary.orphanFiles > 0 ? ` (${summary.orphanFiles} unreferenced download(s))` : ''}, ` +
      `freed ${freedGb.toFixed(2)} GB, pruned ${summary.prunedDirs} empty folder(s)`,
  );

  if (options.warnIfLittleFreed && freedGb < 1) {
    runLogger.warn(
      `${phase} freed only ${freedGb.toFixed(2)} GB after a finished run — the files are most likely ` +
        'still locked by ffmpeg, Mjudio or Chromium. The next cleanup retries them; if free space keeps ' +
        'falling, close those processes between runs.',
    );
  }
}
