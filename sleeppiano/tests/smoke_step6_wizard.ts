/**
 * Drives Studio's upload wizard against an EXISTING draft, using the real STEP6
 * handlers, and stops before the wizard's Save. Proves the monetisation and
 * ad-suitability screens can be answered without uploading anything new.
 *
 *   npx tsx tests/smoke_step6_wizard.ts "<draft title fragment>"
 */
import { anyVisible, captureScreenshot, isDisabled, launchPersistentContext } from '../src/lib/browser.js';
import { config } from '../src/lib/config.js';
import { runLogger } from '../src/lib/logger.js';
import { createRunFolder } from '../src/lib/runFolder.js';
import {
  answerContentRatingsIfAsked,
  currentWizardStep,
  currentWizardStepId,
  setMonetisationIfAsked,
} from '../src/pipeline/step6_youtube.js';
import { visibilitySelectors, youtubeSelectors, YOUTUBE_STUDIO_URL } from '../src/lib/youtubeSelectors.js';

const titleFragment = process.argv[2] ?? 'Moonlit Guardian';
const folder = createRunFolder();
const context = await launchPersistentContext(config.ytProfileDir);
const page = context.pages()[0] ?? (await context.newPage());

try {
  await page.goto(YOUTUBE_STUDIO_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(5000);
  const channelId = page.url().match(/\/channel\/(UC[\w-]+)/)?.[1];
  if (!channelId) throw new Error('Could not read the channel id — is the profile signed in?');

  let rows = 0;
  for (let attempt = 0; attempt < 4 && rows === 0; attempt += 1) {
    await page.goto(`https://studio.youtube.com/channel/${channelId}/videos/upload`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForTimeout(7000);
    rows = await page.locator('ytcp-video-row').count();
  }
  console.log(`content rows: ${rows}`);

  const draft = page.locator('ytcp-video-row').filter({ hasText: titleFragment }).first();
  await draft.hover().catch(() => undefined);
  await page.waitForTimeout(1200);
  await draft.locator('text=/Chỉnh sửa bản nháp|Edit draft/i').first().click({ timeout: 20_000 });
  await page.waitForTimeout(9000);
  console.log(`opened wizard at ${await currentWizardStep(page)}`);

  // The same loop step6Upload runs, minus the Save.
  for (let step = 0; step < 8; step += 1) {
    if (await anyVisible(page, visibilitySelectors(config.visibility), 1500)) {
      console.log('REACHED the visibility control — the wizard is unblocked');
      break;
    }
    const next = await anyVisible(page, youtubeSelectors.nextButton, 30_000);
    if (!next) {
      console.log('no Next button on', await currentWizardStep(page));
      break;
    }
    const stepId = await currentWizardStepId(page);
    if (stepId === 'MONETIZATION') await setMonetisationIfAsked(page, folder);
    else if (stepId === 'CONTENT_RATINGS') await answerContentRatingsIfAsked(page, folder);
    if (await isDisabled(next)) {
      await captureScreenshot(page, folder.logs, 'smoke_next_disabled');
      throw new Error(`still blocked on ${await currentWizardStep(page)}`);
    }
    await next.click().catch(() => undefined);
    await page.waitForTimeout(2500);
    console.log(`  -> now at ${await currentWizardStep(page)}`);
  }

  const visibility = await anyVisible(page, visibilitySelectors(config.visibility), 5000);
  console.log(`\nvisibility radio "${config.visibility}" found: ${!!visibility}`);
  await captureScreenshot(page, folder.logs, 'smoke_final_state');
  console.log('STOPPING before Save — nothing was published.');
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : String(error));
  await captureScreenshot(page, folder.logs, 'smoke_failed');
  process.exitCode = 1;
} finally {
  runLogger.detachFile();
  await context.close().catch(() => undefined);
}
