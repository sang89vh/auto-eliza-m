import fs from 'node:fs';
import path from 'node:path';
import { createRunFolder } from '../src/lib/runFolder.js';
import { step5Merge, MergeValidationError, formatTimestamp } from '../src/pipeline/step5_merge.js';
import { probe } from '../src/lib/ffmpeg.js';
import type { SongRow } from '../src/lib/db.js';

const clipsDir = process.argv[2]!;
const clip = (n: number): string => path.join(clipsDir, `clip${n}.mp4`);

// Two songs, two clips each -- the same shape Step 4 produces (one mp4 per variant).
const songs = [
  { id: 101, cafe_title: 'Chiều Mưa Bên Hiên Quán', clips: [clip(1), clip(2)] },
  { id: 102, cafe_title: 'Sáng Cà Phê Phố Cũ', clips: [clip(3), clip(4)] },
].map((s) => ({
  id: s.id, original_title: '', title: null,
  cafe_title: s.cafe_title, cafe_prompt1: null, cafe_prompt2: null, cafe_introduction: null,
  cafe_status: 'CONVERTED' as const,
  cafe_audio_path: null, cafe_video_path: JSON.stringify(s.clips), cafe_duration_sec: null,
})) as SongRow[];

const folder = createRunFolder();
console.log('run folder:', folder.root, '\n');

const result = await step5Merge(songs, folder);

console.log('\n--- final file ---');
const info = await probe(result.finalVideoPath);
console.log(JSON.stringify(info), fs.statSync(result.finalVideoPath).size, 'bytes');

console.log('\n--- tracklist.txt ---');
console.log(fs.readFileSync(result.tracklistPath, 'utf8'));

console.log('--- timestamp accuracy (US-05 AC4, tolerance 3s) ---');
let cumulative = 0;
let worstDrift = 0;
for (const entry of result.tracklist) {
  const drift = Math.abs(entry.startSec - cumulative);
  worstDrift = Math.max(worstDrift, drift);
  console.log(`  ${formatTimestamp(entry.startSec)} expected ${formatTimestamp(cumulative)} drift ${drift.toFixed(2)}s  ${entry.title}`);
  cumulative += entry.durationSec;
}
console.log(`  sum of clip durations ${cumulative.toFixed(2)}s vs merged ${info.durationSec.toFixed(2)}s`);
console.log(`  worst timestamp drift ${worstDrift.toFixed(2)}s -> ${worstDrift <= 3 ? 'PASS' : 'FAIL'}`);
console.log(`  first chapter at 00:00 -> ${result.tracklist[0]!.startSec === 0 ? 'PASS' : 'FAIL'}`);
console.log(`  1080p h264/aac -> ${info.width === 1920 && info.height === 1080 && info.videoCodec === 'h264' && info.audioCodec === 'aac' ? 'PASS' : 'FAIL'}`);
console.log(`  tracklist.json written -> ${fs.existsSync(path.join(folder.final, 'tracklist.json')) ? 'PASS' : 'FAIL'}`);

fs.writeFileSync(path.join(clipsDir, 'last_run_folder.txt'), folder.root);
