import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../lib/config.js';
import { activeRun, failStaleRuns, latestRun, migrate, resetPipelineState, statusCounts } from '../lib/db.js';
import { runLogger, type LogLine } from '../lib/logger.js';
import { preflight } from '../lib/preflight.js';
import { currentProgress, isRunning, resetProgress, startRun } from '../pipeline/orchestrator.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(path.join(HERE, 'public')));

/** POST /api/pipeline/run — the home page button. 409 while a run is in progress. */
app.post('/api/pipeline/run', (_req, res) => {
  const active = activeRun();
  if (isRunning() || active) {
    res.status(409).json({
      error: 'already_running',
      message: 'Pipeline is already running',
      runId: active?.id ?? currentProgress().runId,
    });
    return;
  }

  try {
    const { runId } = startRun();
    res.status(202).json({ runId });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    runLogger.error(`Could not start a run: ${detail}`);
    res.status(500).json({ error: 'start_failed', message: detail });
  }
});

/**
 * POST /api/pipeline/resume — the "Resume" button: a run that first moves every ERROR song
 * back to the furthest step its files on disk justify (see requeueErroredSongs).
 *
 * Everything else a failed run leaves behind -- GENERATED/CONVERTED songs, a merged file
 * that failed to upload -- is already picked up by any run. ERROR songs are the one thing
 * that otherwise waits for RETRY_ERRORS in .env, and after a Mjudio crash they can hold
 * hours of paid-for Suno audio.
 */
app.post('/api/pipeline/resume', (_req, res) => {
  // Same guard as /run, deliberately without failStaleRuns(): the page disables the button
  // whenever status reports a run, and the 10 h age backstop in failStaleRuns() could mark
  // a live run in another process FAILED and start a second pipeline next to it.
  const active = activeRun();
  if (isRunning() || active) {
    res.status(409).json({
      error: 'already_running',
      message: 'Pipeline is already running',
      runId: active?.id ?? currentProgress().runId,
    });
    return;
  }

  const failedSongs = statusCounts().ERROR ?? 0;
  if (failedSongs === 0 && latestRun()?.status !== 'FAILED') {
    res.status(409).json({
      error: 'nothing_to_resume',
      message: 'Nothing to resume: no song is at ERROR and the last run did not fail',
    });
    return;
  }

  try {
    const { runId } = startRun({ retryErrors: true });
    res.status(202).json({ runId, failedSongs });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    runLogger.error(`Could not start a resume run: ${detail}`);
    res.status(500).json({ error: 'start_failed', message: detail });
  }
});

/** POST /api/pipeline/reset — put the pipeline back to a first-run state. */
app.post('/api/pipeline/reset', (_req, res) => {
  // Guarded on isRunning() alone, deliberately. A stale RUNNING row left by a crash with
  // nothing actually in flight is exactly what reset has to clear, so checking activeRun()
  // here would let the wedge block its own fix.
  if (isRunning()) {
    res.status(409).json({
      error: 'already_running',
      message: 'Cannot reset while a run is in progress',
      runId: currentProgress().runId,
    });
    return;
  }

  try {
    const { songsReset, runsCleared } = resetPipelineState();
    resetProgress();
    runLogger.setStep('IDLE');
    runLogger.info(
      `Reset: ${songsReset} song(s) back to INIT, ${runsCleared} run record(s) cleared. ` +
        'DONE songs and files already written to the output folder were kept.',
    );
    res.json({ songsReset, runsCleared });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    runLogger.error(`Could not reset the pipeline: ${detail}`);
    res.status(500).json({ error: 'reset_failed', message: detail });
  }
});

/** GET /api/pipeline/status — the current run row plus the per-step counters. */
app.get('/api/pipeline/status', (_req, res) => {
  const run = activeRun() ?? latestRun() ?? null;
  res.json({
    running: isRunning() || !!activeRun(),
    run,
    progress: currentProgress(),
    songStatusCounts: statusCounts(),
    config: {
      targetMinutes: config.dailyTargetMinutes,
      maxSongsPerRun: config.maxSongsPerRun,
      visibility: config.visibility,
      model: config.openaiModel,
      headless: config.headless,
    },
  });
});

/** GET /api/pipeline/logs — SSE stream of log lines. */
app.get('/api/pipeline/logs', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  for (const line of runLogger.recent(300)) {
    res.write(`data: ${JSON.stringify(line)}\n\n`);
  }

  const onLine = (line: LogLine): void => {
    res.write(`data: ${JSON.stringify(line)}\n\n`);
  };
  runLogger.on('line', onLine);

  // Comment frames keep proxies and idle timeouts from closing the stream.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    runLogger.off('line', onLine);
    res.end();
  });
});

/** GET /api/pipeline/preflight — run the checks without starting a run. */
app.get('/api/pipeline/preflight', async (_req, res) => {
  try {
    res.json({ checks: await preflight() });
  } catch (error) {
    res.status(500).json({ error: 'preflight_failed', message: error instanceof Error ? error.message : String(error) });
  }
});

function start(): void {
  migrate();

  // A crash leaves a run row at RUNNING, which would 409 every future click.
  const stale = failStaleRuns();
  if (stale > 0) runLogger.warn(`Marked ${stale} interrupted run(s) as FAILED on startup`);

  app.listen(config.port, '127.0.0.1', () => {
    runLogger.info(`VietCafe Pipeline listening on http://localhost:${config.port}`);
    runLogger.info(`DB: ${config.dbPath}`);
    runLogger.info(`Output: ${config.outputDir}`);
  });
}

start();
