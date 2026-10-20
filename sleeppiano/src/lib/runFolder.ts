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

export function createRunFolder(date = new Date()): RunFolder {
  const { dateStamp, runDate, folderStamp } = stampFor(date);
  const root = path.join(config.outputDir, `run_${folderStamp}`);
  const folder: RunFolder = {
    root,
    audio: path.join(root, 'audio'),
    video: path.join(root, 'video'),
    final: path.join(root, 'final'),
    logs: path.join(root, 'logs'),
    dateStamp,
    runDate,
  };
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
    if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0) {
      return {
        videoPath,
        folder: {
          root,
          audio: path.join(root, 'audio'),
          video: path.join(root, 'video'),
          final: path.join(root, 'final'),
          logs: path.join(root, 'logs'),
          dateStamp,
          runDate: `${dateStamp.slice(0, 4)}-${dateStamp.slice(4, 6)}-${dateStamp.slice(6, 8)}`,
        },
      };
    }
  }
  return null;
}
