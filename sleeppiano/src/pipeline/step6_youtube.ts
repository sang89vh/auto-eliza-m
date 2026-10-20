import fs from 'node:fs';
import type { Page } from 'playwright';
import { anyVisible, captureScreenshot, firstVisible, isDisabled, launchPersistentContext } from '../lib/browser.js';
import { config } from '../lib/config.js';
import { getSong, type SongRow } from '../lib/db.js';
import { runLogger } from '../lib/logger.js';
import { sleep } from '../lib/retry.js';
import type { RunFolder } from '../lib/runFolder.js';
import { formatTimestamp, type TracklistEntry } from './step5_merge.js';
import {
  CHANNEL_ID_IN_URL,
  uploadUrlForChannel,
  visibilitySelectors,
  YOUTUBE_STUDIO_URL,
  youtubeSelectors,
} from '../lib/youtubeSelectors.js';

export interface Step6Result {
  youtubeUrl: string;
  title: string;
}

const TITLE_MAX_CHARS = 100;
const DESCRIPTION_MAX_CHARS = 5000;
const PROCESSING_TIMEOUT_MS = 60 * 60_000;

/**
 * PRD Step 6.3: mood-based only. `{theme}` is the piano_title of the first track --
 * never an original song title, which is the whole point of the naming policy: the
 * audio does not contain the original melody, so labelling it as one invites a
 * takedown report.
 */
export function buildTitle(tracklist: TracklistEntry[], dateStamp: string): string {
  const theme = tracklist[0]?.title?.trim() || 'Calm Night Piano';
  const humanDate = `${dateStamp.slice(0, 4)}-${dateStamp.slice(4, 6)}-${dateStamp.slice(6, 8)}`;

  let title = config.titleTemplate.replace(/\{theme\}/gi, theme).replace(/\{date\}/gi, humanDate);
  if (!/\{date\}/i.test(config.titleTemplate) && !title.includes(humanDate)) {
    title = `${title} (${humanDate})`;
  }

  return title.length > TITLE_MAX_CHARS ? `${title.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…` : title;
}

export function buildDescription(tracklist: TracklistEntry[]): string {
  const sections: string[] = [config.descriptionIntro.trim()];

  // Timestamps first: YouTube only turns these into chapters when the list starts
  // at 00:00 and has at least three entries.
  sections.push(tracklist.map((entry) => `${formatTimestamp(entry.startSec)} ${entry.title}`).join('\n'));

  if (config.descriptionIncludeIntroductions) {
    const seen = new Set<number>();
    const introductions: string[] = [];
    for (const entry of tracklist) {
      if (seen.has(entry.songId)) continue;
      seen.add(entry.songId);
      const introduction = getSong(entry.songId)?.piano_introduction?.trim();
      if (introduction) introductions.push(`${entry.title} — ${introduction}`);
    }
    if (introductions.length > 0) sections.push(introductions.join('\n'));
  }

  if (config.youtubeTags.length > 0) {
    sections.push(config.youtubeTags.map((tag) => `#${tag.replace(/\s+/g, '')}`).join(' '));
  }

  const description = sections.filter(Boolean).join('\n\n');
  return description.length > DESCRIPTION_MAX_CHARS ? description.slice(0, DESCRIPTION_MAX_CHARS - 1) : description;
}

/** Studio's title and description are contenteditable divs, not inputs. */
async function fillRichText(page: Page, selectors: readonly string[], value: string): Promise<void> {
  const box = await firstVisible(page, selectors, 60_000);
  await box.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await box.fill(value).catch(async () => {
    // Some Studio builds reject fill() on the contenteditable; type instead.
    await page.keyboard.insertText(value);
  });
  await page.waitForTimeout(500);
}

/**
 * Whether the upload dialog has actually rendered. Deliberately checks DOM presence
 * rather than visibility: Studio's file input is permanently hidden, and the dialog
 * animates in, so a visibility test reports false while the dialog is genuinely there.
 */
async function dialogPresent(page: Page): Promise<boolean> {
  for (const selector of [...youtubeSelectors.uploadDialogMarkers, ...youtubeSelectors.fileInput]) {
    if ((await page.locator(selector).count().catch(() => 0)) > 0) return true;
  }
  return false;
}

/**
 * Which wizard screen Studio is on, as its language-independent `test-id`:
 * DETAILS, MONETIZATION, CONTENT_RATINGS, VIDEO_ELEMENTS, CHECKS, REVIEW.
 */
export async function currentWizardStepId(page: Page): Promise<string> {
  const badge = await anyVisible(page, youtubeSelectors.currentStepBadge, 1500);
  if (!badge) return 'UNKNOWN';
  return (await badge.getAttribute('test-id').catch(() => null)) ?? 'UNKNOWN';
}

/** The same screen, with its localised caption, for error messages. */
export async function currentWizardStep(page: Page): Promise<string> {
  const badge = await anyVisible(page, youtubeSelectors.currentStepBadge, 1500);
  if (!badge) return 'unknown';
  const testId = await badge.getAttribute('test-id').catch(() => null);
  const label = (await badge.innerText().catch(() => ''))?.replace(/\s+/g, ' ').trim();
  return `${testId ?? '?'}${label ? ` ("${label}")` : ''}`;
}

/**
 * The monetisation screen shown on Partner-Programme channels. Studio blocks the wizard
 * until the setting is chosen, and the control is a clickable div, not a dropdown --
 * see the note on `monetisationDropdown`.
 */
export async function setMonetisationIfAsked(page: Page, runFolder: RunFolder): Promise<void> {
  const control = await anyVisible(page, youtubeSelectors.monetisationDropdown, 3000);
  if (!control) return;

  const wantOn = config.youtubeMonetisation !== 'off';
  const before = (await control.innerText().catch(() => ''))?.replace(/\s+/g, ' ').trim() ?? '';

  // The control's caption is the current setting ("Đang bật" / "Đang tắt" / "Chọn" when
  // unset). Re-opening the dialog on a screen that is already correct leaves an overlay
  // that swallows the next click on "Tiếp", so the wizard sits on this step until the
  // loop runs out -- exactly what a first cut of this handler did.
  const isOn = /\b(bật|on)\b/i.test(before);
  const isOff = /\b(tắt|off)\b/i.test(before);
  if ((wantOn && isOn) || (!wantOn && isOff)) {
    runLogger.info(`[STEP6] monetisation already "${before}" — leaving it as is`);
    return;
  }

  await control.click().catch(() => undefined);
  await page.waitForTimeout(1500);

  const radio = await anyVisible(
    page,
    wantOn ? youtubeSelectors.monetisationOnRadio : youtubeSelectors.monetisationOffRadio,
    5000,
  );
  if (!radio) {
    await captureScreenshot(page, runFolder.logs, 'youtube_monetisation_options');
    throw new Error(
      `The monetisation dialog offered no "${wantOn ? 'on' : 'off'}" radio ` +
        '— update youtubeSelectors.ts',
    );
  }
  await radio.click().catch(() => undefined);
  await page.waitForTimeout(800);

  // "Xong" commits the dialog; without it the wizard keeps the old value. Wait for the
  // dialog to actually go away -- while it is up it covers the wizard's Next button.
  const save = await anyVisible(page, youtubeSelectors.monetisationSaveButton, 5000);
  if (save) {
    await save.click().catch(() => undefined);
    for (let waited = 0; waited < 10; waited += 1) {
      if (!(await anyVisible(page, youtubeSelectors.monetisationSaveButton, 500))) break;
      await page.waitForTimeout(500);
    }
  }
  await page.waitForTimeout(1500);
  runLogger.info(`[STEP6] monetisation set to "${wantOn ? 'on' : 'off'}" (was "${before || 'unset'}")`);
}

/**
 * CONTENT_RATINGS -- the ad-suitability self-certification, which Studio inserts after
 * Monetisation once ads are on and will not let the wizard past until it is submitted.
 *
 * Only the questionnaire-level "contains none of the above" box is ticked. Every
 * per-question radio asserts that the category IS present at some severity, so none of
 * them is a truthful answer for an instrumental piano track over an abstract backdrop.
 * The submission is final for that video, so the choice is logged.
 */
export async function answerContentRatingsIfAsked(page: Page, runFolder: RunFolder): Promise<void> {
  const questionnaire = await anyVisible(page, youtubeSelectors.contentRatingsQuestionnaire, 3000);
  if (!questionnaire) return;

  const noneBox = await anyVisible(page, youtubeSelectors.contentRatingsNoneCheckbox, 5000);
  if (!noneBox) {
    await captureScreenshot(page, runFolder.logs, 'youtube_content_ratings');
    throw new Error(
      'The ad-suitability questionnaire has no "none of the above" checkbox — update youtubeSelectors.ts',
    );
  }
  const label = (await noneBox.getAttribute('label').catch(() => null)) ?? 'none of the above';
  await noneBox.click().catch(() => undefined);
  await page.waitForTimeout(1200);

  const submit = await anyVisible(page, youtubeSelectors.contentRatingsSubmit, 5000);
  if (!submit || (await isDisabled(submit))) {
    await captureScreenshot(page, runFolder.logs, 'youtube_content_ratings_submit');
    throw new Error(
      'The ad-suitability questionnaire would not accept the rating — see the screenshot',
    );
  }
  await submit.click().catch(() => undefined);
  await page.waitForTimeout(3000);
  runLogger.info(`[STEP6] ad-suitability self-certified as "${label}" and submitted`);
}

async function clickIfPresent(page: Page, selectors: readonly string[], timeoutMs = 5000): Promise<boolean> {
  const locator = await anyVisible(page, selectors, timeoutMs);
  if (!locator) return false;
  await locator.click().catch(() => undefined);
  await page.waitForTimeout(600);
  return true;
}

/**
 * Click a radio and confirm it actually took, distinguishing "not there" from "there but
 * would not check".
 *
 * `clickIfPresent` reports whether a control was found and clicked, never whether the
 * click changed anything, and on 2026-09-09 that gap silently published nothing while
 * costing a whole run: the audience radio was found, clicked, reported success, and the
 * video stayed on the channel's "made for kids" default. Studio then would not leave
 * Details, and the run died 74s later claiming the *visibility* radio was missing --
 * pointing at the one file that was not the problem.
 *
 * Retries once with a DOM-level click, which reaches the handler even when something is
 * painted over the control.
 */
async function selectRadio(
  page: Page,
  selectors: readonly string[],
  timeoutMs = 20_000,
): Promise<'absent' | 'checked' | 'stuck'> {
  const locator = await anyVisible(page, selectors, timeoutMs);
  if (!locator) return 'absent';

  const isChecked = async (): Promise<boolean> =>
    (await locator.getAttribute('aria-checked').catch(() => null)) === 'true';

  if (await isChecked()) return 'checked';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 0) await locator.click({ timeout: 5000 }).catch(() => undefined);
    else await locator.evaluate((el) => (el as unknown as { click: () => void }).click()).catch(() => undefined);
    await page.waitForTimeout(1200);
    if (await isChecked()) return 'checked';
  }
  return 'stuck';
}

/**
 * STEP 6 -- upload the merged video to YouTube Studio.
 *
 * On any failure the merged file and tracklist stay on disk, so a later run resumes
 * here instead of regenerating two hours of audio.
 */
export async function step6Upload(
  finalVideoPath: string,
  tracklist: TracklistEntry[],
  runFolder: RunFolder,
): Promise<Step6Result> {
  runLogger.setStep('STEP6');

  if (!fs.existsSync(finalVideoPath)) {
    throw new Error(`Final video not found at ${finalVideoPath}`);
  }

  const title = buildTitle(tracklist, runFolder.dateStamp);
  const description = buildDescription(tracklist);
  runLogger.info(`[STEP6] uploading as "${title}" (${config.visibility})`);

  const context = await launchPersistentContext(config.ytProfileDir);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto(YOUTUBE_STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForTimeout(5000);

    if (await anyVisible(page, youtubeSelectors.signedOutMarkers, 4000)) {
      await captureScreenshot(page, runFolder.logs, 'youtube_signed_out');
      throw new Error('YouTube is not signed in on this profile. Run `npm run setup:login` and sign in.');
    }

    // Open the upload dialog, then hand the file to its hidden input.
    //
    // Order matters here. The dashboard's upload icon is tried first because it is the
    // only entry point that carries no caption -- this account renders Studio in
    // Vietnamese, where "#create-icon" no longer exists and every English-text or
    // aria-label*="Create" candidate misses. The URL form is second, rebuilt against the
    // channel id read off the dashboard: Studio silently redirects the literal `UC`
    // placeholder back to the dashboard, which is what left earlier runs waiting 30s for
    // a file input that was never going to render. The Create menu is the last resort.
    await clickIfPresent(page, youtubeSelectors.uploadIconLink, 20_000);
    await page.waitForTimeout(4000);

    if (!(await dialogPresent(page))) {
      const channelId = page.url().match(CHANNEL_ID_IN_URL)?.[1];
      if (channelId) {
        runLogger.warn(`[STEP6] upload icon did not open the dialog; trying the channel upload URL`);
        await page.goto(uploadUrlForChannel(channelId), { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForTimeout(6000);
      }
    }

    if (!(await dialogPresent(page))) {
      runLogger.warn('[STEP6] still no upload dialog; trying the Create menu');
      await clickIfPresent(page, youtubeSelectors.createButton, 20_000);
      await clickIfPresent(page, youtubeSelectors.uploadVideosMenuItem, 10_000);
      await page.waitForTimeout(3000);
    }

    if (!(await dialogPresent(page))) {
      await captureScreenshot(page, runFolder.logs, 'youtube_no_upload_dialog');
      throw new Error(
        'The YouTube upload dialog would not open by icon, URL or Create menu — Studio has changed; ' +
          'update youtubeSelectors.ts',
      );
    }

    const fileInput = await firstVisible(page, youtubeSelectors.fileInput, 60_000).catch(() => null);
    if (fileInput) {
      await fileInput.setInputFiles(finalVideoPath);
    } else {
      // The input is sometimes hidden; target it without the visibility requirement.
      await page.locator('input[type="file"]').first().setInputFiles(finalVideoPath);
    }
    runLogger.info('[STEP6] file handed to Studio, upload started');
    await page.waitForTimeout(8000);

    await fillRichText(page, youtubeSelectors.titleBox, title);
    await fillRichText(page, youtubeSelectors.descriptionBox, description);
    runLogger.info('[STEP6] title and description set');

    // Audience is mandatory before Studio will advance, and it is read back rather than
    // assumed: a channel whose own default is "made for kids" pre-checks the other
    // option, and a click that fails to override it leaves Details permanently invalid.
    const audience = await selectRadio(page, youtubeSelectors.notMadeForKidsRadio, 20_000);
    if (audience === 'absent') {
      await captureScreenshot(page, runFolder.logs, 'youtube_no_audience_radio');
      throw new Error('Could not find the "not made for kids" audience radio — update youtubeSelectors.ts');
    }
    if (audience === 'stuck') {
      await captureScreenshot(page, runFolder.logs, 'youtube_audience_not_set');
      throw new Error(
        'The audience radio would not move off "made for kids". This is usually a channel-level default: ' +
          'YouTube Studio > Settings > Channel > Advanced settings > Audience. Publishing anyway would mark ' +
          'the video made for kids, which disables comments and personalised ads, so the run stops here.',
      );
    }

    // Tags and the altered-content question live behind "Show more".
    await clickIfPresent(page, youtubeSelectors.showMoreButton, 10_000);
    await page.waitForTimeout(1500);

    if (config.youtubeTags.length > 0) {
      const tagsInput = await anyVisible(page, youtubeSelectors.tagsInput, 8000);
      if (tagsInput) {
        await tagsInput.click();
        await tagsInput.fill(config.youtubeTags.join(','));
        await page.waitForTimeout(500);
      } else {
        runLogger.warn('[STEP6] tags field not found; continuing without tags');
      }
    }

    const disclosureSelectors =
      config.alteredContentDisclosure === 'yes'
        ? youtubeSelectors.alteredContentYes
        : youtubeSelectors.alteredContentNo;
    if (await clickIfPresent(page, disclosureSelectors, 8000)) {
      runLogger.info(`[STEP6] altered-content disclosure answered "${config.alteredContentDisclosure}"`);
    } else {
      runLogger.warn('[STEP6] altered-content question not found on this page; it may appear later in the flow');
    }

    // Grab the URL as soon as Studio shows it — it is available long before processing ends.
    let youtubeUrl = '';
    const urlLink = await anyVisible(page, youtubeSelectors.videoUrlLink, 20_000);
    if (urlLink) youtubeUrl = (await urlLink.textContent())?.trim() ?? (await urlLink.getAttribute('href')) ?? '';

    // Details -> [Monetisation] -> Video elements -> Checks -> Visibility.
    //
    // The step count is NOT fixed. A monetised channel gets an extra, mandatory
    // "Monetisation" screen after Details, which the old fixed three-Next loop never
    // budgeted for -- it ran out of clicks one screen short of Visibility and failed
    // claiming the visibility radio was missing. Advance until the visibility control is
    // actually on screen rather than counting steps, and answer the monetisation
    // question on the way past, since Next stays disabled until it is set.
    let reachedVisibility = false;
    for (let step = 0; step < 8; step += 1) {
      if (await anyVisible(page, visibilitySelectors(config.visibility), 1500)) {
        reachedVisibility = true;
        break;
      }

      const next = await anyVisible(page, youtubeSelectors.nextButton, 30_000);
      if (!next) {
        runLogger.warn(`[STEP6] no Next button on the ${await currentWizardStep(page)} step; leaving the wizard loop`);
        break;
      }

      // Dispatch on the step's test-id rather than on whether Next looks disabled.
      // CONTENT_RATINGS is the reason: Studio leaves its Next button *enabled* while the
      // questionnaire is unsubmitted, and simply ignores the click, so a disabled-Next
      // gate spins there until the loop runs out. The ids are not localised.
      switch (await currentWizardStepId(page)) {
        case 'MONETIZATION':
          await setMonetisationIfAsked(page, runFolder);
          break;
        case 'CONTENT_RATINGS':
          await answerContentRatingsIfAsked(page, runFolder);
          break;
        default:
          break;
      }

      if (await isDisabled(next)) {
        await captureScreenshot(page, runFolder.logs, 'youtube_next_disabled');
        throw new Error(
          `Studio will not advance past the ${await currentWizardStep(page)} step — something ` +
            'mandatory on it was left unanswered; see the screenshot and update step6_youtube.ts',
        );
      }
      await next.click().catch(() => undefined);
      await page.waitForTimeout(2500);

      // The disclosure sometimes appears on the second screen instead.
      await clickIfPresent(page, disclosureSelectors, 2000);
    }

    // Falling out of the loop without Visibility used to be silent, so the only symptom
    // was the misleading error further down. Say it where it happens.
    if (!reachedVisibility) {
      runLogger.warn(
        `[STEP6] the wizard never reached Visibility — still on ${await currentWizardStep(page)} after 8 advances`,
      );
    }

    if (await anyVisible(page, youtubeSelectors.copyrightWarning, 2000)) {
      runLogger.warn('[STEP6] Studio is showing a copyright/Content ID notice — check the video before publishing');
      await captureScreenshot(page, runFolder.logs, 'youtube_copyright_notice');
    }

    if (!(await clickIfPresent(page, visibilitySelectors(config.visibility), 30_000))) {
      await captureScreenshot(page, runFolder.logs, 'youtube_no_visibility_radio');
      // Which screen we are actually on decides which file is at fault. Naming the
      // selectors unconditionally is what made run 18 look like a visibility problem
      // when the wizard had never left Details.
      const stuckOn = await currentWizardStep(page);
      throw new Error(
        stuckOn.startsWith('VISIBILITY')
          ? `Could not select visibility "${config.visibility}" on the Visibility step — update youtubeSelectors.ts`
          : `Could not select visibility "${config.visibility}": the wizard is still on ${stuckOn}, so that radio ` +
            'was never on screen. Something mandatory earlier in the flow did not validate — see the screenshot.',
      );
    }
    runLogger.info(`[STEP6] visibility set to ${config.visibility}`);

    if (!youtubeUrl) {
      const link = await anyVisible(page, youtubeSelectors.videoUrlLink, 15_000);
      if (link) youtubeUrl = (await link.textContent())?.trim() ?? (await link.getAttribute('href')) ?? '';
    }

    const done = await firstVisible(page, youtubeSelectors.doneButton, 60_000);
    await done.click();
    runLogger.info('[STEP6] save clicked; waiting for upload and processing to settle');

    await waitForProcessing(page, runFolder);
    await clickIfPresent(page, youtubeSelectors.closeDialogButton, 10_000);

    if (!youtubeUrl) {
      await captureScreenshot(page, runFolder.logs, 'youtube_no_url');
      throw new Error('Upload finished but the video URL could not be read from Studio');
    }

    const normalized = youtubeUrl.startsWith('http') ? youtubeUrl : `https://${youtubeUrl.replace(/^\/+/, '')}`;
    runLogger.info(`[STEP6] done: ${normalized}`);
    return { youtubeUrl: normalized, title };
  } catch (error) {
    await captureScreenshot(page, runFolder.logs, 'youtube_upload_failed').catch(() => undefined);
    throw error;
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Poll the progress label until it stops moving or reports checks complete. */
async function waitForProcessing(page: Page, runFolder: RunFolder): Promise<void> {
  const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
  let lastText = '';
  let unchangedPolls = 0;

  while (Date.now() < deadline) {
    const label = await anyVisible(page, youtubeSelectors.uploadStatusText, 3000);
    const text = label ? ((await label.textContent()) ?? '').trim() : '';

    if (text && text !== lastText) {
      runLogger.info(`[STEP6] ${text}`);
      lastText = text;
      unchangedPolls = 0;
    } else {
      unchangedPolls += 1;
    }

    if (/checks complete|processing (is )?(done|complete)|upload complete/i.test(text)) return;
    // A label that has not moved for five minutes means the dialog has settled.
    if (!text && unchangedPolls >= 10) return;
    if (unchangedPolls >= 30) {
      runLogger.warn(`[STEP6] progress label has not changed for a while ("${lastText}"); continuing`);
      return;
    }

    await sleep(10_000);
  }

  await captureScreenshot(page, runFolder.logs, 'youtube_processing_timeout');
  throw new Error(`Upload did not reach a settled state within ${PROCESSING_TIMEOUT_MS / 60_000} minutes`);
}

export function songsIncludedIn(tracklist: TracklistEntry[]): number[] {
  return [...new Set(tracklist.map((entry) => entry.songId))];
}

export type { SongRow };
