import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from 'playwright';
import { anyVisible, captureScreenshot, firstVisible, launchPersistentContext } from '../lib/browser.js';
import { config } from '../lib/config.js';
import { getSong, markSongError, parseJsonPaths, saveAudio, type SongRow } from '../lib/db.js';
import { probeDuration } from '../lib/ffmpeg.js';
import { runLogger } from '../lib/logger.js';
import { randomDelay, sleep } from '../lib/retry.js';
import type { RunFolder } from '../lib/runFolder.js';
import { SUNO_CREATE_URL, sunoSelectors } from '../lib/sunoSelectors.js';
import { StudioDownloader, SunoStudioError } from '../lib/sunoStudio.js';

export interface Step3Summary {
  tracksGenerated: number;
  totalDurationSec: number;
  errored: number;
  reachedTarget: boolean;
}

/** Suno refusing to generate at all is a run-level problem, not a per-song one. */
export class SunoCreditsError extends Error {}

/**
 * The create form cannot be put into instrumental shape. Run-level as well: every song
 * would hit it the same way, and generating anyway would spend credits on vocal tracks.
 */
export class SunoFormError extends Error {}

const GENERATION_TIMEOUT_MS = 10 * 60_000;

/** Every row of the download dialog's format list, in the order Suno renders them. */
const DOWNLOAD_FORMAT_LABELS = ['M4A', 'MP3', 'WAV', 'MP4 video asset'] as const;

export async function openCreatePage(context: BrowserContext, logsDir: string): Promise<Page> {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(SUNO_CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(4000);

  const signedOut = await anyVisible(page, sunoSelectors.signedOutMarkers, 4000);
  if (signedOut) {
    await captureScreenshot(page, logsDir, 'suno_signed_out');
    throw new Error('Suno is not signed in on this profile. Run `npm run setup:login` and sign in to Suno.');
  }

  // suno.com/create serves a marketing shell until the app hydrates, and that shell is
  // indistinguishable from the editor by generic controls. Wait for something only the
  // real editor renders before handing the page to the form logic: a run once spent 30s
  // against an un-hydrated shell and failed reporting a missing Instrumental toggle,
  // which sent the investigation after selectors that were never broken.
  const ready = await anyVisible(page, sunoSelectors.signedInMarkers, 60_000);
  if (!ready) {
    await captureScreenshot(page, logsDir, 'suno_create_page_not_ready');
    throw new Error(
      'The Suno create form never rendered within 60s. Either this profile is signed out ' +
        '(run `npm run setup:login`) or the page failed to load — see the screenshot.',
    );
  }
  return page;
}

/**
 * Some Suno controls render below the fold in a container the page will not scroll,
 * with a sticky section header painted over them, so a real click is
 * intercepted -- and `force: true` lands on the overlay and silently does nothing,
 * which is worse than failing. A DOM-level click reaches the handler regardless of
 * what is on top. Callers verify the resulting state rather than trusting the click.
 */
async function clickThrough(page: Page, locator: Locator): Promise<void> {
  try {
    await locator.click({ timeout: 3000 });
  } catch {
    await locator.evaluate((el) => (el as unknown as { click: () => void }).click()).catch(() => undefined);
  }
  await page.waitForTimeout(1000);
}

/**
 * Instrumental, the way Suno asks for it since 2026-09-11: there is no Instrumental
 * control left, only a lyrics editor whose placeholder says to leave it empty for an
 * instrumental. So a leftover draft is cleared, and the editor's text is read back
 * rather than trusted -- anything short of a confirmed-empty editor would spend credits
 * on tracks with vocals. Runs when the form is configured and again before every Create.
 */
async function ensureLyricsEmpty(page: Page, logsDir: string): Promise<void> {
  // A collapsed Lyrics section puts the editor out of reach of a click, so open it first.
  const header = await anyVisible(page, sunoSelectors.lyricsSectionHeader, 1000);
  if (header && (await header.getAttribute('aria-expanded')) === 'false') await clickThrough(page, header);

  const editor = await anyVisible(page, sunoSelectors.lyricsInput, 8000);
  if (!editor) {
    await captureScreenshot(page, logsDir, 'suno_no_lyrics_editor');
    throw new SunoFormError(
      'The Suno lyrics editor never appeared under the Advanced tab, so an instrumental (empty-lyrics) request cannot be verified; update sunoSelectors.ts',
    );
  }

  // An empty editor still holds one blank paragraph, which reads back as "\n". A failed
  // read is null, which counts as not empty.
  const lyricsText = async (): Promise<string | null> =>
    (await editor.innerText({ timeout: 3000 }).catch(() => null))?.trim() ?? null;
  if ((await lyricsText()) === '') return;

  runLogger.warn('Suno: the lyrics editor is not empty; clearing it so the tracks stay instrumental');
  await editor.click({ timeout: 5000 }).catch(() => undefined);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
  if ((await lyricsText()) !== '') {
    await editor.fill('').catch(() => undefined);
    await page.waitForTimeout(500);
  }
  if ((await lyricsText()) !== '') {
    await captureScreenshot(page, logsDir, 'suno_lyrics_not_cleared');
    throw new SunoFormError(
      'The Suno lyrics editor could not be cleared — every track would be generated with vocals; update sunoSelectors.ts',
    );
  }
}

/**
 * Advanced tab ON, lyrics editor empty, Styles box present. State is read before
 * clicking rather than clicked blindly, and the read also tells us whether the click
 * took.
 */
export async function configureCreateForm(page: Page, logsDir: string): Promise<void> {
  const isOn = async (selectors: readonly string[]): Promise<boolean | null> => {
    const locator = await anyVisible(page, selectors, 3000);
    if (!locator) return null;
    const pressed = await locator.getAttribute('aria-pressed').catch(() => null);
    if (pressed !== null) return pressed === 'true';
    const checked = await locator.getAttribute('aria-checked').catch(() => null);
    if (checked !== null) return checked === 'true';
    const selected = await locator.getAttribute('aria-selected').catch(() => null);
    if (selected !== null) return selected === 'true';
    const dataState = await locator.getAttribute('data-state').catch(() => null);
    if (dataState !== null) return dataState === 'on' || dataState === 'checked';
    return null;
  };

  // Run 29 on 2026-09-11 was screenshotted with the v6 model menu open over the form,
  // and an open menu swallows the clicks below.
  await page.keyboard.press('Escape').catch(() => undefined);

  // Advanced mode: the Styles box and the lyrics editor exist only there. `false` means
  // the tab exists but is not the active one; `null` means the control was found
  // without a readable state. Selecting a tab is idempotent, so both are safe to click.
  const advancedState = await isOn(sunoSelectors.advancedModeTab);
  if (advancedState !== true) {
    const tab = await anyVisible(page, sunoSelectors.advancedModeTab, 10_000);
    if (tab) {
      await clickThrough(page, tab);
      await page.waitForTimeout(500);
    } else {
      runLogger.warn('Could not find the Suno Advanced-mode tab; continuing on whichever mode is active');
      await captureScreenshot(page, logsDir, 'suno_no_advanced_tab');
    }
  }

  // Neither check below can pass outside the Advanced tab, so together they also prove
  // that the tab switch took.
  await ensureLyricsEmpty(page, logsDir);

  // Every prompt is typed into the style field, so if it is missing the run cannot do
  // anything useful. Failing here costs one screenshot; discovering it per song costs a
  // 20s timeout and an ERROR row for all of them.
  if (!(await anyVisible(page, sunoSelectors.styleInput, 8000))) {
    await captureScreenshot(page, logsDir, 'suno_no_style_input');
    throw new Error(
      'The Suno style field never appeared after selecting Advanced mode — the UI has changed; update sunoSelectors.ts',
    );
  }
}

/** Matches every layout's row container in one CSS list. */
const TRACK_ROW_SELECTOR = sunoSelectors.trackRows.join(', ');

/** The clip id as it appears in a row's link to the song page. */
const CLIP_ID_IN_HREF = /\/song\/([0-9a-f-]{36})/i;

/**
 * Addresses one clip's row. The current workspace carries the id only inside the row's
 * `/song/<uuid>` link; the older layout exposed it as `data-clip-id` on the row itself,
 * which is kept as a second alternative.
 */
function clipRowSelector(clipId: string): string {
  return `[data-testid="clip-row"]:has(a[href*="${clipId}"]), [data-clip-id="${clipId}"]`;
}

/** `firstVisible`, scoped to an already-located row rather than the whole page. */
async function firstVisibleIn(root: Locator, selectors: readonly string[], timeoutMs: number): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const candidate = root.locator(selector).first();
      if (await candidate.isVisible({ timeout: 300 }).catch(() => false)) return candidate;
    }
    await sleep(300);
  }
  throw new Error(
    `None of these selectors became visible inside the clip row within ` +
      `${Math.round(timeoutMs / 1000)}s: ${selectors.join(' | ')}`,
  );
}

/** Stable identifiers of the tracks currently listed, so new ones can be told apart. */
async function currentClipIds(page: Page): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    for (const row of await page.locator(TRACK_ROW_SELECTOR).all()) {
      const legacy = await row.getAttribute('data-clip-id').catch(() => null);
      if (legacy) {
        ids.add(legacy);
        continue;
      }
      const href = await row.locator('a[href*="/song/"]').first().getAttribute('href').catch(() => null);
      const match = href?.match(CLIP_ID_IN_HREF);
      if (match?.[1]) ids.add(match[1]);
    }
  } catch {
    // A re-render mid-enumeration just means this poll returns what it managed to read.
  }
  return ids;
}

async function submitPrompt(page: Page, prompt: string, logsDir: string): Promise<void> {
  // The Studio tab takes the foreground for every download; the form is typed here.
  await page.bringToFront().catch(() => undefined);
  // Defensive: a dialog left over from anything earlier would silently intercept every
  // click below, and the resulting timeout would name the style field, not the modal.
  await dismissModals(page);
  const styleField = await firstVisible(page, sunoSelectors.styleInput, 20_000);
  await styleField.click();
  await styleField.fill('');
  await styleField.fill(prompt);
  await page.waitForTimeout(800);

  // Cheap to repeat before every Create, and the last chance to catch lyrics that
  // appeared since configureCreateForm before credits go on a vocal track.
  await ensureLyricsEmpty(page, logsDir);

  const credits = await anyVisible(page, sunoSelectors.outOfCreditsMarkers, 1000);
  if (credits) {
    await captureScreenshot(page, logsDir, 'suno_out_of_credits');
    throw new SunoCreditsError('Suno reports insufficient credits');
  }

  const createButton = await firstVisible(page, sunoSelectors.createButton, 15_000);
  await createButton.click();
  await page.waitForTimeout(3000);

  const creditsAfter = await anyVisible(page, sunoSelectors.outOfCreditsMarkers, 3000);
  if (creditsAfter) {
    await captureScreenshot(page, logsDir, 'suno_out_of_credits_after_submit');
    throw new SunoCreditsError('Suno reports insufficient credits');
  }
}

/** Poll until the clips this submission created reach a completed state. */
async function waitForNewClips(page: Page, before: Set<string>, logsDir: string): Promise<string[]> {
  const deadline = Date.now() + GENERATION_TIMEOUT_MS;
  let lastCount = 0;

  while (Date.now() < deadline) {
    const now = await currentClipIds(page);
    const fresh = [...now].filter((id) => !before.has(id));

    if (fresh.length !== lastCount) {
      runLogger.info(`Suno: ${fresh.length} new track(s) appeared`);
      lastCount = fresh.length;
    }

    if (fresh.length > 0) {
      const settled: string[] = [];
      for (const clipId of fresh) {
        const row = page.locator(clipRowSelector(clipId)).first();
        // The row publishes its own progress ("streaming" while it is still being
        // produced, "complete" when finished); fall back to spotting a spinner only
        // where that attribute does not exist.
        const status = await row.getAttribute('data-clip-status').catch(() => null);
        if (status !== null) {
          if (status === 'complete') settled.push(clipId);
          continue;
        }
        const pending = await Promise.all(
          sunoSelectors.rowPendingMarkers.map((marker) =>
            row.locator(marker).first().isVisible({ timeout: 300 }).catch(() => false),
          ),
        );
        if (!pending.some(Boolean)) settled.push(clipId);
      }
      // Suno yields two outputs per generation; take them once both have settled,
      // or once the deadline is close enough that one is better than none.
      if (settled.length >= fresh.length && settled.length > 0) return settled;
    }

    await sleep(5000);
  }

  await captureScreenshot(page, logsDir, 'suno_generation_timeout');
  throw new Error(`Suno generation did not complete within ${GENERATION_TIMEOUT_MS / 60_000} minutes`);
}

/**
 * Closes any modal left standing. Suno's dialogs put a `.modal-overlay` across the whole
 * page, so one that is never dismissed silently blocks every later click -- in the sibling
 * vietcafe pipeline a failed download made the NEXT song fail with a timeout that named
 * the lyrics editor and gave no hint about the real cause.
 */
async function dismissModals(page: Page): Promise<void> {
  const overlay = page.locator(sunoSelectors.modalOverlay.join(', '));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await overlay.count().catch(() => 0)) === 0) return;
    await page.keyboard.press('Escape').catch(() => undefined);
    await sleep(500);
  }
  const remaining = await overlay.count().catch(() => 0);
  if (remaining > 0) {
    runLogger.warn(`Suno: ${remaining} modal overlay(s) would not close; reloading the create page`);
    await page.goto(SUNO_CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => undefined);
    await page.waitForTimeout(4000);
  }
}

/**
 * Picks exactly one download format in the modal, preferring WAV.
 *
 * The list is multi-select with MP3 pre-selected, so simply clicking WAV leaves BOTH
 * selected and Suno then sends two files. Playwright claims only the first `download`
 * event, and the second copy is left behind in DOWNLOAD_DIR under a bare GUID name --
 * the vietcafe pipeline accumulated exactly such a pair (a 45 MB WAV and a 5.6 MB MP3).
 * So deselect everything that is not wanted, then confirm the wanted row took.
 */
async function selectDownloadFormat(dialog: Locator, logsDir: string, page: Page, clipId: string): Promise<'wav' | 'mp3'> {
  const isSelected = async (row: Locator): Promise<boolean> =>
    ((await row.getAttribute('class').catch(() => '')) ?? '').includes(sunoSelectors.downloadFormatSelectedMarker);

  const rowFor = (label: string): Locator => dialog.locator(sunoSelectors.downloadFormatRow(label)).first();

  for (const preferred of ['WAV', 'MP3'] as const) {
    const wanted = rowFor(preferred);
    if (!(await wanted.isVisible({ timeout: 4000 }).catch(() => false))) continue;

    if (!(await isSelected(wanted))) await wanted.click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(400);

    // Clear every other row so exactly one file is produced.
    for (const other of DOWNLOAD_FORMAT_LABELS) {
      if (other === preferred) continue;
      const row = rowFor(other);
      if (await row.isVisible({ timeout: 500 }).catch(() => false)) {
        if (await isSelected(row)) {
          await row.click({ timeout: 5000 }).catch(() => undefined);
          await page.waitForTimeout(300);
        }
      }
    }

    // WAV is gated on some plans; if the row refused to take, fall through to MP3.
    if (await isSelected(wanted)) return preferred === 'WAV' ? 'wav' : 'mp3';
    runLogger.warn(`Suno: the ${preferred} row would not select for clip ${clipId}`);
  }

  await captureScreenshot(page, logsDir, `suno_no_download_format_${clipId}`);
  throw new Error('Neither a WAV nor an MP3 download format could be selected in the dialog');
}

/**
 * The library download: the row's overflow menu -> Download -> WAV (or MP3). Every
 * call spends one of the account's monthly library downloads (Pro 20, Premier 60),
 * so this is only used when SUNO_DOWNLOAD_VIA=library; the default goes through
 * Suno Studio, which is exempt from that cap (see lib/sunoStudio.ts).
 *
 * Exported so the download flow can be exercised against the live site without
 * running a whole generation.
 */
export async function downloadClipViaLibrary(
  page: Page,
  clipId: string,
  targetBase: string,
  logsDir: string,
): Promise<string | null> {
  const row = page.locator(clipRowSelector(clipId)).first();

  try {
    // The overflow button is a hover affordance on the row.
    await row.hover().catch(() => undefined);
    const moreButton = await firstVisibleIn(row, sunoSelectors.rowMoreButton, 10_000);
    await clickThrough(page, moreButton);

    const downloadEntry = await anyVisible(page, sunoSelectors.downloadMenuItem, 5000);
    if (downloadEntry) {
      await downloadEntry.click();
      await page.waitForTimeout(800);
    }

    // The dialog shows a spinner before its contents exist, so wait for the button that
    // actually starts the transfer rather than for a fixed pause.
    const confirmButton = await firstVisible(page, sunoSelectors.downloadConfirmButton, 60_000);
    const dialog = await firstVisible(page, sunoSelectors.downloadDialog, 10_000);
    const chosenExtension = await selectDownloadFormat(dialog, logsDir, page, clipId);

    const downloadPromise = page.waitForEvent('download', { timeout: 5 * 60_000 });
    await confirmButton.click();

    const download = await downloadPromise;
    const suggested = download.suggestedFilename();
    const extension = (path.extname(suggested).replace('.', '') || chosenExtension).toLowerCase();
    const targetPath = `${targetBase}.${extension}`;

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    await download.saveAs(targetPath);
    // saveAs copies rather than moves, so Playwright's own copy in downloadsPath would
    // otherwise sit there forever -- doubling the disk cost of every track kept.
    await download.delete().catch(() => undefined);
    return targetPath;
  } catch (error) {
    runLogger.warn(`Download of clip ${clipId} failed: ${error instanceof Error ? error.message : String(error)}`);
    await captureScreenshot(page, logsDir, `suno_download_failed_${clipId}`).catch(() => undefined);
    return null;
  } finally {
    // Whatever happened, the next song must not inherit an open dialog.
    await dismissModals(page);
  }
}

/** Keep only tracks in the 1.5-6 minute window; anything corrupt probes as 0. */
async function keepIfUsable(filePath: string): Promise<number | null> {
  try {
    const duration = await probeDuration(filePath);
    if (duration < config.trackMinSeconds || duration > config.trackMaxSeconds) {
      runLogger.warn(
        `Discarding ${path.basename(filePath)}: ${duration.toFixed(1)}s is outside ` +
          `${config.trackMinSeconds}-${config.trackMaxSeconds}s`,
      );
      fs.rmSync(filePath, { force: true });
      return null;
    }
    return duration;
  } catch (error) {
    runLogger.warn(`Discarding unreadable ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
    fs.rmSync(filePath, { force: true });
    return null;
  }
}

/**
 * STEP 3 -- drive Suno until roughly DAILY_TARGET_MINUTES of audio has been downloaded.
 *
 * The stop condition is evaluated after every individual download, not after every
 * song, so a generation that overshoots the target does not keep going.
 */
export async function step3GenerateAudio(songs: SongRow[], runFolder: RunFolder): Promise<Step3Summary> {
  runLogger.setStep('STEP3');

  const targetSeconds = config.dailyTargetMinutes * 60;

  // Songs already past Step 3 count toward the target -- that is what makes a
  // re-run after a crash continue rather than regenerate.
  const alreadyDone = songs.filter(
    (song) => song.piano_status === 'GENERATED' || song.piano_status === 'CONVERTED',
  );
  let totalSeconds = alreadyDone.reduce((sum, song) => sum + (song.piano_duration_sec ?? 0), 0);
  let tracksGenerated = alreadyDone.length;
  let errored = 0;

  if (alreadyDone.length > 0) {
    runLogger.info(
      `Resuming with ${alreadyDone.length} song(s) already downloaded (${(totalSeconds / 60).toFixed(1)} min)`,
    );
  }

  if (totalSeconds >= targetSeconds) {
    runLogger.info(`Target of ${config.dailyTargetMinutes} min already met before any new generation`);
    return { tracksGenerated, totalDurationSec: totalSeconds, errored, reachedTarget: true };
  }

  const queue = songs.filter((song) => song.piano_status === 'PROMPTED' && song.piano_prompt1);
  if (queue.length === 0) {
    runLogger.warn('No PROMPTED songs with a prompt available for Suno');
    return { tracksGenerated, totalDurationSec: totalSeconds, errored, reachedTarget: false };
  }

  const context = await launchPersistentContext(config.sunoProfileDir, { downloadDir: config.downloadDir });
  const studio = config.sunoDownloadVia === 'studio' ? new StudioDownloader(context, runFolder.logs) : null;

  try {
    const page = await openCreatePage(context, runFolder.logs);
    await configureCreateForm(page, runFolder.logs);

    // Before any credit is spent: if Studio is unavailable, no download will be either,
    // and there is deliberately no silent fallback to the capped library download.
    if (studio) await studio.verifyAccess();
    else runLogger.warn("SUNO_DOWNLOAD_VIA=library: every download counts against Suno's monthly download cap");

    const fetchClip = (clipId: string, targetBase: string): Promise<string | null> =>
      studio ? studio.download(clipId, targetBase) : downloadClipViaLibrary(page, clipId, targetBase, runFolder.logs);

    let lastSong: SongRow | null = null;

    for (const [index, song] of queue.entries()) {
      if (totalSeconds >= targetSeconds) break;

      const label = `${index + 1}/${queue.length} song ${song.id}`;
      try {
        const before = await currentClipIds(page);
        runLogger.info(`[STEP3] ${label} – submitting prompt (${(totalSeconds / 60).toFixed(1)}/${config.dailyTargetMinutes} min so far)`);
        await submitPrompt(page, song.piano_prompt1 as string, runFolder.logs);

        const clipIds = await waitForNewClips(page, before, runFolder.logs);
        const keptPaths: string[] = [];
        let songSeconds = 0;

        for (const [variantIndex, clipId] of clipIds.entries()) {
          const targetBase = path.join(config.downloadDir, `${song.id}_${variantIndex + 1}`);
          const downloaded = await fetchClip(clipId, targetBase);
          if (!downloaded) continue;

          const duration = await keepIfUsable(downloaded);
          if (duration === null) continue;

          keptPaths.push(downloaded);
          songSeconds += duration;
          totalSeconds += duration;
          tracksGenerated += 1;
          runLogger.info(
            `[STEP3] ${label} – kept ${path.basename(downloaded)} (${(duration / 60).toFixed(1)} min); ` +
              `total ${(totalSeconds / 60).toFixed(1)}/${config.dailyTargetMinutes} min`,
          );

          // Stop condition is checked after each download, not each song.
          if (totalSeconds >= targetSeconds) break;
        }

        if (keptPaths.length === 0) {
          throw new Error('No usable audio was downloaded for this generation');
        }

        saveAudio(song.id, keptPaths, songSeconds);
        lastSong = song;
      } catch (error) {
        if (error instanceof SunoCreditsError || error instanceof SunoStudioError || error instanceof SunoFormError) {
          // Run-level: the song keeps its PROMPTED status and its prompts for the next run.
          runLogger.error(`[STEP3] aborting Suno step: ${error.message}`);
          break;
        }
        errored += 1;
        const detail = error instanceof Error ? error.message : String(error);
        markSongError(song.id, `STEP3: ${detail}`);
        runLogger.error(`[STEP3] ${label} – failed, marked ERROR: ${detail}`);
      }

      if (totalSeconds < targetSeconds && index < queue.length - 1) {
        await randomDelay(10_000, 20_000);
      }
    }

    // A last top-up using the second prompt of the song just generated, when the
    // queue ran out just short of the target.
    if (config.usePrompt2WhenShort && totalSeconds < targetSeconds && lastSong?.piano_prompt2) {
      const shortfallMinutes = (targetSeconds - totalSeconds) / 60;
      runLogger.info(`[STEP3] ${shortfallMinutes.toFixed(1)} min short — submitting prompt2 of song ${lastSong.id}`);
      try {
        const before = await currentClipIds(page);
        await submitPrompt(page, lastSong.piano_prompt2, runFolder.logs);
        const clipIds = await waitForNewClips(page, before, runFolder.logs);

        const existingPaths: string[] = [];
        let extraSeconds = 0;
        for (const [variantIndex, clipId] of clipIds.entries()) {
          const targetBase = path.join(config.downloadDir, `${lastSong.id}_p2_${variantIndex + 1}`);
          const downloaded = await fetchClip(clipId, targetBase);
          if (!downloaded) continue;
          const duration = await keepIfUsable(downloaded);
          if (duration === null) continue;
          existingPaths.push(downloaded);
          extraSeconds += duration;
          totalSeconds += duration;
          tracksGenerated += 1;
          if (totalSeconds >= targetSeconds) break;
        }

        if (existingPaths.length > 0) {
          // Re-read: `lastSong` is the copy selected before its own saveAudio(), so its
          // piano_audio_path is still null and appending to it would discard the main
          // generation's downloads.
          const saved = getSong(lastSong.id) ?? lastSong;
          const previous = parseJsonPaths(saved.piano_audio_path);
          saveAudio(lastSong.id, [...previous, ...existingPaths], (saved.piano_duration_sec ?? 0) + extraSeconds);
        }
      } catch (error) {
        runLogger.warn(`[STEP3] prompt2 top-up failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const reachedTarget = totalSeconds >= targetSeconds;
    runLogger.info(
      `[STEP3] done: ${tracksGenerated} track(s), ${(totalSeconds / 60).toFixed(1)} min` +
        `${reachedTarget ? '' : ` (short of the ${config.dailyTargetMinutes} min target)`}`,
    );
    return { tracksGenerated, totalDurationSec: Math.round(totalSeconds), errored, reachedTarget };
  } finally {
    await studio?.close();
    await context.close().catch(() => undefined);
  }
}
