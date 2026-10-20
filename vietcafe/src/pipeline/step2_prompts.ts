import {
  allExistingPrompts,
  markSongError,
  parseSongName,
  savePrompts,
  type SongRow,
} from '../lib/db.js';
import { runLogger } from '../lib/logger.js';
import { generatePrompts, type PromptGenerationResult } from '../lib/openai.js';
import { config } from '../lib/config.js';
import {
  DIFFERENTIATE_HINT,
  DUPLICATE_THRESHOLD,
  LYRICS_MAX_CHARS,
  LYRICS_MIN_CHARS,
  PROMPT_MAX_CHARS,
  PROMPT_MIN_CHARS,
  RETRY_JSON_HINT,
} from '../lib/prompts.js';
import { maxSimilarity } from '../lib/similarity.js';

export interface Step2Summary {
  processed: number;
  skipped: number;
  errored: number;
}

const JSON_ATTEMPTS = 3;

const FALLBACK_TITLE = 'Nhạc Chill Quán Cà Phê Chiều Mưa';

/** Escapes a banned term so it can be used inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matcher for the ENGLISH style prompts. A multi-word term cannot land inside an
 * English word by accident, so those keep the original substring policy -- any
 * occurrence of the song title is deliberate and counts.
 *
 * A term that is a single token cannot. The artist "MIN" substring-matches "minor",
 * "minimal", "calming" and "charming"; "LK" matches "folk". That cost a wasted
 * regeneration per song AND, once stripBannedTerms ran, rewrote "wistful minor
 * verses" as "wistful or verses" in two saved prompts. Single tokens are therefore
 * matched as whole words -- \p{L} lookarounds rather than \b, which does not
 * understand đ/ă/ơ -- exactly as findBannedWords already does for Vietnamese.
 */
export function bannedTermPattern(term: string, flags: string): RegExp {
  const escaped = escapeRegExp(term);
  return /\s/.test(term)
    ? new RegExp(escaped, flags)
    : new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, `${flags}u`);
}

export function findBannedTerms(text: string, bannedTerms: string[]): string[] {
  return bannedTerms.filter((term) => term.length >= 2 && bannedTermPattern(term, 'i').test(text));
}

/**
 * Whole-word matcher for the VIETNAMESE lyrics and video title. Many banned artist
 * mononyms are ordinary Vietnamese words -- "Đen" (black) would substring-match
 * "cà phê đen" in almost any cafe lyric -- so only a standalone word counts.
 * JS \b does not understand đ/ă/ơ, hence the \p{L} lookarounds.
 */
function findBannedWords(text: string, bannedTerms: string[]): string[] {
  return bannedTerms.filter((term) => {
    if (term.length < 2) return false;
    return new RegExp(`(?<!\\p{L})${escapeRegExp(term)}(?!\\p{L})`, 'iu').test(text);
  });
}

/**
 * Last-resort remedy for the English prompts when a regeneration still leaks a name.
 * Uses the same pattern as findBannedTerms: stripping on a looser rule than the one
 * that raised the alarm is what shredded "minor" into "or".
 */
export function stripBannedTerms(text: string, bannedTerms: string[]): string {
  let cleaned = text;
  for (const term of bannedTerms) {
    cleaned = cleaned.replace(bannedTermPattern(term, 'gi'), '');
  }
  return cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

/** Whole-word removal for the Vietnamese title; never applied to the lyrics. */
function stripBannedWords(text: string, bannedTerms: string[]): string {
  let cleaned = text;
  for (const term of bannedTerms) {
    cleaned = cleaned.replace(new RegExp(`(?<!\\p{L})${escapeRegExp(term)}(?!\\p{L})`, 'giu'), '');
  }
  return cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([,.–-])/g, '$1').trim();
}

/** Trim to PROMPT_MAX_CHARS on a word boundary rather than mid-word. */
function truncateToLimit(text: string): string {
  if (text.length <= PROMPT_MAX_CHARS) return text;
  const cut = text.slice(0, PROMPT_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > PROMPT_MIN_CHARS ? cut.slice(0, lastSpace) : cut).replace(/[,\s]+$/, '');
}

function promptsOf(result: PromptGenerationResult): [string, string] {
  const variants = result.suno_prompts ?? [];
  const first = variants[0]?.style_prompt?.trim() ?? '';
  const second = variants[1]?.style_prompt?.trim() ?? '';
  return [first, second];
}

const VIETNAMESE_MARK = /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;
const SECTION_TAG = /\[(verse|chorus|bridge|intro|outro)/i;

/**
 * The lyrics are the product; a response without a singable Vietnamese lyric is
 * unusable no matter how good its style prompts are. Returns the reason a lyric
 * fails, or null when it passes.
 */
function lyricsProblem(lyrics: string): string | null {
  const trimmed = lyrics.trim();
  if (!trimmed) return 'lyrics are missing';
  if (trimmed.length < LYRICS_MIN_CHARS) return `lyrics are ${trimmed.length} chars, below the ${LYRICS_MIN_CHARS} minimum`;
  if (trimmed.length > LYRICS_MAX_CHARS) return `lyrics are ${trimmed.length} chars, above the ${LYRICS_MAX_CHARS} maximum`;
  if (!VIETNAMESE_MARK.test(trimmed)) return 'lyrics contain no Vietnamese diacritics';
  if (!SECTION_TAG.test(trimmed)) return 'lyrics have no [Verse]/[Chorus] section tags';
  return null;
}

/** Ask OpenAI for JSON, retrying up to JSON_ATTEMPTS times on a parse/shape failure. */
async function requestWithJsonRetries(userMessage: string, extraInstructions: string[]): Promise<PromptGenerationResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= JSON_ATTEMPTS; attempt += 1) {
    const instructions = attempt === 1 ? extraInstructions : [...extraInstructions, RETRY_JSON_HINT];
    try {
      const result = await generatePrompts(userMessage, instructions);
      const [first, second] = promptsOf(result);
      if (!first || !second) throw new Error('Response did not contain two suno_prompts entries');
      if (!result.lyrics?.trim()) throw new Error('Response did not contain lyrics');
      return result;
    } catch (error) {
      lastError = error;
      runLogger.warn(
        `OpenAI attempt ${attempt}/${JSON_ATTEMPTS} unusable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function processSong(song: SongRow, position: number, total: number): Promise<'ok' | 'error'> {
  const parsed = parseSongName(song.original_title, song.title);
  const userMessage = `${parsed.songTitle} – ${parsed.artist} – ${parsed.composer}`;
  const label = `${position}/${total} ${parsed.songTitle}`;

  try {
    let result = await requestWithJsonRetries(userMessage, []);
    let [prompt1, prompt2] = promptsOf(result);
    let lyrics = (result.lyrics ?? '').trim();

    // Validation: length, then the hard naming rule (substring policy for the
    // English prompts, whole-word policy for the Vietnamese lyrics).
    const invalid = (text: string): boolean =>
      text.length < PROMPT_MIN_CHARS ||
      text.length > PROMPT_MAX_CHARS ||
      findBannedTerms(text, parsed.bannedTerms).length > 0;

    const lyricsIssue = (): string | null =>
      lyricsProblem(lyrics) ??
      (findBannedWords(lyrics, parsed.bannedTerms).length > 0
        ? `lyrics contain banned term(s): ${findBannedWords(lyrics, parsed.bannedTerms).join(', ')}`
        : null);

    const firstPassIssue = lyricsIssue();
    if (invalid(prompt1) || invalid(prompt2) || firstPassIssue) {
      runLogger.warn(`[STEP2] ${label} – output failed validation (${firstPassIssue ?? 'style prompts'}), regenerating once`);
      result = await requestWithJsonRetries(userMessage, [
        `The previous attempt was rejected${firstPassIssue ? ` because: ${firstPassIssue}` : ''}. ` +
          `Each style_prompt must be ${PROMPT_MIN_CHARS}-${PROMPT_MAX_CHARS} characters of English style description. ` +
          `The lyrics must be ${LYRICS_MIN_CHARS}-${LYRICS_MAX_CHARS} characters of original Vietnamese with [Verse]/[Chorus] section tags. ` +
          `None of these words may appear anywhere in the prompts, the lyrics, or the title: ${parsed.bannedTerms.join(', ')}.`,
      ]);
      [prompt1, prompt2] = promptsOf(result);
      lyrics = (result.lyrics ?? '').trim();
    }

    // Whatever survives the regeneration is repaired rather than discarded.
    for (const [index, value] of [prompt1, prompt2].entries()) {
      let cleaned = value;
      const leaked = findBannedTerms(cleaned, parsed.bannedTerms);
      if (leaked.length > 0) {
        cleaned = stripBannedTerms(cleaned, parsed.bannedTerms);
        runLogger.warn(`[STEP2] ${label} – stripped banned term(s) from prompt${index + 1}: ${leaked.join(', ')}`);
      }
      cleaned = truncateToLimit(cleaned);
      if (cleaned.length < PROMPT_MIN_CHARS) {
        runLogger.warn(`[STEP2] ${label} – prompt${index + 1} is ${cleaned.length} chars, below the ${PROMPT_MIN_CHARS} minimum`);
      }
      if (index === 0) prompt1 = cleaned;
      else prompt2 = cleaned;
    }

    // Lyrics are never word-stripped -- deleting words mid-verse leaves an unsingable
    // text. A structural failure is fatal for the song; a residual banned word after
    // one regeneration is accepted and logged.
    const structural = lyricsProblem(lyrics);
    if (structural) throw new Error(`Lyrics unusable after regeneration: ${structural}`);
    const leakedWords = findBannedWords(lyrics, parsed.bannedTerms);
    if (leakedWords.length > 0) {
      runLogger.warn(`[STEP2] ${label} – lyrics still contain banned word(s) after regeneration, accepting: ${leakedWords.join(', ')}`);
    }

    // Duplicate check against every prompt already in the database, plus the two
    // this call just produced (they must differ from each other too).
    const existing = allExistingPrompts(song.id);
    const nearest1 = maxSimilarity(prompt1, existing);
    const nearest2 = maxSimilarity(prompt2, [...existing, prompt1]);
    const worst = Math.max(nearest1?.score ?? 0, nearest2?.score ?? 0);

    if (worst >= DUPLICATE_THRESHOLD) {
      runLogger.warn(`[STEP2] ${label} – Jaccard ${worst.toFixed(2)} vs an existing prompt, regenerating once`);
      const retry = await requestWithJsonRetries(userMessage, [DIFFERENTIATE_HINT]);
      const [retry1, retry2] = promptsOf(retry);
      // The second result is accepted regardless; only log if it is still close.
      prompt1 = truncateToLimit(stripBannedTerms(retry1, parsed.bannedTerms));
      prompt2 = truncateToLimit(stripBannedTerms(retry2, parsed.bannedTerms));
      // Its lyrics replace the previous ones only when they are structurally sound;
      // otherwise the already-validated lyrics stay.
      const retryLyrics = (retry.lyrics ?? '').trim();
      if (!lyricsProblem(retryLyrics)) lyrics = retryLyrics;
      result = retry;

      const after = Math.max(
        maxSimilarity(prompt1, existing)?.score ?? 0,
        maxSimilarity(prompt2, [...existing, prompt1])?.score ?? 0,
      );
      if (after >= DUPLICATE_THRESHOLD) {
        runLogger.warn(`[STEP2] ${label} – still similar after regeneration (Jaccard ${after.toFixed(2)}), accepting anyway`);
      }
    }

    const cafeTitle = (result.video_title_suggestion ?? '').trim();
    const introduction = (result.analysis?.summary ?? '').trim();

    if (!cafeTitle) throw new Error('Response had no video_title_suggestion');

    // The naming policy applies to the video title too. The title is Vietnamese, so
    // the whole-word policy applies, and stripping removes whole words only.
    const titleLeak = findBannedWords(cafeTitle, parsed.bannedTerms);
    const safeTitle = titleLeak.length > 0 ? stripBannedWords(cafeTitle, parsed.bannedTerms) : cafeTitle;
    if (titleLeak.length > 0) {
      runLogger.warn(`[STEP2] ${label} – stripped banned word(s) from the suggested title: ${titleLeak.join(', ')}`);
    }

    savePrompts(song.id, {
      cafeTitle: safeTitle || FALLBACK_TITLE,
      prompt1,
      prompt2,
      lyrics,
      introduction,
    });

    runLogger.info(`[STEP2] ${label} – prompts and lyrics saved`);
    return 'ok';
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    markSongError(song.id, `STEP2: ${detail}`);
    runLogger.error(`[STEP2] ${label} – failed, marked ERROR: ${detail}`);
    return 'error';
  }
}

/**
 * STEP 2 -- turn each selected song into two Suno style prompts, one original
 * Vietnamese lyric, and metadata.
 *
 * Songs already at PROMPTED are skipped, which is what makes a re-run after a crash
 * resume rather than pay for the same prompts twice.
 */
export async function step2GeneratePrompts(songs: SongRow[]): Promise<Step2Summary> {
  runLogger.setStep('STEP2');

  const pending = songs.filter((song) => song.cafe_status !== 'PROMPTED');
  const skipped = songs.length - pending.length;
  if (skipped > 0) runLogger.info(`Skipping ${skipped} song(s) already at PROMPTED`);
  if (pending.length === 0) return { processed: 0, skipped, errored: 0 };

  runLogger.info(`Generating prompts for ${pending.length} song(s) with ${config.openaiModel} (concurrency ${config.openaiConcurrency})`);

  let processed = 0;
  let errored = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const index = cursor;
      cursor += 1;
      const song = pending[index];
      if (!song) return;
      const outcome = await processSong(song, index + 1, pending.length);
      if (outcome === 'ok') processed += 1;
      else errored += 1;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(config.openaiConcurrency, pending.length) }, () => worker()),
  );

  runLogger.info(`[STEP2] done: ${processed} prompted, ${errored} errored, ${skipped} skipped`);
  return { processed, skipped, errored };
}
