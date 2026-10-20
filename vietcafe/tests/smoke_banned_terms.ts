/**
 * Pure-logic regression test for the naming-policy matcher. No database, no network:
 * `npx tsx tests/smoke_banned_terms.ts`.
 *
 * Guards the bug that silently corrupted two saved prompts in run_20260904_0642: the
 * artist "MIN" (Có Em Chờ, Bài Này Chill Phết) substring-matched "minor", so every
 * style prompt was rejected once and then had "min" deleted mid-word, leaving
 * "wistful or verses" where "wistful minor verses" had been written.
 */
import { findBannedTerms, stripBannedTerms } from '../src/pipeline/step2_prompts.js';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        expected ${e}\n        actual   ${a}`}`);
}

// The real banned list for "Bài Này Chill Phết - Đen, MIN".
const BANNED = ['Bài Này Chill Phết', 'Đen', 'MIN', 'Đêm Mơ Màng Cháy Lên'];

// The real prompt2 that was corrupted, restored to what the model actually wrote.
const PROMPT =
  'Laid-back Vietnamese indie cafe ballad with warm male Vietnamese vocals, close-mic and ' +
  'conversational, 76 BPM, wistful minor verses opening into softly hopeful major choruses, ' +
  'mellow acoustic guitar, Rhodes piano, restrained bass, and gentle rain outside a window. ' +
  'Keep the arrangement sparse and soulful, with calming phrasing and a charming evening mood.';

console.log('=== 1. A single-token banned term must not match inside an English word ===');
check('"MIN" vs minor/calming/charming', findBannedTerms(PROMPT, BANNED), []);
check('"LK" vs "folk guitar"', findBannedTerms('warm folk guitar', ['LK']), []);
check('"Đen" vs "denim"', findBannedTerms('soft denim-warm tone', ['Đen']), []);

console.log('\n=== 2. It must still match when it stands alone ===');
check('standalone MIN', findBannedTerms('vocals in the style of MIN, breathy', BANNED), ['MIN']);
check('standalone lowercase min', findBannedTerms('sung by min', ['MIN']), ['MIN']);
check('standalone Đen', findBannedTerms('rap verse by Đen', ['Đen']), ['Đen']);
check('MIN before punctuation', findBannedTerms('featuring MIN.', ['MIN']), ['MIN']);

console.log('\n=== 3. Multi-word terms keep the substring policy ===');
check('song title anywhere', findBannedTerms('a cover of Bài Này Chill Phết vibes', BANNED), [
  'Bài Này Chill Phết',
]);
check('title run together with a word', findBannedTerms('xBài Này Chill Phếtx', BANNED), [
  'Bài Này Chill Phết',
]);

console.log('\n=== 4. Stripping must not shred ordinary words ===');
check('prompt survives untouched', stripBannedTerms(PROMPT, BANNED), PROMPT);
check(
  'standalone name is removed, "minor" is not',
  stripBannedTerms('wistful minor verses sung by MIN here', BANNED),
  'wistful minor verses sung by here',
);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
