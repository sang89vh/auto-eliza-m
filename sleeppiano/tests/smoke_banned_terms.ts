/**
 * Pure-logic regression test for the naming-policy matcher. No database, no network:
 * `npx tsx tests/smoke_banned_terms.ts`.
 *
 * Guards the bug that silently corrupted two saved prompts in the sibling vietcafe
 * pipeline: the artist "MIN" substring-matched "minor", so every style prompt was
 * rejected once and then had "min" deleted mid-word, leaving "wistful or verses"
 * where "wistful minor verses" had been written. Same matcher, same exposure here.
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

// A banned list in the shape parseSongName produces for "Bài Này Chill Phết - Đen, MIN".
const BANNED = ['Bài Này Chill Phết', 'Đen', 'MIN', 'Moonlit Autumn Piano'];

const PROMPT =
  'Solo piano sleep music, minimal left-hand movement, 58 BPM, wistful minor verses ' +
  'resolving into a calming major cadence, felt-damped upright piano, soft room tone, ' +
  'no percussion and no vocals, charming and unhurried, for deep rest.';

console.log('=== 1. A single-token banned term must not match inside an English word ===');
check('"MIN" vs minimal/minor/calming/charming', findBannedTerms(PROMPT, BANNED), []);
check('"LK" vs "folk"', findBannedTerms('gentle folk piano', ['LK']), []);
check('"Đen" vs "denim"', findBannedTerms('soft denim-warm tone', ['Đen']), []);

console.log('\n=== 2. It must still match when it stands alone ===');
check('standalone MIN', findBannedTerms('in the style of MIN, breathy', BANNED), ['MIN']);
check('standalone lowercase min', findBannedTerms('played by min', ['MIN']), ['MIN']);
check('MIN before punctuation', findBannedTerms('featuring MIN.', ['MIN']), ['MIN']);

console.log('\n=== 3. Multi-word terms keep the substring policy ===');
check('song title anywhere', findBannedTerms('a cover of Bài Này Chill Phết vibes', BANNED), [
  'Bài Này Chill Phết',
]);
check('title run together with a word', findBannedTerms('xMoonlit Autumn Pianox', BANNED), [
  'Moonlit Autumn Piano',
]);

console.log('\n=== 4. Stripping must not shred ordinary words ===');
check('prompt survives untouched', stripBannedTerms(PROMPT, BANNED), PROMPT);
check(
  'standalone name is removed, "minor" is not',
  stripBannedTerms('wistful minor verses played by MIN here', BANNED),
  'wistful minor verses played by here',
);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
