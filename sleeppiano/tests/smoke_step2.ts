import { closeDb, getSong, migrate, parseSongName, selectSongsForRun } from '../src/lib/db.js';
import { config } from '../src/lib/config.js';
import { step2GeneratePrompts } from '../src/pipeline/step2_prompts.js';
import { jaccard } from '../src/lib/similarity.js';
import { PROMPT_MAX_CHARS, PROMPT_MIN_CHARS } from '../src/lib/prompts.js';

migrate();
const songs = selectSongsForRun(2);
console.log(`Running STEP2 on ${songs.length} song(s) with ${config.openaiModel}\n`);

const summary = await step2GeneratePrompts(songs);
console.log('\nsummary:', summary);

let failures = 0;
for (const selected of songs) {
  const song = getSong(selected.id);
  if (!song) continue;
  const parsed = parseSongName(song.original_title, song.title);
  const prompts = [song.piano_prompt1 ?? '', song.piano_prompt2 ?? ''];

  console.log(`\n--- song ${song.id} "${song.original_title}" -> status ${song.piano_status}`);
  console.log(`piano_title       : ${song.piano_title}`);
  console.log(`piano_introduction: ${song.piano_introduction}`);

  prompts.forEach((prompt, index) => {
    const lengthOk = prompt.length >= PROMPT_MIN_CHARS && prompt.length <= PROMPT_MAX_CHARS;
    const leaks = parsed.bannedTerms.filter((term) => prompt.toLowerCase().includes(term.toLowerCase()));
    const ascii = !/[一-鿿À-ỹ]/.test(prompt);
    console.log(`prompt${index + 1} (${prompt.length} chars) len=${lengthOk ? 'OK' : 'BAD'} names=${leaks.length === 0 ? 'clean' : leaks.join(',')} english=${ascii ? 'yes' : 'NO'}`);
    console.log(`  ${prompt.slice(0, 150)}...`);
    if (!lengthOk || leaks.length > 0 || !ascii) failures++;
  });

  const titleLeaks = parsed.bannedTerms.filter((t) => (song.piano_title ?? '').toLowerCase().includes(t.toLowerCase()));
  if (titleLeaks.length > 0) { console.log(`  TITLE LEAK: ${titleLeaks.join(',')}`); failures++; }
  const self = jaccard(prompts[0]!, prompts[1]!);
  console.log(`prompt1 vs prompt2 Jaccard: ${self.toFixed(3)} ${self < 0.8 ? '(OK, distinct)' : '(TOO SIMILAR)'}`);
  if (self >= 0.8) failures++;
}

console.log(`\n=== ${failures === 0 ? 'ALL ACCEPTANCE CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
closeDb();
