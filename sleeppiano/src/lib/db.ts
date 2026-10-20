import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { runLogger } from './logger.js';

export type PianoStatus = 'INIT' | 'PROMPTED' | 'GENERATED' | 'CONVERTED' | 'DONE' | 'ERROR';
export type RunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PARTIAL';
export type StepName = 'STEP0' | 'STEP1' | 'STEP2' | 'STEP3' | 'STEP4' | 'STEP5' | 'STEP6';

export interface SongRow {
  id: number;
  original_title: string;
  title: string | null;
  piano_title: string | null;
  piano_prompt1: string | null;
  piano_prompt2: string | null;
  piano_introduction: string | null;
  piano_status: PianoStatus | null;
  piano_audio_path: string | null;
  piano_video_path: string | null;
  piano_duration_sec: number | null;
}

export interface PipelineRunRow {
  id: number;
  run_date: string;
  status: RunStatus;
  current_step: string | null;
  songs_selected: number;
  tracks_generated: number;
  total_duration_sec: number;
  merged_video_path: string | null;
  youtube_url: string | null;
  error: string | null;
  /** Process that owns the run while RUNNING; null on rows written before this column existed. */
  pid: number | null;
  created_at: string | null;
  finished_at: string | null;
}

/**
 * `my_song.original_title` holds "Title - Artist" (e.g. "菊花台 - 周杰伦"); the schema
 * has no separate artist or composer column. Everything downstream that needs the
 * three-part OpenAI input, or the banned-substring check, goes through here.
 */
export interface ParsedSongName {
  songTitle: string;
  artist: string;
  composer: string;
  /** Every name the generated prompts must not contain. */
  bannedTerms: string[];
}

const SEPARATORS = [' – ', ' — ', ' - ', ' -', '- '];

export function parseSongName(originalTitle: string, fallbackTitle: string | null): ParsedSongName {
  const raw = (originalTitle ?? '').trim();
  let songTitle = raw;
  let artist = '';

  for (const separator of SEPARATORS) {
    const index = raw.indexOf(separator);
    if (index > 0) {
      songTitle = raw.slice(0, index).trim();
      artist = raw.slice(index + separator.length).trim();
      break;
    }
  }

  // Multi-artist rows use a slash, e.g. "今天你要嫁给我 - 陶喆/蔡依林".
  const artistParts = artist
    .split(/[/、,&]|feat\.|ft\./i)
    .map((part) => part.trim())
    .filter(Boolean);

  const bannedTerms = [songTitle, ...artistParts, fallbackTitle ?? '']
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);

  return {
    songTitle: songTitle || raw,
    artist: artist || 'Unknown',
    // The schema carries no composer, so the OpenAI input declares it unknown
    // rather than inventing one.
    composer: 'Unknown',
    bannedTerms: [...new Set(bannedTerms)],
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

let handle: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (!handle) {
    handle = new DatabaseSync(config.dbPath);
    handle.exec('PRAGMA journal_mode = WAL;');
    handle.exec('PRAGMA busy_timeout = 5000;');
  }
  return handle;
}

export function closeDb(): void {
  handle?.close();
  handle = null;
}

function columnNames(table: string): Set<string> {
  const rows = db().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

/** Adds only what is missing. Never drops or redefines an existing column. */
export function migrate(): void {
  const database = db();

  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='my_song'")
    .all();
  if (tables.length === 0) {
    throw new Error(`Table my_song not found in ${config.dbPath}`);
  }

  const wanted: Array<[string, string]> = [
    ['piano_title', 'TEXT'],
    ['piano_prompt1', 'TEXT'],
    ['piano_prompt2', 'TEXT'],
    ['piano_introduction', 'TEXT'],
    ['piano_status', "TEXT DEFAULT 'INIT'"],
    ['piano_audio_path', 'TEXT'],
    ['piano_video_path', 'TEXT'],
    ['piano_duration_sec', 'INTEGER'],
    ['piano_error', 'TEXT'],
    ['piano_updated_at', 'TEXT'],
  ];

  const existing = columnNames('my_song');
  for (const [name, type] of wanted) {
    if (!existing.has(name)) {
      database.exec(`ALTER TABLE my_song ADD COLUMN ${name} ${type}`);
      runLogger.info(`Migration: added my_song.${name}`);
    }
  }

  // The column pre-dates this project and has no DEFAULT, so normalise blanks
  // rather than relying on one.
  database.exec("UPDATE my_song SET piano_status = 'INIT' WHERE piano_status IS NULL OR TRIM(piano_status) = ''");

  database.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_run (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      run_date           TEXT NOT NULL,
      status             TEXT NOT NULL,
      current_step       TEXT,
      songs_selected     INTEGER DEFAULT 0,
      tracks_generated   INTEGER DEFAULT 0,
      total_duration_sec INTEGER DEFAULT 0,
      merged_video_path  TEXT,
      youtube_url        TEXT,
      error              TEXT,
      pid                INTEGER,
      created_at         TEXT,
      finished_at        TEXT
    )
  `);

  // Databases created before the pid column get it added in place.
  const runColumns = columnNames('pipeline_run');
  if (!runColumns.has('pid')) {
    database.exec('ALTER TABLE pipeline_run ADD COLUMN pid INTEGER');
    runLogger.info('Migration: added pipeline_run.pid');
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_my_song_piano_status ON my_song(piano_status)');
}

/** Hours after which a RUNNING row is stale even if its recorded pid looks alive (pid reuse). */
export const STALE_RUN_HOURS = 10;

/**
 * Is the process that owns a run still alive? Signal 0 probes without killing;
 * EPERM means "exists but not ours", which still counts as alive. Returns null for
 * rows written before the pid column existed -- unknown, so only the age backstop
 * applies to them.
 */
export function pidAlive(pid: number | null): boolean | null {
  if (!pid) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A crash leaves a run row at RUNNING, which would 409 every future click. A row is
 * stale when its owning process is dead, or -- as a backstop for pid reuse and for
 * pid-less legacy rows -- when it is older than STALE_RUN_HOURS. Genuinely live
 * runs survive, so a server (re)start no longer kills a scheduled run in flight.
 */
export function failStaleRuns(): number {
  const cutoffIso = new Date(Date.now() - STALE_RUN_HOURS * 3_600_000).toISOString();
  const running = db()
    .prepare("SELECT id, pid, created_at FROM pipeline_run WHERE status = 'RUNNING'")
    .all() as Array<{ id: number; pid: number | null; created_at: string | null }>;

  let changed = 0;
  for (const row of running) {
    const alive = pidAlive(row.pid);
    const tooOld = (row.created_at ?? '') < cutoffIso;
    if (alive !== false && !tooOld) continue;
    db()
      .prepare(
        `UPDATE pipeline_run
            SET status = 'FAILED',
                error = COALESCE(error, ?),
                finished_at = ?
          WHERE id = ? AND status = 'RUNNING'`,
      )
      .run(
        alive === false
          ? 'Interrupted: the process that owned this run is no longer alive'
          : `Interrupted: still RUNNING after ${STALE_RUN_HOURS} h`,
        nowIso(),
        row.id,
      );
    changed += 1;
  }
  return changed;
}

export function activeRun(): PipelineRunRow | undefined {
  return db()
    .prepare("SELECT * FROM pipeline_run WHERE status = 'RUNNING' ORDER BY id DESC LIMIT 1")
    .get() as PipelineRunRow | undefined;
}

export function latestRun(): PipelineRunRow | undefined {
  return db().prepare('SELECT * FROM pipeline_run ORDER BY id DESC LIMIT 1').get() as
    | PipelineRunRow
    | undefined;
}

/**
 * The most recent run that is not the one now in progress. `latestRun()` cannot be
 * used to inspect history from inside a run: the current RUNNING row is always the
 * latest, so it would mask the failure a Step 6 resume is looking for.
 */
export function previousRun(excludeRunId: number): PipelineRunRow | undefined {
  return db()
    .prepare('SELECT * FROM pipeline_run WHERE id <> ? ORDER BY id DESC LIMIT 1')
    .get(excludeRunId) as PipelineRunRow | undefined;
}

export function getRun(runId: number): PipelineRunRow | undefined {
  return db().prepare('SELECT * FROM pipeline_run WHERE id = ?').get(runId) as
    | PipelineRunRow
    | undefined;
}

export function createRun(runDate: string): number {
  const result = db()
    .prepare(
      `INSERT INTO pipeline_run (run_date, status, current_step, created_at, pid)
       VALUES (?, 'RUNNING', 'STEP0', ?, ?)`,
    )
    .run(runDate, nowIso(), process.pid);
  return Number(result.lastInsertRowid);
}

export function updateRun(runId: number, fields: Partial<Omit<PipelineRunRow, 'id'>>): void {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value as string | number | null);
  db().prepare(`UPDATE pipeline_run SET ${assignments} WHERE id = ?`).run(...values, runId);
}

/**
 * STEP 1. Leftover PROMPTED songs from a previous run come first, so prompts that
 * were paid for but not needed to reach 2h are consumed before new INIT rows.
 */
export function selectSongsForRun(limit: number): SongRow[] {
  return db()
    .prepare(
      `SELECT id, original_title, title,
              piano_title, piano_prompt1, piano_prompt2, piano_introduction,
              COALESCE(piano_status, 'INIT') AS piano_status,
              piano_audio_path, piano_video_path, piano_duration_sec
         FROM my_song
        WHERE COALESCE(piano_status, 'INIT') IN ('PROMPTED', 'INIT')
        ORDER BY CASE COALESCE(piano_status, 'INIT') WHEN 'PROMPTED' THEN 0 ELSE 1 END, id
        LIMIT ?`,
    )
    .all(limit) as unknown as SongRow[];
}

export function getSong(songId: number): SongRow | undefined {
  return db()
    .prepare(
      `SELECT id, original_title, title,
              piano_title, piano_prompt1, piano_prompt2, piano_introduction,
              COALESCE(piano_status, 'INIT') AS piano_status,
              piano_audio_path, piano_video_path, piano_duration_sec
         FROM my_song WHERE id = ?`,
    )
    .get(songId) as unknown as SongRow | undefined;
}

export function savePrompts(
  songId: number,
  fields: { pianoTitle: string; prompt1: string; prompt2: string; introduction: string },
): void {
  db()
    .prepare(
      `UPDATE my_song
          SET piano_title = ?, piano_prompt1 = ?, piano_prompt2 = ?, piano_introduction = ?,
              piano_status = 'PROMPTED', piano_error = NULL, piano_updated_at = ?
        WHERE id = ?`,
    )
    .run(fields.pianoTitle, fields.prompt1, fields.prompt2, fields.introduction, nowIso(), songId);
}

export function saveAudio(songId: number, audioPaths: string[], durationSec: number): void {
  db()
    .prepare(
      `UPDATE my_song
          SET piano_audio_path = ?, piano_duration_sec = ?,
              piano_status = 'GENERATED', piano_error = NULL, piano_updated_at = ?
        WHERE id = ?`,
    )
    .run(JSON.stringify(audioPaths), Math.round(durationSec), nowIso(), songId);
}

export function saveVideo(songId: number, videoPaths: string[]): void {
  db()
    .prepare(
      `UPDATE my_song
          SET piano_video_path = ?, piano_status = 'CONVERTED', piano_error = NULL, piano_updated_at = ?
        WHERE id = ?`,
    )
    .run(JSON.stringify(videoPaths), nowIso(), songId);
}

export function markSongDone(songId: number): void {
  db()
    .prepare("UPDATE my_song SET piano_status = 'DONE', piano_updated_at = ? WHERE id = ?")
    .run(nowIso(), songId);
}

export function markSongError(songId: number, message: string): void {
  db()
    .prepare("UPDATE my_song SET piano_status = 'ERROR', piano_error = ?, piano_updated_at = ? WHERE id = ?")
    .run(message.slice(0, 2000), nowIso(), songId);
}

/** The "Retry errors" toggle: put ERROR songs back to the furthest status their artifacts justify. */
export function resetErroredSongs(): number {
  const result = db()
    .prepare(
      `UPDATE my_song
          SET piano_status = CASE
                WHEN piano_video_path IS NOT NULL AND TRIM(piano_video_path) <> '' THEN 'CONVERTED'
                WHEN piano_audio_path IS NOT NULL AND TRIM(piano_audio_path) <> '' THEN 'GENERATED'
                WHEN piano_prompt1   IS NOT NULL AND TRIM(piano_prompt1)   <> '' THEN 'PROMPTED'
                ELSE 'INIT'
              END,
              piano_error = NULL,
              piano_updated_at = ?
        WHERE piano_status = 'ERROR'`,
    )
    .run(nowIso());
  return Number(result.changes);
}

export interface PipelineResetResult {
  songsReset: number;
  runsCleared: number;
}

/**
 * The "Reset" button: put the pipeline back to a first-run state.
 *
 * Songs left mid-flight (PROMPTED / GENERATED / CONVERTED / ERROR) go back to INIT and
 * lose their generated artifacts, so Step 1 hands them out again from the top. Clearing
 * the paths as well as the status keeps the invariant the rest of the code relies on --
 * that a status is justified by the artifacts on record -- and disarms the orchestrator
 * carry-over query, which would otherwise re-adopt GENERATED/CONVERTED songs.
 *
 * DONE songs are left alone: they are already uploaded, and resetting them would
 * eventually re-generate and re-upload the same material.
 *
 * Deleting every pipeline_run row is what makes the next click start at STEP1. The Step 6
 * resume looks at previousRun(), so with no history there is nothing to resume into.
 * Files already written under OUTPUT_DIR are not touched.
 */
export function resetPipelineState(): PipelineResetResult {
  const database = db();

  const songs = database
    .prepare(
      `UPDATE my_song
          SET piano_status = 'INIT',
              piano_title = NULL,
              piano_prompt1 = NULL,
              piano_prompt2 = NULL,
              piano_introduction = NULL,
              piano_audio_path = NULL,
              piano_video_path = NULL,
              piano_duration_sec = NULL,
              piano_error = NULL,
              piano_updated_at = ?
        WHERE COALESCE(piano_status, 'INIT') NOT IN ('INIT', 'DONE')`,
    )
    .run(nowIso());

  const runs = database.prepare('DELETE FROM pipeline_run').run();

  return { songsReset: Number(songs.changes), runsCleared: Number(runs.changes) };
}

/** Every prompt already in the database, for the Step 2 duplicate check. */
export function allExistingPrompts(excludeSongId?: number): string[] {
  const rows = db()
    .prepare(
      `SELECT piano_prompt1, piano_prompt2
         FROM my_song
        WHERE (piano_prompt1 IS NOT NULL AND TRIM(piano_prompt1) <> '')
           OR (piano_prompt2 IS NOT NULL AND TRIM(piano_prompt2) <> '')`,
    )
    .all() as Array<{ piano_prompt1: string | null; piano_prompt2: string | null }>;

  void excludeSongId;
  return rows.flatMap((row) => [row.piano_prompt1, row.piano_prompt2]).filter((p): p is string => !!p && p.trim() !== '');
}

export function songsByStatus(statuses: PianoStatus[]): SongRow[] {
  const placeholders = statuses.map(() => '?').join(', ');
  return db()
    .prepare(
      `SELECT id, original_title, title,
              piano_title, piano_prompt1, piano_prompt2, piano_introduction,
              COALESCE(piano_status, 'INIT') AS piano_status,
              piano_audio_path, piano_video_path, piano_duration_sec
         FROM my_song
        WHERE COALESCE(piano_status, 'INIT') IN (${placeholders})
        ORDER BY id`,
    )
    .all(...statuses) as unknown as SongRow[];
}

export function statusCounts(): Record<string, number> {
  const rows = db()
    .prepare(
      "SELECT COALESCE(piano_status, 'INIT') AS status, COUNT(*) AS n FROM my_song GROUP BY 1",
    )
    .all() as Array<{ status: string; n: number }>;
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]));
}

export function parseJsonPaths(value: string | null): string[] {
  if (!value || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [value];
  }
}
