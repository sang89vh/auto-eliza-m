/**
 * Headless daily entry point, invoked by launchd (see scripts/run_daily.sh):
 *
 *   1. migrate + clear crash-stale RUNNING rows (judged by owner-pid liveness,
 *      with a STALE_RUN_HOURS age backstop);
 *   2. reconcile song statuses against the files actually on disk;
 *   3. delete the previous session's consumed artifacts -- only if it succeeded;
 *   4. start today's run: through the web server when one is already listening
 *      (e.g. `npm start` left running since yesterday -- no second process is
 *      spawned, the existing one is triggered over HTTP), otherwise in-process
 *      via the same orchestrator; then wait for the run to finish either way.
 *
 * `--prepare-only` performs 1-3 and exits without starting a run, for a safe manual
 * check of what the scheduled job would do to the database.
 */
import fs from 'node:fs';
import { config } from '../lib/config.js';
import {
  activeRun,
  db,
  failStaleRuns,
  getRun,
  migrate,
  nowIso,
  parseJsonPaths,
  pidAlive,
  songsByStatus,
  STALE_RUN_HOURS,
} from '../lib/db.js';
import { runLogger } from '../lib/logger.js';
import { startRun } from '../pipeline/orchestrator.js';
import { cleanupConsumedArtifacts, logCleanupSummary } from './cleanup.js';

const POLL_MS = 15_000;

const SERVER_BASE = `http://127.0.0.1:${config.port}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A manual disk cleanup (this machine runs chronically full) can delete files the
 * database still points at. A status is only meaningful while its artifacts exist,
 * so each GENERATED/CONVERTED song is moved back to the furthest status its
 * surviving files justify -- otherwise the next run would carry over ghosts and
 * fail at merge with nothing to merge.
 */
function reconcileArtifacts(): number {
  const database = db();
  let demoted = 0;

  for (const song of songsByStatus(['GENERATED', 'CONVERTED'])) {
    const audioPaths = parseJsonPaths(song.piano_audio_path);
    const videoPaths = parseJsonPaths(song.piano_video_path);
    const audioOk = audioPaths.length > 0 && audioPaths.every((p) => fs.existsSync(p));
    const videoOk = videoPaths.length > 0 && videoPaths.every((p) => fs.existsSync(p));

    if (song.piano_status === 'CONVERTED' && videoOk) continue;
    if (song.piano_status === 'GENERATED' && audioOk) continue;

    if (audioOk) {
      // The clips are gone but the audio survived: Step 4 can re-render.
      database
        .prepare(
          `UPDATE my_song
              SET piano_status = 'GENERATED', piano_video_path = NULL, piano_updated_at = ?
            WHERE id = ?`,
        )
        .run(nowIso(), song.id);
      runLogger.warn(`Reconcile: song ${song.id} ${song.piano_status} -> GENERATED (video file(s) missing)`);
    } else if (song.piano_prompt1) {
      // Audio gone too; the prompts in the DB are still paid-for work.
      database
        .prepare(
          `UPDATE my_song
              SET piano_status = 'PROMPTED', piano_audio_path = NULL, piano_video_path = NULL,
                  piano_duration_sec = NULL, piano_updated_at = ?
            WHERE id = ?`,
        )
        .run(nowIso(), song.id);
      runLogger.warn(`Reconcile: song ${song.id} ${song.piano_status} -> PROMPTED (audio file(s) missing)`);
    } else {
      database
        .prepare(
          `UPDATE my_song
              SET piano_status = 'INIT', piano_audio_path = NULL, piano_video_path = NULL,
                  piano_duration_sec = NULL, piano_updated_at = ?
            WHERE id = ?`,
        )
        .run(nowIso(), song.id);
      runLogger.warn(`Reconcile: song ${song.id} ${song.piano_status} -> INIT (artifacts and prompts missing)`);
    }
    demoted += 1;
  }

  return demoted;
}

/**
 * True when a run is genuinely in flight -- its owning process is alive. Crash
 * leftovers are cleared first as a side effect (dead pid, or the age backstop for
 * pid-less/pid-reused rows), so a wedged row never blocks the daily cadence.
 */
function anotherRunInFlight(): boolean {
  const cleared = failStaleRuns();
  if (cleared > 0) runLogger.warn(`Marked ${cleared} crashed run(s) FAILED`);

  const active = activeRun();
  if (!active) return false;
  runLogger.info(
    `Run ${active.id} is already in progress (owner pid ${active.pid ?? 'unknown'}) — not starting another`,
  );
  return true;
}

/** Is a pipeline server (yesterday's `npm start`, for instance) already listening? */
async function serverListening(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_BASE}/api/pipeline/status`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Ask the existing server to start today's run. */
async function triggerRunOnServer(): Promise<number | 'busy' | null> {
  try {
    const response = await fetch(`${SERVER_BASE}/api/pipeline/run`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 202) {
      const body = (await response.json()) as { runId?: number };
      return typeof body.runId === 'number' ? body.runId : null;
    }
    if (response.status === 409) return 'busy';
    runLogger.warn(`The existing server refused to start a run: HTTP ${response.status}`);
    return null;
  } catch (error) {
    runLogger.warn(`Could not reach the existing server: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Wait until the run row leaves RUNNING, whichever process owns it. The DB is the
 * shared truth, so this works identically for an in-process run and one triggered
 * on the web server.
 */
async function waitForRun(runId: number): Promise<void> {
  const deadline = Date.now() + STALE_RUN_HOURS * 3_600_000;

  while (Date.now() < deadline) {
    const run = getRun(runId);
    if (!run) {
      runLogger.error(`Run ${runId} disappeared from pipeline_run`);
      process.exitCode = 1;
      return;
    }
    if (run.status !== 'RUNNING') {
      runLogger.info(
        `Daily job finished: run ${runId} ended ${run.status}${run.youtube_url ? ` — ${run.youtube_url}` : ''}`,
      );
      process.exitCode = run.status === 'SUCCESS' || run.status === 'PARTIAL' ? 0 : 1;
      return;
    }
    // pid null = a row written by pre-pid code: rely on the status and the deadline.
    if (pidAlive(run.pid) === false) {
      runLogger.error(`The process owning run ${runId} died mid-run; the next scheduled firing will mark it FAILED`);
      process.exitCode = 1;
      return;
    }
    await sleep(POLL_MS);
  }

  runLogger.error(`Run ${runId} was still RUNNING after ${STALE_RUN_HOURS} h — giving up on waiting`);
  process.exitCode = 1;
}

function profileReady(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const prepareOnly = process.argv.includes('--prepare-only');
  runLogger.setStep('DAILY');
  runLogger.info(`Daily job started${prepareOnly ? ' (prepare-only)' : ''} — DB ${config.dbPath}`);

  migrate();

  if (anotherRunInFlight()) {
    // Benign: the overlap resolves by itself when the live run finishes.
    return;
  }

  const demoted = reconcileArtifacts();
  if (demoted > 0) runLogger.warn(`Reconcile: ${demoted} song(s) moved back to match the files on disk`);

  logCleanupSummary(cleanupConsumedArtifacts());

  const loginMissing = !profileReady(config.sunoProfileDir) || !profileReady(config.ytProfileDir);

  if (prepareOnly) {
    if (loginMissing) runLogger.warn('Note: browser profiles are missing — run `npm run setup:login` before the scheduled time');
    runLogger.info('Prepare-only: stopping before the pipeline start');
    return;
  }

  if (loginMissing) {
    runLogger.error(
      'Suno/YouTube browser profiles are missing or empty — run `npm run setup:login` once. ' +
        'Aborting before any step spends money.',
    );
    process.exitCode = 1;
    return;
  }

  // A server left running since yesterday keeps ownership: trigger the new day's
  // run there instead of spawning a second process against the same database.
  if (await serverListening()) {
    runLogger.info(`A server is already listening on port ${config.port} — triggering today's run there`);
    const outcome = await triggerRunOnServer();
    if (outcome === 'busy') {
      runLogger.info('The server reports a run already in progress — leaving it to finish');
      return;
    }
    let runId = typeof outcome === 'number' ? outcome : null;
    if (runId === null) {
      // The POST may have landed despite the error/timeout; adopt the run if a row appeared.
      await sleep(5000);
      runId = activeRun()?.id ?? null;
    }
    if (runId !== null) {
      await waitForRun(runId);
      return;
    }
    runLogger.warn('Could not trigger the existing server — falling back to an in-process run');
  }

  const { runId } = startRun();
  runLogger.info(`Run ${runId} started in-process by the daily job; waiting for it to finish`);
  await waitForRun(runId);
}

await main();
