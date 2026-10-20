/**
 * The parts of the daily loop that can be checked without spending a credit: unique run
 * folders, the exact-path Step 6 resume lookup, and the post-run cleanup that has to free a
 * session's disk without eating the next session's carry-over material.
 *
 * Point DB_PATH at a COPY and OUTPUT_DIR/DOWNLOAD_DIR at throwaway folders -- this rewrites
 * cafe_status across the database and deletes files under both roots:
 *
 *   DB_PATH=/tmp/songs_cafe_test.db OUTPUT_DIR=/tmp/loop/out DOWNLOAD_DIR=/tmp/loop/in \
 *     npx tsx tests/smoke_daily_loop.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/lib/config.js';
import { closeDb, db, migrate, nowIso } from '../src/lib/db.js';
import { createRunFolder, finalVideoAt, stampFor } from '../src/lib/runFolder.js';
import { cleanupConsumedArtifacts } from '../src/setup/cleanup.js';

migrate();
const database = db();
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const writeFile = (filePath: string, bytes = 1024): string => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(bytes, 1));
  return filePath;
};

// ---------- Ten videos a day means ten run folders ----------
console.log('\n=== A second run in the same minute gets its own folder ===');
const fixedMinute = new Date(2026, 8, 22, 6, 30, 0, 0);
const first = createRunFolder(fixedMinute);
const second = createRunFolder(fixedMinute);
const third = createRunFolder(fixedMinute);

check('the first run takes the plain stamp', path.basename(first.root) === 'run_20260922_0630', path.basename(first.root));
check('the second run does not share it', second.root !== first.root, path.basename(second.root));
check('the third run does not share either', third.root !== second.root && third.root !== first.root, path.basename(third.root));
check(
  'suffixed folders still sort chronologically after the plain one',
  [path.basename(first.root), path.basename(second.root), path.basename(third.root)].join(',') ===
    [path.basename(first.root), path.basename(second.root), path.basename(third.root)].sort().join(','),
);
check('every run folder is fully built', [second.audio, second.video, second.final, second.logs].every((d) => fs.existsSync(d)));
check('runDate is still the calendar day', second.runDate === '2026-09-22', second.runDate);

// ---------- The Step 6 resume must resume ITS OWN video ----------
console.log('\n=== finalVideoAt: the exact file a failed run recorded, or nothing ===');
const ownVideo = writeFile(path.join(second.final, 'final_20260922.mp4'));
// An earlier video of the same day, in a different folder, already uploaded.
const otherVideo = writeFile(path.join(first.final, 'final_20260922.mp4'));

check('locates the recorded file', finalVideoAt(ownVideo)?.videoPath === ownVideo);
check(
  'and rebuilds that run folder, not a sibling',
  finalVideoAt(ownVideo)?.folder.root === second.root && finalVideoAt(otherVideo)?.folder.root === first.root,
);
check('reads the date stamp back off the filename', finalVideoAt(ownVideo)?.folder.dateStamp === '20260922');
check('a deleted file is not resumable', finalVideoAt(path.join(third.final, 'final_20260922.mp4')) === null);
check('a zero-byte file is not resumable', finalVideoAt(writeFile(path.join(third.final, 'final_20260922.mp4'), 0)) === null);
check('a file that is not a merged master is rejected', finalVideoAt(path.join(second.video, '1223_1.mp4')) === null);

// ---------- Post-run cleanup ----------
console.log('\n=== Post-run cleanup frees the finished session, keeps the next one ===');
database.exec("UPDATE my_song SET cafe_status='INIT', cafe_audio_path=NULL, cafe_video_path=NULL, cafe_duration_sec=NULL");
database.exec('DELETE FROM pipeline_run');

// Song 1223 is in the video that just uploaded: its downloads and clips are consumed.
const doneAudio = writeFile(path.join(config.downloadDir, '1223_1.wav'), 4096);
const doneClip = writeFile(path.join(second.video, '1223_1.mp4'), 4096);
database
  .prepare("UPDATE my_song SET cafe_status='DONE', cafe_audio_path=?, cafe_video_path=?, cafe_updated_at=? WHERE id=1223")
  .run(JSON.stringify([doneAudio]), JSON.stringify([doneClip]), nowIso());

// Song 1224 was generated but did not fit in the merge: it is tomorrow's carry-over.
const carriedAudio = writeFile(path.join(config.downloadDir, '1224_1.wav'), 4096);
database
  .prepare("UPDATE my_song SET cafe_status='GENERATED', cafe_audio_path=?, cafe_duration_sec=200, cafe_updated_at=? WHERE id=1224")
  .run(JSON.stringify([carriedAudio]), nowIso());

// Step 4/5 leftovers of the finished session, and the paper trail that must survive it.
const normalised = writeFile(path.join(second.audio, '1223_1_norm.wav'), 8192);
const uniform = writeFile(path.join(second.video, '_uniform', '1223_1.mp4'), 8192);
const tracklist = writeFile(path.join(second.final, 'tracklist.json'), 64);
const runLog = writeFile(path.join(second.logs, 'run.log'), 64);

// A half-finished download nothing points at, and files the sweep must not touch.
const orphanDownload = writeFile(path.join(config.downloadDir, '4242_2.wav'), 4096);
const unrelatedWav = writeFile(path.join(config.downloadDir, 'my-own-demo.wav'), 4096);
const unrelatedText = writeFile(path.join(config.downloadDir, 'notes.txt'), 64);

// A run that died at Step 4 never recorded a merged video, so its folder used to be
// unreachable by the cleanup -- and at ten runs a day its leftovers alone fill the disk.
const failedRunRoot = createRunFolder(new Date(2026, 8, 21, 3, 15));
const failedNorm = writeFile(path.join(failedRunRoot.audio, '1224_1_norm.wav'), 8192);
const failedPartialClip = writeFile(path.join(failedRunRoot.video, '1299_1.mp4'), 8192);
const failedRunLog = writeFile(path.join(failedRunRoot.logs, 'run.log'), 64);
// ...but a clip that folder holds for a CONVERTED carry-over song must still survive.
const carriedClip = writeFile(path.join(failedRunRoot.video, '1225_1.mp4'), 8192);
database
  .prepare("UPDATE my_song SET cafe_status='CONVERTED', cafe_video_path=?, cafe_duration_sec=200, cafe_updated_at=? WHERE id=1225")
  .run(JSON.stringify([carriedClip]), nowIso());

database
  .prepare("INSERT INTO pipeline_run (id,run_date,status,current_step,merged_video_path,created_at) VALUES (1,'2026-09-22','SUCCESS','STEP6',?,?)")
  .run(ownVideo, nowIso());
database
  .prepare("INSERT INTO pipeline_run (id,run_date,status,current_step,created_at) VALUES (2,'2026-09-22','FAILED','STEP3',?)")
  .run(nowIso());

const skipped = cleanupConsumedArtifacts();
check('a session that failed deletes nothing at all', skipped.skippedReason !== null && skipped.deletedFiles === 0, skipped.skippedReason ?? '');
check('so its files are all still there', fs.existsSync(doneAudio) && fs.existsSync(normalised) && fs.existsSync(ownVideo));

database.exec('DELETE FROM pipeline_run WHERE id = 2');
const summary = cleanupConsumedArtifacts();

check('the uploaded video is gone', !fs.existsSync(ownVideo));
check('the consumed download is gone', !fs.existsSync(doneAudio));
check('the consumed per-track clip is gone', !fs.existsSync(doneClip));
check('the normalised wav is gone', !fs.existsSync(normalised));
check('the _uniform re-encode is gone', !fs.existsSync(uniform));
check('the unreferenced download is gone', !fs.existsSync(orphanDownload));
check('it was counted as an orphan, not as a consumed artifact', summary.orphanFiles === 1, `orphanFiles=${summary.orphanFiles}`);

check('an earlier failed run\'s normalised wav is gone too', !fs.existsSync(failedNorm));
check('and its half-rendered clip', !fs.existsSync(failedPartialClip));

check("tomorrow's carry-over audio survives", fs.existsSync(carriedAudio));
check("a carry-over song's clip survives even inside a swept folder", fs.existsSync(carriedClip));
check('the tracklist survives as the paper trail', fs.existsSync(tracklist));
check('the run log survives', fs.existsSync(runLog) && fs.existsSync(failedRunLog));
check('a download that is not ours survives', fs.existsSync(unrelatedWav) && fs.existsSync(unrelatedText));
check('something was actually freed', summary.freedBytes > 0, `${summary.freedBytes} bytes, ${summary.deletedFiles} file(s)`);

// The paths in the database come from whichever shell launched the run that wrote them;
// on Windows a case difference must not turn a protected file into an orphan.
if (process.platform === 'win32') {
  const recased = carriedAudio.replace(/^([a-zA-Z]):/, (_m, drive: string) => `${drive.toLowerCase()}:`).toUpperCase();
  database.prepare("UPDATE my_song SET cafe_audio_path=? WHERE id=1224").run(JSON.stringify([recased]));
  cleanupConsumedArtifacts();
  check('a differently-cased recorded path still protects its file', fs.existsSync(carriedAudio), recased);
  database.prepare("UPDATE my_song SET cafe_audio_path=? WHERE id=1224").run(JSON.stringify([carriedAudio]));
}

// The loop calls this after every iteration, so a second call must be harmless.
const again = cleanupConsumedArtifacts();
check('a second call is a no-op, not an error', again.deletedFiles === 0, `deleted ${again.deletedFiles}`);
check("and still does not touch the carry-over", fs.existsSync(carriedAudio));

// ---------- stampFor is still the contract runFolder names rely on ----------
console.log('\n=== Stamps ===');
const stamp = stampFor(new Date(2026, 8, 22, 23, 5));
check('folderStamp is minute-resolution', stamp.folderStamp === '20260922_2305', stamp.folderStamp);
check('dateStamp drives final_YYYYMMDD.mp4', stamp.dateStamp === '20260922', stamp.dateStamp);

console.log(`\n=== ${failures === 0 ? 'ALL DAILY-LOOP CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
closeDb();
process.exit(failures === 0 ? 0 : 1);
