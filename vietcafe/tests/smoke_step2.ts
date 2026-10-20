import { closeDb, getSong, migrate, parseSongName, selectSongsForRun } from '../src/lib/db.js';
import { config } from '../src/lib/config.js';
import { step2GeneratePrompts } from '../src/pipeline/step2_prompts.js';
import { jaccard } from '../src/lib/similarity.js';
import { LYRICS_MAX_CHARS, LYRICS_MIN_CHARS, PROMPT_MAX_CHARS, PROMPT_MIN_CHARS } from '../src/lib/prompts.js';

/** Whole-word check, mirroring step2's policy for Vietnamese text. */
function bannedWords(text: string, terms: string[]): string[] {
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return terms.filter((t) => t.length >= 2 && new RegExp(`(?<!\\p{L})${esc(t)}(?!\\p{L})`, 'iu').test(text));
}

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
  const prompts = [song.cafe_prompt1 ?? '', song.cafe_prompt2 ?? ''];

  console.log(`\n--- song ${song.id} "${song.original_title}" -> status ${song.cafe_status}`);
  console.log(`cafe_title       : ${song.cafe_title}`);
  console.log(`cafe_introduction: ${song.cafe_introduction}`);

  prompts.forEach((prompt, index) => {
    const lengthOk = prompt.length >= PROMPT_MIN_CHARS && prompt.length <= PROMPT_MAX_CHARS;
    const leaks = parsed.bannedTerms.filter((term) => prompt.toLowerCase().includes(term.toLowerCase()));
    const ascii = !/[一-鿿À-ỹ]/.test(prompt);
    console.log(`prompt${index + 1} (${prompt.length} chars) len=${lengthOk ? 'OK' : 'BAD'} names=${leaks.length === 0 ? 'clean' : leaks.join(',')} english=${ascii ? 'yes' : 'NO'}`);
    console.log(`  ${prompt.slice(0, 150)}...`);
    if (!lengthOk || leaks.length > 0 || !ascii) failures++;
  });

  const titleLeaks = bannedWords(song.cafe_title ?? '', parsed.bannedTerms);
  if (titleLeaks.length > 0) { console.log(`  TITLE LEAK: ${titleLeaks.join(',')}`); failures++; }

  // The lyrics contract: present, inside the window, Vietnamese, structured.
  const lyrics = (song.cafe_lyrics ?? '').trim();
  const lyricsLengthOk = lyrics.length >= LYRICS_MIN_CHARS && lyrics.length <= LYRICS_MAX_CHARS;
  const lyricsViet = /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(lyrics);
  const lyricsTagged = /\[(verse|chorus|bridge)/i.test(lyrics);
  console.log(
    `lyrics (${lyrics.length} chars) len=${lyricsLengthOk ? 'OK' : 'BAD'} vietnamese=${lyricsViet ? 'yes' : 'NO'} sections=${lyricsTagged ? 'yes' : 'NO'}`,
  );
  console.log(`  ${lyrics.slice(0, 120).replace(/\n/g, ' / ')}...`);
  if (!lyricsLengthOk || !lyricsViet || !lyricsTagged) failures++;
  // A whole-word leak is accepted by step2 after one regeneration -- report, don't fail.
  const lyricLeaks = bannedWords(lyrics, parsed.bannedTerms);
  if (lyricLeaks.length > 0) console.log(`  note: lyrics contain banned word(s), accepted by policy: ${lyricLeaks.join(',')}`);
  const self = jaccard(prompts[0]!, prompts[1]!);
  console.log(`prompt1 vs prompt2 Jaccard: ${self.toFixed(3)} ${self < 0.8 ? '(OK, distinct)' : '(TOO SIMILAR)'}`);
  if (self >= 0.8) failures++;
}

console.log(`\n=== ${failures === 0 ? 'ALL ACCEPTANCE CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
closeDb();
