import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { explainAccessError } from './folderAccess.js';

export interface RunFolder {
  root: string;
  audio: string;
  video: string;
  final: string;
  logs: string;
  /** YYYYMMDD, used for final_YYYYMMDD.mp4 */
  dateStamp: string;
  /** YYYY-MM-DD, used for pipeline_run.run_date */
  runDate: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function stampFor(date = new Date()): { dateStamp: string; runDate: string; folderStamp: string } {
  const dateStamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return {
    dateStamp,
    runDate: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    folderStamp: `${dateStamp}_${pad(date.getHours())}${pad(date.getMinutes())}`,
  };
}

/** The folder record for a run root that already exists on disk. */
export function runFolderForRoot(root: string, dateStamp: string): RunFolder {
  return {
    root,
    audio: path.join(root, 'audio'),
    video: path.join(root, 'video'),
    final: path.join(root, 'final'),
    logs: path.join(root, 'logs'),
    dateStamp,
    runDate: `${dateStamp.slice(0, 4)}-${dateStamp.slice(4, 6)}-${dateStamp.slice(6, 8)}`,
  };
}

export function createRunFolder(date = new Date()): RunFolder {
  const { dateStamp, runDate, folderStamp } = stampFor(date);

  // The stamp only resolves to the minute, and the daily loop starts several runs a day --
  // two of them land in the same minute as soon as one fails fast. Sharing a folder would
  // let the second run's merge overwrite `final_YYYYMMDD.mp4` while the first one is still
  // the file its own Step 6 resume needs, so a taken name gets a suffix.
  let root = path.join(config.outputDir, `run_${folderStamp}`);
  for (let suffix = 2; fs.existsSync(root); suffix += 1) {
    root = path.join(config.outputDir, `run_${folderStamp}_${suffix}`);
  }

  const folder: RunFolder = { ...runFolderForRoot(root, dateStamp), runDate };
  try {
    for (const dir of [folder.root, folder.audio, folder.video, folder.final, folder.logs]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (error) {
    throw explainAccessError(error, 'OUTPUT_DIR', config.outputDir);
  }
  return folder;
}

/**
 * The run folder around one specific merged video recorded by an earlier run, or null when
 * that file is gone.
 *
 * This is what a Step 6 resume must use rather than "today's merged file": a day that
 * produces ten videos leaves ten `final_YYYYMMDD.mp4` files behind, and a loop that runs
 * past midnight dates them differently from the run resuming them.
 */
export function finalVideoAt(videoPath: string): { videoPath: string; folder: RunFolder } | null {
  const match = /^final_(\d{8})\.mp4$/i.exec(path.basename(videoPath));
  if (!match) return null;
  try {
    if (fs.statSync(videoPath).size === 0) return null;
  } catch {
    return null;
  }
  return { videoPath, folder: runFolderForRoot(path.dirname(path.dirname(videoPath)), match[1] as string) };
}

/**
 * Step 6 resume: a run that failed at upload left `final_YYYYMMDD.mp4` on disk, and
 * regenerating two hours of audio to reproduce it would be pure waste. Look for
 * today's merged file in the most recent run folders.
 */
export function findExistingFinalVideo(dateStamp: string): { videoPath: string; folder: RunFolder } | null {
  if (!fs.existsSync(config.outputDir)) return null;

  const candidates = fs
    .readdirSync(config.outputDir)
    .filter((name) => name.startsWith(`run_${dateStamp}`))
    .sort()
    .reverse();

  for (const name of candidates) {
    const root = path.join(config.outputDir, name);
    const videoPath = path.join(root, 'final', `final_${dateStamp}.mp4`);
    const found = finalVideoAt(videoPath);
    if (found) return found;
  }
  return null;
}
