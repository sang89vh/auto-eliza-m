import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';
import { config } from './config.js';
import { runLogger } from './logger.js';

/**
 * Both Suno and YouTube are driven through a *persistent* Chromium profile, so a
 * login done once by `npm run setup:login` survives every later run. Headed is the
 * default: it is markedly less likely to be flagged as automation than headless.
 */
export async function launchPersistentContext(
  profileDir: string,
  options: { downloadDir?: string } = {},
): Promise<BrowserContext> {
  fs.mkdirSync(profileDir, { recursive: true });
  if (options.downloadDir) fs.mkdirSync(options.downloadDir, { recursive: true });

  return chromium.launchPersistentContext(profileDir, {
    headless: config.headless,
    acceptDownloads: true,
    downloadsPath: options.downloadDir,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

export function profileExists(profileDir: string): boolean {
  // launchPersistentContext writes these on first real use; an empty directory
  // means setup:login was never completed.
  return fs.existsSync(path.join(profileDir, 'Default')) || fs.existsSync(path.join(profileDir, 'Default', 'Cookies'));
}

/** Screenshot into the run's logs folder. Never throws -- it runs on the failure path. */
export async function captureScreenshot(page: Page, logsDir: string, label: string): Promise<string | null> {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(logsDir, `${stamp}_${safeLabel}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    runLogger.warn(`Screenshot saved: ${filePath}`);
    return filePath;
  } catch (error) {
    runLogger.warn(`Could not capture screenshot for ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Suno and YouTube Studio both restyle often, so every element is described by a
 * list of candidate selectors rather than one brittle string. The first candidate
 * that resolves to a visible element wins.
 */
export async function firstVisible(page: Page, selectors: readonly string[], timeoutMs = 15_000): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.isVisible({ timeout: 500 })) return locator;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    await page.waitForTimeout(400);
  }

  throw new Error(
    `None of these selectors became visible within ${Math.round(timeoutMs / 1000)}s: ${selectors.join(' | ')}` +
      (lastError ? ` (last error: ${lastError})` : ''),
  );
}

/**
 * Studio's buttons are `<ytcp-button>` custom elements, and Playwright's `isEnabled()`
 * only treats native form controls as disableable -- it returns `true` for
 * `<ytcp-button disabled aria-disabled="true">` even when the inner `<button>` is
 * disabled too. Every guard written against `isEnabled()` was therefore dead code, which
 * is how STEP6 kept clicking an inert "Tiếp" and then blaming the visibility radio.
 * Read the attributes instead, on the element and on the native button it wraps.
 */
export async function isDisabled(locator: Locator): Promise<boolean> {
  return locator
    .evaluate((node) => {
      // Structurally typed: tsconfig omits the DOM lib, so `Element` is not in scope here.
      type AttrNode = { hasAttribute(name: string): boolean; getAttribute(name: string): string | null };
      const off = (el: AttrNode | null): boolean =>
        !!el && (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true');
      return off(node) || off(node.querySelector('button'));
    })
    .catch(() => false);
}

export async function anyVisible(page: Page, selectors: readonly string[], timeoutMs = 3000): Promise<Locator | null> {
  try {
    return await firstVisible(page, selectors, timeoutMs);
  } catch {
    return null;
  }
}
