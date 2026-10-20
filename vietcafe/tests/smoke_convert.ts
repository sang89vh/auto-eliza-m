import path from 'node:path';
import fs from 'node:fs';
import { health, convertWavToMp4 } from '../src/lib/mjudio.js';
import { normalizeLoudness, probe, measureIntegratedLoudness } from '../src/lib/ffmpeg.js';

const scratch = process.argv[2]!;
console.log('Mjudio health:', JSON.stringify(await health()));

const raw = path.join(scratch, 'tone_raw.wav');
const normalized = path.join(scratch, 'tone_norm.wav');

console.log('\n--- loudnorm two-pass ---');
console.log('before:', (await measureIntegratedLoudness(raw))?.toFixed(2), 'LUFS');
await normalizeLoudness(raw, normalized);
console.log('after :', (await measureIntegratedLoudness(normalized))?.toFixed(2), 'LUFS (target -14)');

console.log('\n--- convertWavToMp4 ---');
const audio = await probe(normalized);
const out = path.join(scratch, 'tone.mp4');
const started = Date.now();
await convertWavToMp4(normalized, { projectName: 'Nhạc Chill Quán Cà Phê', outputPath: out });
console.log(`rendered in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const video = await probe(out);
console.log('mp4 :', JSON.stringify(video), fs.statSync(out).size, 'bytes');
console.log('audio duration', audio.durationSec.toFixed(2), 'vs video', video.durationSec.toFixed(2),
            '-> drift', Math.abs(video.durationSec - audio.durationSec).toFixed(2), 's (tolerance 2s)');
