import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Locator, Page } from 'playwright';
import { anyVisible, captureScreenshot, firstVisible } from './browser.js';
import { runLogger } from './logger.js';
import { sleep } from './retry.js';
import { SUNO_STUDIO_URL, studioSelectors, sunoStudioClipUrl } from './sunoSelectors.js';

/** Studio could not be used at all for this run: wrong plan, signed out, or a redesign. */
export class SunoStudioError extends Error {}

const STUDIO_PROJECT_TIMEOUT_MS = 90_000;
const STUDIO_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
/**
 * Both clips of two consecutive songs failing means Studio is stalled for this run,
 * not that two clips were unlucky. Every further generation would then burn credits
 * for audio that cannot be fetched, so the step is aborted the way it is for an
 * empty credit balance. Observed cause so far: a second Studio session on the same
 * account (the two pipelines share one), which leaves every render pending.
 */
const STUDIO_MAX_CONSECUTIVE_FAILURES = 4;

/**
 * Downloads finished clips through Suno Studio instead of the library's Download menu,
 * because library downloads are capped per month and Studio exports are not (see
 * `studioSelectors`). It lives in its own tab so the create page keeps its form state
 * and its clip list between songs.
 *
 * Studio's timeline is one WebGL canvas, so the clip cannot be located by selector.
 * Every project made from `sunoStudioClipUrl` has exactly one track holding one clip
 * that fills the visible width, and that invariant is what the fixed-fraction
 * right-click in `openClipMenu` relies on.
 */
export class StudioDownloader {
  private page: Page | null = null;
  private consecutiveFailures = 0;

  constructor(
    private readonly context: BrowserContext,
    private readonly logsDir: string,
  ) {}

  private async tab(): Promise<Page> {
    if (!this.page || this.page.isClosed()) this.page = await this.context.newPage();
    // Pointer events on a background tab are unreliable for a WebGL surface.
    await this.page.bringToFront().catch(() => undefined);
    return this.page;
  }

  /**
   * Run-level gate, to be called before the first prompt is submitted: a run that
   * generates two hours of audio and only then learns it cannot download any of it has
   * wasted every credit it spent. Studio is a Premier feature, so an account on a lower
   * plan gets an upsell page here instead of the workstation.
   */
  async verifyAccess(): Promise<void> {
    const page = await this.tab();
    await page.goto(SUNO_STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    const ready = await anyVisible(page, studioSelectors.readyMarkers, 60_000);
    if (!ready) {
      // A closed browser produces exactly the same "markers never appeared" as a plan
      // upsell, and blaming the plan for it costs real time: run 16 on 2026-09-09 died
      // here 26s in -- nowhere near the 60s wait -- with the context already gone, on an
      // account where Studio in fact renders in about 5s. Whether that context was closed
      // by hand or lost to a second launch against the same profile dir was never
      // established; either way the plan was not the reason. Separate the two, or the
      // next reader switches to the library path and finds that capped out as well.
      if (page.isClosed()) {
        throw new SunoStudioError(
          'The browser closed while Suno Studio was being checked, so whether Studio is available ' +
            'was never actually determined. Re-run without closing the automated window.',
        );
      }
      await captureScreenshot(page, this.logsDir, 'suno_studio_unavailable');
      throw new SunoStudioError(
        'Suno Studio did not open for this profile (it needs the Premier plan and a signed-in session). ' +
          'See the screenshot. SUNO_DOWNLOAD_VIA=library is only a fallback if that account still has ' +
          'library downloads left — check `Downloads Remaining` on suno.com/account before relying on it.',
      );
    }
    runLogger.info('Suno Studio is available; clips will be downloaded through it');
  }

  /**
   * Download one clip as WAV into `${targetBase}.wav`, or null if this clip could not be
   * fetched. Throws SunoStudioError once failures pile up (see the constant above).
   */
  async download(clipId: string, targetBase: string): Promise<string | null> {
    try {
      const page = await this.openProject(clipId);
      const menuItem = await this.openClipMenu(page, clipId);

      const downloadPromise = page.waitForEvent('download', { timeout: STUDIO_DOWNLOAD_TIMEOUT_MS });
      await menuItem.click();
      // Studio renders the WAV server-side before the browser download begins -- 40-50 s
      // for a 3-4 minute clip -- so this is where most of the wait goes.
      const download = await downloadPromise;

      const extension = (path.extname(download.suggestedFilename()).replace('.', '') || 'wav').toLowerCase();
      const targetPath = `${targetBase}.${extension}`;
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      await download.saveAs(targetPath);
      // saveAs copies rather than moves; drop Playwright's copy so the run does not hold
      // every WAV twice.
      await download.delete().catch(() => undefined);
      this.consecutiveFailures = 0;
      return targetPath;
    } catch (error) {
      runLogger.warn(`Studio download of clip ${clipId} failed: ${error instanceof Error ? error.message : String(error)}`);
      if (this.page && !this.page.isClosed()) {
        await captureScreenshot(this.page, this.logsDir, `suno_studio_download_failed_${clipId}`).catch(() => undefined);
        await this.page.keyboard.press('Escape').catch(() => undefined);
      }
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= STUDIO_MAX_CONSECUTIVE_FAILURES) {
        throw new SunoStudioError(
          `${this.consecutiveFailures} Studio downloads in a row failed — Studio looks stalled for this run ` +
            '(is another browser using Studio on this account?), so no more credits will be spent',
        );
      }
      return null;
    }
  }

  async close(): Promise<void> {
    if (this.page && !this.page.isClosed()) await this.page.close().catch(() => undefined);
    this.page = null;
  }

  /**
   * Load the clip into a new single-track project and wait until the timeline shows it.
   * A clip that finished seconds ago may not be available to Studio yet, so one reload
   * is allowed before giving up.
   */
  private async openProject(clipId: string): Promise<Page> {
    const page = await this.tab();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await page.goto(sunoStudioClipUrl(clipId), { waitUntil: 'domcontentloaded', timeout: 90_000 });

      // The create-page route shows a Single-track | Multi-track chooser; the direct URL
      // has not, but Multi-track costs 50 credits, so be explicit if it ever does.
      const chooser = await anyVisible(page, studioSelectors.singleTrackButton, 4000);
      if (chooser) await chooser.click().catch(() => undefined);

      if (await this.waitForProject(page)) {
        // Let the waveform settle, and silence the first-visit coach panel -- its
        // "Turn off" sticks to the profile, so this normally runs once.
        await page.waitForTimeout(3000);
        const turnOff = await anyVisible(page, studioSelectors.whatsThisTurnOff, 500);
        if (turnOff) await turnOff.click().catch(() => undefined);
        return page;
      }
      runLogger.warn(`Studio did not load a project for clip ${clipId} (attempt ${attempt}/2)`);
      await captureScreenshot(page, this.logsDir, `suno_studio_project_timeout_${clipId}`);
      if (attempt === 1) await sleep(10_000);
    }
    throw new Error(`Studio never showed the project for clip ${clipId}`);
  }

  /** The project menu reads "No project loaded" until the project exists; the canvas follows. */
  private async waitForProject(page: Page): Promise<boolean> {
    const deadline = Date.now() + STUDIO_PROJECT_TIMEOUT_MS;
    const menu = page.locator(studioSelectors.projectMenuButton.join(', ')).first();
    while (Date.now() < deadline) {
      const label = await menu.innerText({ timeout: 1000 }).catch(() => '');
      if (label.trim() && !/no project loaded/i.test(label)) {
        if (await anyVisible(page, studioSelectors.timelineCanvas, 1000)) return true;
      }
      await sleep(1000);
    }
    return false;
  }

  /**
   * Right-click the clip and return its "Download .WAV" entry. Positions are fractions
   * of the canvas box, so they survive a viewport change but not a Studio redesign; a
   * few nearby spots are tried, some after a selecting left-click.
   */
  private async openClipMenu(page: Page, clipId: string): Promise<Locator> {
    const canvas = await firstVisible(page, studioSelectors.timelineCanvas, 10_000);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('The Studio timeline canvas has no bounding box');

    const attempts = [
      { xFrac: 0.6, yFrac: 0.17, leftFirst: false },
      { xFrac: 0.6, yFrac: 0.12, leftFirst: true },
      { xFrac: 0.45, yFrac: 0.22, leftFirst: false },
      { xFrac: 0.6, yFrac: 0.17, leftFirst: true },
    ];
    for (const attempt of attempts) {
      const x = box.x + box.width * attempt.xFrac;
      const y = box.y + box.height * attempt.yFrac;
      // Park the pointer outside the canvas first: the timeline only picks up the clip
      // under the cursor when the pointer enters it, not when it jumps within it.
      await page.mouse.move(2, 2);
      await page.waitForTimeout(200);
      await page.mouse.move(x, y, { steps: 8 });
      await page.waitForTimeout(300);
      if (attempt.leftFirst) {
        await page.mouse.click(x, y);
        await page.waitForTimeout(500);
      }
      await page.mouse.click(x, y, { button: 'right' });
      const item = await anyVisible(page, studioSelectors.clipDownloadWavItem, 2500);
      if (item) return item;
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(500);
    }
    await captureScreenshot(page, this.logsDir, `suno_studio_no_clip_menu_${clipId}`);
    throw new Error('Right-clicking the Studio timeline never offered "Download .WAV" — update studioSelectors');
  }
}
