import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { runLogger } from './logger.js';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(command: string, args: string[], timeoutMs = 30 * 60_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      // ffmpeg is verbose; keep only the tail so a long encode cannot eat memory.
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function runOrThrow(command: string, args: string[], timeoutMs?: number): Promise<CommandResult> {
  const result = await run(command, args, timeoutMs);
  if (result.code !== 0) {
    throw new Error(`${command} exited ${result.code}: ${result.stderr.trim().split('\n').slice(-6).join(' | ')}`);
  }
  return result;
}

export async function isOnPath(binary: string): Promise<boolean> {
  try {
    const result = await run(binary, ['-version'], 15_000);
    return result.code === 0;
  } catch {
    return false;
  }
}

export interface MediaInfo {
  durationSec: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  frameRate: number | null;
}

export async function probe(filePath: string): Promise<MediaInfo> {
  const result = await runOrThrow(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    120_000,
  );

  const parsed = JSON.parse(result.stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      duration?: string;
    }>;
  };

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');

  let durationSec = Number(parsed.format?.duration ?? NaN);
  if (!Number.isFinite(durationSec)) durationSec = Number(audio?.duration ?? video?.duration ?? NaN);

  let frameRate: number | null = null;
  if (video?.avg_frame_rate && video.avg_frame_rate !== '0/0') {
    const [numerator, denominator] = video.avg_frame_rate.split('/').map(Number);
    if (numerator && denominator) frameRate = numerator / denominator;
  }

  return {
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    width: video?.width ?? null,
    height: video?.height ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    frameRate,
  };
}

export async function probeDuration(filePath: string): Promise<number> {
  return (await probe(filePath)).durationSec;
}

/** Set by pickVideoEncoder(); h264_videotoolbox on Apple silicon, libx264 elsewhere. */
let cachedEncoder: string | null = null;

export async function pickVideoEncoder(): Promise<string> {
  if (cachedEncoder) return cachedEncoder;
  const result = await run('ffmpeg', ['-hide_banner', '-encoders'], 30_000);
  cachedEncoder = result.stdout.includes('h264_videotoolbox') ? 'h264_videotoolbox' : 'libx264';
  return cachedEncoder;
}

interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/**
 * Two-pass EBU R128 normalisation to the configured target (-14 LUFS by default).
 *
 * This runs on the audio *before* it becomes video, which is the simpler of the two
 * options the PRD allows: normalising after the merge would mean re-encoding the
 * audio of a finished 2-hour file, and normalising per-track keeps every track
 * independently correct rather than letting one loud track pull the whole mix.
 */
export async function normalizeLoudness(inputPath: string, outputPath: string): Promise<void> {
  const target = config.loudnormTargetLufs;
  const filterBase = `loudnorm=I=${target}:TP=-1.5:LRA=11`;

  const analysis = await runOrThrow(
    'ffmpeg',
    ['-hide_banner', '-nostdin', '-i', inputPath, '-af', `${filterBase}:print_format=json`, '-f', 'null', '-'],
    20 * 60_000,
  );

  // loudnorm prints its JSON block at the very end of stderr.
  const jsonStart = analysis.stderr.lastIndexOf('{');
  const jsonEnd = analysis.stderr.lastIndexOf('}');
  let measured: LoudnormMeasurement | null = null;
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      measured = JSON.parse(analysis.stderr.slice(jsonStart, jsonEnd + 1)) as LoudnormMeasurement;
    } catch {
      measured = null;
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const secondPassFilter = measured
    ? `${filterBase}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
      `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
      `:offset=${measured.target_offset}:linear=true:print_format=summary`
    : `${filterBase}:print_format=summary`;

  if (!measured) {
    runLogger.warn(`loudnorm analysis could not be parsed for ${path.basename(inputPath)}; falling back to single-pass`);
  }

  await runOrThrow(
    'ffmpeg',
    [
      '-hide_banner', '-nostdin', '-y',
      '-i', inputPath,
      '-af', secondPassFilter,
      '-ar', '48000',
      '-ac', '2',
      '-c:a', 'pcm_s16le',
      outputPath,
    ],
    20 * 60_000,
  );
}

/** Integrated loudness of a finished file, for the Step 5 validation log. */
export async function measureIntegratedLoudness(filePath: string): Promise<number | null> {
  try {
    const result = await run(
      'ffmpeg',
      ['-hide_banner', '-nostdin', '-i', filePath, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
      30 * 60_000,
    );
    const jsonStart = result.stderr.lastIndexOf('{');
    const jsonEnd = result.stderr.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd <= jsonStart) return null;
    const parsed = JSON.parse(result.stderr.slice(jsonStart, jsonEnd + 1)) as LoudnormMeasurement;
    const value = Number(parsed.input_i);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

const TARGET_WIDTH = 1920;
const TARGET_HEIGHT = 1080;

/**
 * The concat demuxer needs every input to share a stream layout. Mjudio exports are
 * already uniform, so this is normally a no-op that returns the original path.
 */
export async function ensureUniform(videoPath: string, workDir: string): Promise<string> {
  const info = await probe(videoPath);
  const alreadyUniform =
    info.width === TARGET_WIDTH &&
    info.height === TARGET_HEIGHT &&
    info.videoCodec === 'h264' &&
    info.audioCodec === 'aac';

  if (alreadyUniform) return videoPath;

  fs.mkdirSync(workDir, { recursive: true });
  const outputPath = path.join(workDir, `uniform_${path.basename(videoPath)}`);
  runLogger.info(
    `Re-encoding ${path.basename(videoPath)} to ${TARGET_WIDTH}x${TARGET_HEIGHT} h264/aac ` +
      `(was ${info.width}x${info.height} ${info.videoCodec}/${info.audioCodec})`,
  );

  const encoder = await pickVideoEncoder();
  await runOrThrow(
    'ffmpeg',
    [
      '-hide_banner', '-nostdin', '-y',
      '-i', videoPath,
      '-vf',
      `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
      '-r', '30',
      '-c:v', encoder,
      '-b:v', '4M',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart',
      outputPath,
    ],
    60 * 60_000,
  );

  return outputPath;
}

/**
 * Straight concatenation, no crossfade (PRD v1). The flags come from the project's
 * own merge template, shscript/merge_processed_videos.sh, which is the macOS
 * sibling of the eliza-story merge helper.
 */
export async function concatVideos(videoPaths: string[], outputPath: string, listFilePath: string): Promise<void> {
  if (videoPaths.length === 0) throw new Error('concatVideos called with no inputs');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(listFilePath), { recursive: true });

  // The concat demuxer treats a single quote as a terminator; escape it the way it expects.
  const listBody = videoPaths
    .map((videoPath) => `file '${path.resolve(videoPath).replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(listFilePath, `${listBody}\n`, 'utf8');

  const encoder = await pickVideoEncoder();
  await runOrThrow(
    'ffmpeg',
    [
      '-hide_banner', '-nostdin', '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listFilePath,
      '-c:v', encoder,
      '-b:v', '4M',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '320k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      '-vsync', '2',
      '-async', '1',
      '-max_muxing_queue_size', '1024',
      outputPath,
    ],
    4 * 60 * 60_000,
  );
}

/** Free space in GiB on the volume holding `targetPath`. */
export function freeSpaceGb(targetPath: string): number {
  let probePath = targetPath;
  while (!fs.existsSync(probePath) && path.dirname(probePath) !== probePath) {
    probePath = path.dirname(probePath);
  }
  const stats = fs.statfsSync(probePath);
  return (Number(stats.bavail) * Number(stats.bsize)) / 1024 ** 3;
}
