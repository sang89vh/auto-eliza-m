/**
 * Smoke test for the Suno create-form setup (step3_suno.ts `configureCreateForm`)
 * against the live site, using this project's saved Suno profile.
 *
 *   npx tsx tests/smoke_create_form.ts
 *
 * No credits are spent: the form is configured and read back, but Create is never
 * clicked. This is the check that would have caught the 2026-09-09 and 2026-09-11
 * breakages, where Suno first moved and then removed its Instrumental control and every
 * run died before a single song was submitted. A lyric line is seeded into a collapsed
 * Lyrics section first, so the path that reopens and clears the editor runs as well.
 * Screenshots of any failure land in a temp folder.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import { anyVisible, launchPersistentContext } from '../src/lib/browser.js';
import { config } from '../src/lib/config.js';
import { sunoSelectors } from '../src/lib/sunoSelectors.js';
import { configureCreateForm, openCreatePage } from '../src/pipeline/step3_suno.js';

const SEEDED_LYRIC = 'smoke test lyric';
const SMOKE_STYLE = 'solo piano, soft, slow, smoke test';

async function main(): Promise<void> {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suno-create-form-smoke-'));
  console.log(`Profile:  ${config.sunoProfileDir}`);
  console.log(`Logs dir: ${logsDir}`);

  const context = await launchPersistentContext(config.sunoProfileDir, { downloadDir: logsDir });
  let page: Page | null = null;
  let failures = 0;

  const check = (label: string, ok: boolean, detail = ''): void => {
    if (!ok) failures += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    page = await openCreatePage(context, logsDir);

    // Leave a lyric behind the way a manual session on this profile might, and collapse
    // the section over it, so configureCreateForm has to reopen the editor and clear it.
    const header = await anyVisible(page, sunoSelectors.lyricsSectionHeader, 10_000);
    const seedEditor = await anyVisible(page, sunoSelectors.lyricsInput, 3000);
    if (header && seedEditor) {
      if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
      await seedEditor.click();
      await page.keyboard.type(SEEDED_LYRIC);
      await header.click();
      check(
        'Seeded a lyric into the collapsed Lyrics section',
        (await seedEditor.innerText()).includes(SEEDED_LYRIC) && (await header.getAttribute('aria-expanded')) === 'false',
      );
    } else {
      console.log('note  the Advanced tab was not active on load, so the lyric-clearing path is not exercised');
    }

    await configureCreateForm(page, logsDir);

    // configureCreateForm throws on the paths it can detect; these assert the end state
    // it claims to have reached, independently of how it got there.
    const advancedTab = await anyVisible(page, sunoSelectors.advancedModeTab, 5000);
    const selected = advancedTab ? await advancedTab.getAttribute('aria-selected') : null;
    check('Advanced tab is the active one', selected === 'true', `aria-selected=${selected}`);

    const lyrics = await anyVisible(page, sunoSelectors.lyricsInput, 5000);
    const lyricsText = lyrics ? (await lyrics.innerText()).trim() : null;
    check('Lyrics editor is present and empty', lyricsText === '', `read back ${JSON.stringify(lyricsText)}`);

    // The pipeline depends on "empty lyrics = instrumental", and this placeholder is the
    // only place Suno says so. If the wording changes, find out what an empty editor
    // means now before trusting a run.
    const placeholder = await anyVisible(page, sunoSelectors.lyricsEmptyPlaceholder, 3000);
    const hint = placeholder ? await placeholder.innerText() : '';
    check('Suno still says empty lyrics means instrumental', /empty for instrumental/i.test(hint), `"${hint}"`);

    // Advanced mounts other textareas too (the Cowriter prompt box first of all); a style
    // prompt typed into one of those would ask Suno to write lyrics.
    const style = await anyVisible(page, sunoSelectors.styleInput, 5000);
    const maxlength = style ? await style.getAttribute('maxlength') : null;
    check('Prompt box is the Styles box', maxlength === '1000', `maxlength=${maxlength}`);

    // Suno keeps Create disabled until the form is submittable, so enabled-after-filling
    // proves it accepts a Styles-only (instrumental) request. It is never clicked.
    const create = await anyVisible(page, sunoSelectors.createButton, 5000);
    const createEnabled = async (): Promise<boolean | null> =>
      create ? (await create.getAttribute('disabled')) === null : null;
    check('Create is disabled while Styles is empty', (await createEnabled()) === false);

    if (style) {
      await style.fill(SMOKE_STYLE);
      await page.waitForTimeout(1000);
      const readBack = await style.inputValue();
      check('Styles box accepts input', readBack === SMOKE_STYLE, `read back "${readBack}"`);
      check('Create is enabled with Styles filled and lyrics empty', (await createEnabled()) === true);
    }
  } catch (error) {
    failures += 1;
    console.error(`\nconfigureCreateForm threw: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Leave no draft behind for the next pipeline run.
    if (page && !page.isClosed()) {
      const style = await anyVisible(page, sunoSelectors.styleInput, 1000);
      if (style) await style.fill('').catch(() => undefined);
      const lyrics = await anyVisible(page, sunoSelectors.lyricsInput, 1000);
      if (lyrics && (await lyrics.innerText().catch(() => '')).trim()) await lyrics.fill('').catch(() => undefined);
    }
    await context.close().catch(() => undefined);
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed. Screenshots (if any) are in ${logsDir}`);
    process.exit(1);
  }
  console.log('\nAll checks passed; no credits spent.');
  fs.rmSync(logsDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
