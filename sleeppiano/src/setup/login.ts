/**
 * `npm run setup:login` — opens a headed browser for Suno, then for YouTube, one at
 * a time, so the owner can sign in by hand. Each session is written into its own
 * persistent Chromium profile, which is what lets every later run start already
 * logged in.
 *
 * Fully automatable: a target that is already signed in is skipped without any
 * keypress, and an unconfirmed target stops waiting after LOGIN_WAIT_MINUTES
 * (default 5) and is treated as signed in. Whichever of signed-in detection,
 * Enter, or the timeout happens first wins.
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { chromium, type Page } from 'playwright';
import { anyVisible } from '../lib/browser.js';
import { config } from '../lib/config.js';
import { SUNO_CREATE_URL, sunoSelectors } from '../lib/sunoSelectors.js';
import { YOUTUBE_STUDIO_URL, youtubeSelectors } from '../lib/youtubeSelectors.js';

interface LoginTarget {
  name: string;
  profileDir: string;
  url: string;
  signedInMarkers: readonly string[];
  signedOutMarkers: readonly string[];
}

const TARGETS: LoginTarget[] = [
  {
    name: 'Suno',
    profileDir: config.sunoProfileDir,
    url: SUNO_CREATE_URL,
    signedInMarkers: sunoSelectors.signedInMarkers,
    signedOutMarkers: sunoSelectors.signedOutMarkers,
  },
  {
    name: 'YouTube Studio',
    profileDir: config.ytProfileDir,
    url: YOUTUBE_STUDIO_URL,
    signedInMarkers: youtubeSelectors.signedInMarkers,
    signedOutMarkers: youtubeSelectors.signedOutMarkers,
  },
];

const WAIT_MINUTES = (() => {
  const value = Number(process.env.LOGIN_WAIT_MINUTES);
  return Number.isFinite(value) && value > 0 ? value : 5;
})();

const DETECT_POLL_MS = 5000;

type LoginOutcome = 'already' | 'confirmed' | 'detected' | 'assumed';

const OUTCOME_MESSAGES: Record<LoginOutcome, string> = {
  already: 'already signed in — skipping the wait',
  confirmed: 'confirmed by Enter',
  detected: 'login detected — continuing automatically',
  assumed: `no confirmation within ${WAIT_MINUTES} min — assuming signed in and continuing`,
};

/** Signed-in only when a positive marker is visible and no signed-out marker is. */
async function isSignedIn(page: Page, target: LoginTarget): Promise<boolean> {
  try {
    const signedOut = await anyVisible(page, target.signedOutMarkers, 1200);
    if (signedOut) return false;
    return (await anyVisible(page, target.signedInMarkers, 1200)) !== null;
  } catch {
    // Login flows navigate mid-check; a destroyed execution context just means
    // the page has not settled yet, not that the check failed.
    return false;
  }
}

/** Race: already signed in | Enter pressed | login detected by polling | timeout. */
async function waitForLogin(
  page: Page,
  target: LoginTarget,
  prompt: readline.Interface,
): Promise<LoginOutcome> {
  if (await isSignedIn(page, target)) return 'already';

  console.log('Not signed in yet — sign in inside the browser window.');
  console.log(
    `Continuing automatically when login is detected, when you press Enter, or after ${WAIT_MINUTES} min.`,
  );

  const abort = new AbortController();
  let settled = false;

  return new Promise<LoginOutcome>((resolve) => {
    const finish = (outcome: LoginOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poller);
      abort.abort();
      resolve(outcome);
    };

    const timer = setTimeout(() => finish('assumed'), WAIT_MINUTES * 60_000);

    const poller = setInterval(() => {
      void isSignedIn(page, target).then((ok) => {
        if (ok) finish('detected');
      });
    }, DETECT_POLL_MS);

    prompt
      .question(`Press Enter once you are signed in to ${target.name}... `, { signal: abort.signal })
      .then(() => finish('confirmed'))
      .catch(() => {
        // Aborted because another path won the race.
      });
  });
}

async function main(): Promise<void> {
  const prompt = readline.createInterface({ input: stdin, output: stdout });

  for (const target of TARGETS) {
    console.log(`\n=== ${target.name} ===`);
    console.log(`Profile: ${target.profileDir}`);

    // Always headed here regardless of HEADLESS -- the point is a human signing in.
    const context = await chromium.launchPersistentContext(target.profileDir, {
      headless: false,
      viewport: { width: 1440, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 120_000 }).catch((error) => {
      console.warn(`Could not open ${target.url}: ${error instanceof Error ? error.message : String(error)}`);
    });
    // Let the app hydrate before the first signed-in check.
    await page.waitForTimeout(3000);

    const outcome = await waitForLogin(page, target, prompt);
    console.log(`\n${target.name}: ${OUTCOME_MESSAGES[outcome]}`);

    await context.close();
    console.log(`${target.name} session saved to ${target.profileDir}`);
  }

  prompt.close();
  console.log('\nProfiles are ready. The daily job (or `npm start`) can use them now.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
