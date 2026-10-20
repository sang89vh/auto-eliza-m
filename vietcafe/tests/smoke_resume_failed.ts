/**
 * The two halves of the Resume button, against state no live run can be relied on to produce:
 *
 *   - requeueErroredSongs() (src/lib/db.ts): every ERROR song goes back to the furthest status
 *     its files ON DISK justify -- not merely the paths on record;
 *   - selectCarryOver() (src/pipeline/orchestrator.ts): a backlog bigger than one video is
 *     worked off one video at a time, instead of being merged into a single file that fails
 *     Step 5's window and wedges every later run.
 *
 * No Suno, no Mjudio, no YouTube, no OpenAI. It rewrites cafe_status across the database it
 * points at and writes throwaway files under os.tmpdir(), so only ever give it a copy:
 *
 *   DB_PATH=/tmp/songs_cafe_test.db npx tsx tests/smoke_resume_failed.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/lib/config.js';
import {
  closeDb,
  db,
  getSong,
  markSongDone,
  migrate,
  nowIso,
  requeueErroredSongs,
  type SongRow,
} from '../src/lib/db.js';
import { selectCarryOver } from '../src/pipeline/orchestrator.js';

// The live database sits in a `data/` folder on both machines; a copy handed to a test never should.
if (path.basename(path.dirname(config.dbPath)).toLowerCase() === 'data') {
  throw new Error(
    `Refusing to run against ${config.dbPath}: this test rewrites every song's status. ` +
      'Point DB_PATH at a copy of the database.',
  );
}

migrate();
const database = db();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vietcafe-resume-'));

/** A small non-empty stand-in for a downloaded track or a rendered clip. */
const fakeFile = (name: string): string => {
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, 'not-real-media-but-non-empty');
  return filePath;
};

/** A path that is on record but not on disk -- what a manual disk cleanup leaves behind. */
const missingFile = (name: string): string => path.join(tempDir, 'deleted', name);

/** Every song back to INIT with no artifacts; prompts and lyrics are kept, as in smoke_resume.ts. */
const normalise = (): void => {
  database.exec(
    "UPDATE my_song SET cafe_status='INIT', cafe_audio_path=NULL, cafe_video_path=NULL, cafe_duration_sec=NULL, cafe_error=NULL",
  );
};

const secondsOf = (songs: SongRow[]): number => songs.reduce((sum, song) => sum + (song.cafe_duration_sec ?? 0), 0);
const idsOf = (songs: SongRow[]): number[] => songs.map((song) => song.id);
const sameIds = (actual: number[], expected: number[]): boolean =>
  actual.length === expected.length && actual.every((id, index) => id === expected[index]);
const canonical = (counts: Record<string, number | undefined>): string =>
  JSON.stringify(Object.entries(counts).sort(([x], [y]) => x.localeCompare(y)));

const ids = (database.prepare('SELECT id FROM my_song ORDER BY id LIMIT 80').all() as Array<{ id: number }>).map(
  (row) => Number(row.id),
);
if (ids.length < 60) throw new Error(`Need at least 60 rows in my_song, found ${ids.length}`);
const idAt = (index: number): number => ids[index] as number;

const TARGET_SECONDS = 7200;
// selectCarryOver's ceiling for that target: 10 min of merge window, minus 120 s of headroom.
const CEILING_SECONDS = TARGET_SECONDS + 600 - 120;

try {
  // ---------- requeueErroredSongs(): the files on disk decide, not the paths on record ----------
  console.log('\n=== requeueErroredSongs(): ERROR songs back to their last good status ===');
  normalise();

  const PROMPT = 'soft acoustic guitar, warm cafe ambience, gentle female vocal, light brushed drums';
  const LYRICS = '[Verse]\nMưa rơi bên hiên quán nhỏ\n[Chorus]\nCà phê chiều nay thật êm';

  const setSong = database.prepare(
    `UPDATE my_song
        SET cafe_status = ?, cafe_audio_path = ?, cafe_video_path = ?, cafe_duration_sec = ?,
            cafe_prompt1 = ?, cafe_lyrics = ?, cafe_error = ?, cafe_updated_at = ?
      WHERE id = ?`,
  );
  const [a, b, c, d, e, f, control] = [0, 1, 2, 3, 4, 5, 6].map(idAt) as [
    number, number, number, number, number, number, number,
  ];

  setSong.run('ERROR', JSON.stringify([fakeFile(`${a}_1.wav`)]), null, 450, PROMPT, LYRICS,
    'STEP4: Mjudio export failed (test)', nowIso(), a);
  setSong.run('ERROR', JSON.stringify([fakeFile(`${b}_1.wav`)]), JSON.stringify([fakeFile(`${b}_1.mp4`)]), 450,
    PROMPT, LYRICS, 'STEP4: test', nowIso(), b);
  setSong.run('ERROR', JSON.stringify([missingFile(`${c}_1.wav`)]), null, 450, PROMPT, LYRICS,
    'STEP4: none of the recorded audio files exist on disk', nowIso(), c);
  setSong.run('ERROR', null, null, null, PROMPT, LYRICS,
    'STEP3: No usable audio was downloaded for this generation', nowIso(), d);
  setSong.run('ERROR', null, null, null, null, null, 'STEP2: lyrics unusable after regeneration', nowIso(), e);
  setSong.run('ERROR', JSON.stringify([missingFile(`${f}_1.wav`)]), null, 450, null, null, 'STEP4: test', nowIso(), f);
  // A GENERATED song that never failed: the re-queue must leave it alone and not count it.
  setSong.run('GENERATED', JSON.stringify([fakeFile(`${control}_1.wav`)]), null, 450, PROMPT, LYRICS, null, nowIso(),
    control);

  const result = requeueErroredSongs();
  check('all six ERROR songs are re-queued', result.requeued === 6, `requeued=${result.requeued}`);
  check(
    'landed: 1 GENERATED, 1 CONVERTED, 2 PROMPTED, 2 INIT',
    canonical(result.landed) === canonical({ GENERATED: 1, CONVERTED: 1, PROMPTED: 2, INIT: 2 }),
    canonical(result.landed),
  );
  check('two songs demoted because their audio is gone', result.demoted === 2, `demoted=${result.demoted}`);

  const expectations: Array<[string, number, string]> = [
    ['a. audio on disk', a, 'GENERATED'],
    ['b. audio and clip on disk', b, 'CONVERTED'],
    ['c. audio on record but deleted, prompts kept', c, 'PROMPTED'],
    ['d. no audio, prompts kept', d, 'PROMPTED'],
    ['e. nothing kept', e, 'INIT'],
    ['f. audio on record but deleted, no prompts', f, 'INIT'],
    ['control: GENERATED song that never failed', control, 'GENERATED'],
  ];
  for (const [label, id, status] of expectations) {
    const actual = getSong(id)?.cafe_status ?? null;
    check(`${label} -> ${status}`, actual === status, `song ${id} is ${actual}`);
  }

  const errorOf = database.prepare('SELECT cafe_error FROM my_song WHERE id = ?');
  const leftoverErrors = [a, b, c, d, e, f].filter(
    (id) => (errorOf.get(id) as { cafe_error: string | null } | undefined)?.cafe_error != null,
  );
  check('cafe_error is cleared on all six', leftoverErrors.length === 0, leftoverErrors.join(',') || 'none left');
  check(
    'the demoted songs no longer point at their deleted audio',
    getSong(c)?.cafe_audio_path == null && getSong(f)?.cafe_audio_path == null,
    `c=${getSong(c)?.cafe_audio_path} f=${getSong(f)?.cafe_audio_path}`,
  );

  const again = requeueErroredSongs();
  check(
    'a second call finds nothing at ERROR',
    again.requeued === 0 && canonical(again.landed) === canonical({}) && again.demoted === 0,
    JSON.stringify(again),
  );

  // ---------- selectCarryOver(): one video at a time ----------
  const setCarry = database.prepare(
    'UPDATE my_song SET cafe_status = ?, cafe_duration_sec = ?, cafe_audio_path = ?, cafe_video_path = ? WHERE id = ?',
  );
  /** Stage a carry-over. selectCarryOver never checks files, so dummy paths are enough. */
  const stage = (rows: Array<[number, 'GENERATED' | 'CONVERTED', number]>): void => {
    normalise();
    for (const [id, status, seconds] of rows) {
      setCarry.run(
        status,
        seconds,
        JSON.stringify([`/nonexistent/${id}_1.wav`]),
        status === 'CONVERTED' ? JSON.stringify([`/nonexistent/${id}_1.mp4`]) : null,
        id,
      );
    }
  };

  const backlog = ids.slice(0, 50);
  const convertedIds = backlog.slice(48); // the two HIGHEST ids
  const generatedIds = backlog.slice(0, 48);
  const stageBacklog = (): void =>
    stage(backlog.map((id) => [id, convertedIds.includes(id) ? 'CONVERTED' : 'GENERATED', 450]));

  console.log('\n=== B1: a 6-hour backlog is capped at one video ===');
  stageBacklog();
  const b1 = selectCarryOver([], TARGET_SECONDS);
  const b1Total = secondsOf(b1.carriedOver);
  check(
    'the two CONVERTED songs come first, despite having the highest ids',
    sameIds(idsOf(b1.carriedOver).slice(0, 2), convertedIds),
    `first two: ${idsOf(b1.carriedOver).slice(0, 2).join(',')}`,
  );
  check(
    `taken total is within [${TARGET_SECONDS}, ${CEILING_SECONDS}] s`,
    b1Total >= TARGET_SECONDS && b1Total <= CEILING_SECONDS,
    `${b1Total} s from ${b1.carriedOver.length} song(s), ${b1.deferred.length} deferred`,
  );
  const b1Taken = idsOf(b1.carriedOver);
  const b1Deferred = idsOf(b1.deferred);
  const b1Union = new Set([...b1Taken, ...b1Deferred]);
  check(
    'taken + deferred cover all 50 songs, with no overlap',
    b1Taken.length + b1Deferred.length === 50 && b1Union.size === 50 && backlog.every((id) => b1Union.has(id)),
    `${b1Taken.length} + ${b1Deferred.length}`,
  );
  const b1Generated = b1.carriedOver.filter((song) => song.cafe_status === 'GENERATED').map((song) => song.id);
  check(
    'GENERATED songs are taken oldest id first',
    sameIds(b1Generated, generatedIds.slice(0, b1Generated.length)),
    b1Generated.join(','),
  );

  console.log('\n=== B2: the backlog is worked off over successive runs ===');
  stageBacklog();
  const batches: SongRow[][] = [];
  for (let guard = 0; guard < 10; guard += 1) {
    const { carriedOver } = selectCarryOver([], TARGET_SECONDS);
    if (carriedOver.length === 0) break;
    batches.push(carriedOver);
    // What a successful run does to the songs it uploaded.
    for (const song of carriedOver) markSongDone(song.id);
  }
  const batchSizes = batches.map((batch) => batch.length);
  check('four runs: 16, 16, 16, then 2 songs', sameIds(batchSizes, [16, 16, 16, 2]), batchSizes.join(', '));
  const fullBatches = batches.slice(0, -1);
  check(
    `every full batch is within [${TARGET_SECONDS}, ${CEILING_SECONDS}] s`,
    fullBatches.length > 0 &&
      fullBatches.every((batch) => secondsOf(batch) >= TARGET_SECONDS && secondsOf(batch) <= CEILING_SECONDS),
    batches.map((batch) => `${secondsOf(batch)} s`).join(', '),
  );
  const consumed = batches.flat().map((song) => song.id);
  check(
    'every song is consumed exactly once',
    consumed.length === 50 && new Set(consumed).size === 50 && backlog.every((id) => consumed.includes(id)),
    `${consumed.length} consumed, ${new Set(consumed).size} distinct`,
  );
  const lastBatch = batches.at(-1) ?? [];
  check(
    'the last, short batch stays under the target (Step 3 tops it up)',
    secondsOf(lastBatch) < TARGET_SECONDS,
    `${secondsOf(lastBatch)} s`,
  );

  console.log('\n=== B3: a song that would overshoot the merge window is skipped, not taken ===');
  const b3Base = ids.slice(0, 15);
  const [tooLong, fits, spare] = [idAt(15), idAt(16), idAt(17)];
  stage([
    ...b3Base.map((id): [number, 'GENERATED', number] => [id, 'GENERATED', 470]), // 15 x 470 = 7050 s
    [tooLong, 'GENERATED', 720], // 7050 + 720 = 7770 > 7680 -> left for the next run
    [fits, 'GENERATED', 300], // 7050 + 300 = 7350 -> taken, target met
    [spare, 'GENERATED', 300], // target already met -> left for the next run
  ]);
  const b3 = selectCarryOver([], TARGET_SECONDS);
  check('taken: the 15 base songs plus the 300 s one', sameIds(idsOf(b3.carriedOver), [...b3Base, fits]),
    idsOf(b3.carriedOver).join(','));
  check('deferred: the 720 s song and the spare', sameIds(idsOf(b3.deferred), [tooLong, spare]),
    idsOf(b3.deferred).join(','));
  check('taken total is 7350 s', secondsOf(b3.carriedOver) === 7350, `${secondsOf(b3.carriedOver)} s`);

  console.log('\n=== B4: songs Step 1 already selected are not carried over ===');
  stage([
    [idAt(0), 'GENERATED', 450],
    [idAt(1), 'GENERATED', 450],
    [idAt(2), 'GENERATED', 450],
  ]);
  const selected = [getSong(idAt(1))].filter((song): song is SongRow => song !== undefined);
  const b4 = selectCarryOver(selected, TARGET_SECONDS);
  check(
    'the selected song is in neither list',
    selected.length === 1 && !idsOf(b4.carriedOver).includes(idAt(1)) && !idsOf(b4.deferred).includes(idAt(1)),
    `carried ${idsOf(b4.carriedOver).join(',')} deferred ${idsOf(b4.deferred).join(',') || 'none'}`,
  );
  check('the other two are carried over', sameIds(idsOf(b4.carriedOver), [idAt(0), idAt(2)]),
    idsOf(b4.carriedOver).join(','));

  console.log('\n=== B5: a backlog under one video is taken whole ===');
  stage([
    [idAt(0), 'GENERATED', 450],
    [idAt(1), 'GENERATED', 450],
    [idAt(2), 'GENERATED', 450],
  ]);
  const b5 = selectCarryOver([], TARGET_SECONDS);
  check('all three taken, nothing deferred', b5.carriedOver.length === 3 && b5.deferred.length === 0,
    `${b5.carriedOver.length} taken, ${b5.deferred.length} deferred, ${secondsOf(b5.carriedOver)} s`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log(`\n=== ${failures === 0 ? 'ALL RESUME-FAILED CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
closeDb();
process.exit(failures === 0 ? 0 : 1);
