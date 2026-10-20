import { config } from '../lib/config.js';
import { resetErroredSongs, selectSongsForRun, type SongRow } from '../lib/db.js';
import { runLogger } from '../lib/logger.js';

export class NoSongsError extends Error {}

/**
 * STEP 1 -- pick up to MAX_SONGS_PER_RUN songs to work on.
 *
 * PROMPTED songs come first: they are leftovers whose prompts were already paid
 * for in an earlier run but which were not needed to reach the two-hour target.
 */
export function step1SelectSongs(): SongRow[] {
  runLogger.setStep('STEP1');

  if (config.retryErrors) {
    const reset = resetErroredSongs();
    if (reset > 0) runLogger.info(`RETRY_ERRORS is on: ${reset} song(s) moved out of ERROR back to their last good status`);
  }

  const songs = selectSongsForRun(config.maxSongsPerRun);
  if (songs.length === 0) {
    throw new NoSongsError('No songs with status INIT/PROMPTED');
  }

  const prompted = songs.filter((song) => song.cafe_status === 'PROMPTED').length;
  runLogger.info(
    `Selected ${songs.length} song(s) (${prompted} leftover PROMPTED first, ${songs.length - prompted} new INIT)`,
  );
  return songs;
}
