/**
 * Headless daily entry point, invoked by Task Scheduler / launchd (see
 * scripts/run_daily.ps1 and scripts/run_daily.sh):
 *
 *   1. migrate + clear crash-stale RUNNING rows (judged by owner-pid liveness,
 *      with a STALE_RUN_HOURS age backstop);
 *   2. reconcile song statuses against the files actually on disk;
 *   3. delete the previous session's consumed artifacts -- only if it succeeded;
 *   4. produce up to DAILY_VIDEO_TARGET videos, one after another. Each is a complete
 *      independent run with its own STEP1-6 and its own YouTube upload, started through the
 *      web server when one is already listening (e.g. `npm start` left running since
 *      yesterday -- no second process is spawned, the existing one is triggered over HTTP),
 *      otherwise in-process via the same orchestrator; and waited for either way. As soon as
 *      a video has uploaded, that session's artifacts are deleted again (step 3's logic,
 *      applied to the run that just finished) -- ten sessions of wavs, per-track clips and
 *      2-hour masters do not fit on this disk at once.
 *
 * The loop stops early on three conditions, so a bad day costs one failure instead of ten:
 * LOOP_STOP_AFTER_FAILURES consecutive FAILED runs, the LOOP_MAX_HOURS wall-clock budget, or
 * the target being reached.
 *
 * `--prepare-only` performs 1-3 and exits without starting a run, for a safe manual
 * check of what the scheduled job would do to the database. `--videos=N` overrides
 * DAILY_VIDEO_TARGET for one invocation -- `--videos=1` is the old single-video behaviour,
 * and the right way to supervise the first run after a change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../lib/config.js';
import {
  activeRun,
  failStaleRuns,
  getRun,
  migrate,
  pidAlive,
  reconcileArtifacts,
  STALE_RUN_HOURS,
  type RunStatus,
} from '../lib/db.js';
import { runLogger } from '../lib/logger.js';
import { stampFor } from '../lib/runFolder.js';
import { startRun } from '../pipeline/orchestrator.js';
import { cleanupConsumedArtifacts, logCleanupSummary } from './cleanup.js';

const POLL_MS = 15_000;

const SERVER_BASE = `http://127.0.0.1:${config.port}`;

/** How one iteration of the daily loop ended. `lost` and `not_started` count as failures. */
type IterationOutcome = RunStatus | 'lost' | 'not_started';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Ask the existing server to start the next run. */
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
async function waitForRun(runId: number): Promise<IterationOutcome> {
  const deadline = Date.now() + STALE_RUN_HOURS * 3_600_000;

  while (Date.now() < deadline) {
    const run = getRun(runId);
    if (!run) {
      runLogger.error(`Run ${runId} disappeared from pipeline_run`);
      return 'lost';
    }
    if (run.status !== 'RUNNING') {
      runLogger.info(`Run ${runId} ended ${run.status}${run.youtube_url ? ` — ${run.youtube_url}` : ''}`);
      return run.status;
    }
    // pid null = a row written by pre-pid code: rely on the status and the deadline.
    if (pidAlive(run.pid) === false) {
      runLogger.error(`The process owning run ${runId} died mid-run; the next scheduled firing will mark it FAILED`);
      return 'lost';
    }
    await sleep(POLL_MS);
  }

  runLogger.error(`Run ${runId} was still RUNNING after ${STALE_RUN_HOURS} h — giving up on waiting`);
  return 'lost';
}

/**
 * Start one video, and return the id of the run to watch.
 *
 * A server left running since yesterday keeps ownership: the run is triggered there instead
 * of spawning a second process against the same database.
 */
async function startOneVideo(): Promise<number | null> {
  if (await serverListening()) {
    runLogger.info(`A server is listening on port ${config.port} — triggering the run there`);
    const outcome = await triggerRunOnServer();

    if (typeof outcome === 'number') return outcome;

    if (outcome === 'busy') {
      // Somebody pressed the button on the home page between iterations. That run produces a
      // video just as well as ours would, so adopt it rather than queueing a second one.
      const adopted = activeRun()?.id ?? null;
      if (adopted !== null) {
        runLogger.info(`The server reports run ${adopted} already in progress — waiting for that one`);
        return adopted;
      }
      return null;
    }

    // The POST may have landed despite the error/timeout; adopt the run if a row appeared.
    await sleep(5000);
    const adopted = activeRun()?.id ?? null;
    if (adopted !== null) return adopted;

    runLogger.warn('Could not trigger the existing server — falling back to an in-process run');
  }

  return startRun().runId;
}

/** One iteration of the daily loop: one run, from start to a terminal status. */
async function runOneVideo(label: string): Promise<IterationOutcome> {
  const cleared = failStaleRuns();
  if (cleared > 0) runLogger.warn(`Marked ${cleared} crashed run(s) FAILED`);

  // Nothing must start a second pipeline against the same database, browser profiles and
  // Suno account; an unexpected live run is waited on instead.
  const existing = activeRun();
  if (existing) {
    runLogger.info(`${label}: run ${existing.id} is already in flight (owner pid ${existing.pid ?? 'unknown'}) — waiting for it`);
    return waitForRun(existing.id);
  }

  const runId = await startOneVideo();
  if (runId === null) {
    runLogger.error(`${label}: no run could be started`);
    return 'not_started';
  }

  runLogger.info(`${label}: run ${runId} started — waiting for it to finish`);
  return waitForRun(runId);
}

/** `--videos=N` overrides DAILY_VIDEO_TARGET for one invocation. */
function resolveVideoTarget(): number {
  const flag = process.argv.find((arg) => arg.startsWith('--videos='));
  const raw = flag ? flag.slice('--videos='.length) : String(config.dailyVideoTarget);
  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < 1) {
    runLogger.warn(`Video target "${raw}" is not a positive number — producing 1 video`);
    return 1;
  }
  return Math.floor(parsed);
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
  const videoTarget = resolveVideoTarget();

  // One file for the whole firing. The per-run logs live in each run folder, but the loop's
  // own lines fall between runs, and Task Scheduler keeps no stdout.
  runLogger.attachJobFile(path.join(config.projectRoot, 'logs', `daily_${stampFor().runDate}.log`));

  runLogger.setStep('DAILY');
  runLogger.info(
    `Daily job started${prepareOnly ? ' (prepare-only)' : ` — up to ${videoTarget} video(s) today`} — DB ${config.dbPath}`,
  );

  migrate();

  if (anotherRunInFlight()) {
    // Benign: the overlap resolves by itself when the live run finishes.
    return;
  }

  const demoted = reconcileArtifacts();
  if (demoted > 0) runLogger.warn(`Reconcile: ${demoted} song(s) moved back to match the files on disk`);

  logCleanupSummary(cleanupConsumedArtifacts(), { phase: 'Pre-run cleanup' });

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

  const startedAt = Date.now();
  const loopDeadline = startedAt + Math.max(1, config.loopMaxHours) * 3_600_000;
  const cooldownMs = Math.max(0, config.loopCooldownMinutes) * 60_000;
  const failureLimit = Math.max(1, Math.floor(config.loopStopAfterFailures));

  let uploaded = 0;
  let failedRuns = 0;
  let consecutiveFailures = 0;
  let attempted = 0;

  for (let index = 1; index <= videoTarget; index += 1) {
    const label = `Video ${index}/${videoTarget}`;
    attempted = index;
    runLogger.setStep('DAILY');

    const outcome = await runOneVideo(label);

    // The run's own logger left the step at STEP6/DONE/FAILED; the loop's lines are the
    // daily job's again.
    runLogger.setStep('DAILY');

    if (outcome === 'SUCCESS' || outcome === 'PARTIAL') {
      uploaded += 1;
      consecutiveFailures = 0;
      runLogger.info(`${label}: ${outcome} — ${uploaded} video(s) uploaded so far today`);
    } else {
      failedRuns += 1;
      consecutiveFailures += 1;
      runLogger.warn(`${label}: ${outcome} — ${consecutiveFailures} consecutive failure(s)`);
    }

    // The point of the loop's cleanup: a finished session's downloads, per-track clips and
    // 2-hour master go now, not at tomorrow's firing. A failed session keeps everything --
    // cleanupConsumedArtifacts() makes that call itself, from the run's own status.
    if (config.cleanupAfterEachRun) {
      logCleanupSummary(cleanupConsumedArtifacts(), {
        phase: `Post-run cleanup after ${label.toLowerCase()}`,
        warnIfLittleFreed: outcome === 'SUCCESS' || outcome === 'PARTIAL',
      });
    }

    if (consecutiveFailures >= failureLimit) {
      runLogger.error(
        `Stopping the day after ${consecutiveFailures} consecutive failure(s): whatever the cause — songs, ` +
          'Suno credits, Mjudio exports, disk, a signed-out profile — it repeats, and each remaining video ' +
          'would spend an hour of browser work failing the same way. See the run logs above.',
      );
      break;
    }

    if (index >= videoTarget) break;

    if (Date.now() + cooldownMs >= loopDeadline) {
      runLogger.warn(
        `Stopping after ${index} of ${videoTarget} video(s): the ${config.loopMaxHours} h budget for one firing ` +
          'is spent. The songs already prompted keep their prompts, so tomorrow\'s firing continues from here.',
      );
      break;
    }

    if (cooldownMs > 0) {
      runLogger.info(`Cooling down ${config.loopCooldownMinutes} min before video ${index + 1}/${videoTarget}`);
      await sleep(cooldownMs);
    }

    // Insurance for a loop that runs for the better part of a day: the owner clears disk by
    // hand mid-loop often enough that the next iteration should not trust yesterday's paths.
    const redemoted = reconcileArtifacts();
    if (redemoted > 0) runLogger.warn(`Reconcile: ${redemoted} song(s) moved back to match the files on disk`);
  }

  const hours = (Date.now() - startedAt) / 3_600_000;
  runLogger.setStep('DAILY');
  runLogger.info(
    `Daily job finished in ${hours.toFixed(1)} h: ${uploaded} video(s) uploaded, ${failedRuns} run(s) failed, ` +
      `${attempted} of ${videoTarget} attempted`,
  );

  process.exitCode = uploaded > 0 ? 0 : 1;
}

await main();
