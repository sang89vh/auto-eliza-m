import { migrate, selectSongsForRun, statusCounts, parseSongName, closeDb } from '../src/lib/db.js';
import { config } from '../src/lib/config.js';

console.log('DB_PATH =', config.dbPath);
migrate();
console.log('status counts after migrate:', statusCounts());

const songs = selectSongsForRun(5);
console.log(`\nselectSongsForRun(5) -> ${songs.length} rows`);
for (const song of songs) {
  const parsed = parseSongName(song.original_title, song.title);
  console.log(`  id=${song.id} status=${song.cafe_status} raw="${song.original_title}"`);
  console.log(`      -> title="${parsed.songTitle}" artist="${parsed.artist}" composer="${parsed.composer}" banned=[${parsed.bannedTerms.join(' | ')}]`);
}
closeDb();
