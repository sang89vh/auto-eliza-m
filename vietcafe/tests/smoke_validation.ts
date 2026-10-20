import fs from 'node:fs';
import path from 'node:path';
import { createRunFolder } from '../src/lib/runFolder.js';
import { step5Merge, MergeValidationError } from '../src/pipeline/step5_merge.js';
import { buildTitle, buildDescription } from '../src/pipeline/step6_youtube.js';
import type { SongRow } from '../src/lib/db.js';
import type { TracklistEntry } from '../src/pipeline/step5_merge.js';

const clipsDir = process.argv[2]!;
const songs = [{
  id: 101, original_title: '', title: null,
  cafe_title: 'Chiều Mưa Bên Hiên Quán',
  cafe_prompt1: null, cafe_prompt2: null, cafe_introduction: null,
  cafe_status: 'CONVERTED' as const, cafe_audio_path: null,
  cafe_video_path: JSON.stringify([path.join(clipsDir, 'clip1.mp4'), path.join(clipsDir, 'clip2.mp4')]),
  cafe_duration_sec: null,
}] as SongRow[];

console.log('=== 4. Merge validation must reject a 1.25-min file against a 120-min target ===');
const folder = createRunFolder();
try {
  await step5Merge(songs, folder);
  console.log('  FAIL: no error was raised');
} catch (error) {
  const isRight = error instanceof MergeValidationError;
  console.log(`  ${isRight ? 'PASS' : 'FAIL'}: ${error instanceof Error ? error.message : String(error)}`);
  const kept = path.join(folder.final, 'final_' + folder.dateStamp + '.mp4');
  console.log(`  merged file kept on disk for inspection -> ${fs.existsSync(kept) ? 'PASS' : 'FAIL'}`);
}

console.log('\n=== 5. YouTube title & description (US-06 AC1/AC2) ===');
const tracklist: TracklistEntry[] = [
  { songId: 1, title: 'Chiều Mưa Bên Hiên Quán', startSec: 0, durationSec: 210, videoPath: '' },
  { songId: 1, title: 'Chiều Mưa Bên Hiên Quán (2)', startSec: 210, durationSec: 195, videoPath: '' },
  { songId: 2, title: 'Sáng Cà Phê Phố Cũ', startSec: 405, durationSec: 240, videoPath: '' },
  { songId: 2, title: 'Sáng Cà Phê Phố Cũ (2)', startSec: 645, durationSec: 225, videoPath: '' },
];

const title = buildTitle(tracklist, '20260830');
console.log('  title:', JSON.stringify(title), `(${title.length} chars)`);

// The real names behind these two songs, which must never surface.
const banned = ['菊花台', '周杰伦', '秋天不回来', '王强', 'Perfect', 'Ed Sheeran'];
const description = buildDescription(tracklist);
const leaks = banned.filter((t) => (title + description).toLowerCase().includes(t.toLowerCase()));
console.log(`  no original song/artist names -> ${leaks.length === 0 ? 'PASS' : 'FAIL ' + leaks.join(',')}`);
console.log(`  title <= 100 chars            -> ${title.length <= 100 ? 'PASS' : 'FAIL'}`);
console.log(`  title has the date            -> ${title.includes('2026-08-30') ? 'PASS' : 'FAIL'}`);
console.log(`  chapters start at 00:00       -> ${description.includes('00:00 ') ? 'PASS' : 'FAIL'}`);
console.log(`  >= 3 timestamp lines          -> ${(description.match(/^\d+:\d\d /gm) || []).length >= 3 ? 'PASS' : 'FAIL'}`);
console.log('\n--- description ---\n' + description);
