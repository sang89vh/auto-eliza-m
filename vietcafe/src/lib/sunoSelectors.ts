/**
 * Every Suno selector lives here.
 *
 * Suno's UI is a moving target -- this module exists so that a redesign is a
 * one-file fix rather than a hunt through the pipeline. Each entry is a list of
 * candidates tried in order (see browser.ts `firstVisible`), newest layout first,
 * with older/aria-based fallbacks after it. When Suno changes, add the new
 * selector at the top of the relevant list rather than replacing the list.
 */

export const SUNO_CREATE_URL = 'https://suno.com/create';
export const SUNO_LIBRARY_URL = 'https://suno.com/me';

export const sunoSelectors = {
  /** Shown when the persistent profile is not logged in. */
  signedOutMarkers: [
    'a[href*="/login"]',
    'button:has-text("Sign in")',
    'button:has-text("Sign up")',
  ],

  /**
   * Present only once the app has hydrated with a live session. Every candidate must be
   * something the logged-out marketing shell at suno.com/create does NOT render -- that
   * shell has its own `textarea` and its own "Create" button, so both of those (previously
   * listed here) matched it and made the readiness probe meaningless. The mode tab strip
   * is the strongest signal: it exists in Simple and Advanced alike, but only once signed in.
   */
  signedInMarkers: [
    'button[role="tab"][aria-label="Advanced"]',
    '[data-testid="clip-row"]',
    '[data-testid="create-form-styles-wrapper"]',
    '[data-testid="create-page"]',
  ],

  /**
   * The create-form mode selector. Suno replaced the old Custom on/off toggle with a
   * `Simple | Advanced | Sounds` tab strip, and only Advanced exposes the Styles box
   * this pipeline writes into. Being a tab rather than a toggle it reports state
   * through `aria-selected`, and re-selecting the active tab is a no-op.
   */
  customModeToggle: [
    'button[role="tab"][aria-label="Advanced"]',
    '[role="tab"]:has-text("Advanced")',
    'button:has-text("Custom")',
    '[data-testid="custom-mode-toggle"]',
    'label:has-text("Custom") input[type="checkbox"]',
    'button[aria-label*="Custom" i]',
  ],

  /**
   * The lyrics-mode radio group under the Advanced tab is `Write | Prompt |
   * Instrumental`. Write is the custom-lyrics mode this pipeline needs: the generated
   * Vietnamese lyrics are pasted verbatim. Selecting it is verified positively by the
   * lyrics editor appearing, not by this control's aria state.
   */
  writeModeToggle: [
    '[role="radio"]:has-text("Write")',
    '[role="radio"][aria-label*="Write" i]',
    'button:text-is("Write")',
    '[data-testid="write-mode-toggle"]',
    'label:has-text("Write") input[type="radio"]',
  ],

  /**
   * Instrumental = ON would make Suno drop the vocals -- the opposite of what this
   * pipeline needs. Kept for debugging; nothing clicks it any more.
   */
  instrumentalToggle: [
    '[role="radio"]:has-text("Instrumental")',
    'button:has-text("Instrumental")',
    '[data-testid="instrumental-toggle"]',
    'label:has-text("Instrumental") input[type="checkbox"]',
    'button[aria-label*="Instrumental" i]',
  ],

  /**
   * The style-of-music box that receives cafe_prompt1 / cafe_prompt2. Anchored on
   * the wrapper's test id rather than the placeholder: Suno rotates that placeholder
   * through example genre lists, so it differs between page loads. The Advanced tab
   * also mounts the Simple and Sounds textareas alongside this one, which is the
   * other reason to scope the match instead of taking the first visible textarea.
   */
  styleInput: [
    '[data-testid="create-form-styles-wrapper"] textarea',
    'textarea[placeholder*="style" i]',
    'textarea[data-testid="tag-input-textarea"]',
    '[data-testid="styles-input"] textarea',
    'textarea[placeholder*="genre" i]',
    'div[contenteditable="true"][data-placeholder*="style" i]',
  ],

  /** Receives each song's Vietnamese lyrics before the style prompt is filled. */
  lyricsInput: [
    '[role="textbox"][aria-label="Lyrics editor"]',
    'textarea[placeholder*="lyric" i]',
    '[data-testid="lyrics-input"] textarea',
    'div[contenteditable="true"][data-placeholder*="lyric" i]',
  ],

  createButton: [
    'button[aria-label="Create song"]',
    'button[data-testid="create-button"]',
    'button:has-text("Create")',
    'button:has-text("Generate")',
  ],

  /**
   * One generation normally yields two tracks; each appears as a row here. The clip's
   * own id is no longer an attribute on the row -- it survives only in the row's
   * `/song/<uuid>` link -- so rows are addressed through `clipRowSelector` in
   * step3_suno.ts rather than by a `[data-clip-id]` lookup.
   */
  trackRows: [
    '[data-testid="clip-row"]',
    '[data-testid="song-row"]',
    '[data-clip-id]',
    'div[role="row"]:has(button[aria-label*="More" i])',
  ],

  /**
   * A row is finished when neither of these is present on it. Only consulted for
   * layouts with no `data-clip-status` on the row itself, which is the cheaper and
   * more reliable signal where it exists.
   */
  rowPendingMarkers: [
    '[data-testid="loading-indicator"]',
    'text=/queued|generating|processing|pending/i',
  ],

  /** Row overflow menu -> Download -> format. */
  rowMoreButton: [
    'button[aria-label="More options"]',
    'button[aria-label*="More" i]',
    'button[data-context-menu-trigger="true"]',
    'button[data-testid="song-row-more"]',
    'button:has(svg[aria-label*="more" i])',
  ],
  downloadMenuItem: [
    '.context-menu-item:has-text("Download")',
    'text=/^\\s*Download\\s*$/i',
    '[role="menuitem"]:has-text("Download")',
  ],
  /**
   * Suno replaced the Download submenu with a modal dialog: a format list
   * (M4A | MP3 | WAV | MP4 video asset | Stems & MIDI) plus one "Unlock & Download"
   * button that starts the transfer. It renders a spinner first and fills in a second
   * or two later, so wait on a real marker rather than a fixed pause.
   */
  downloadDialog: [
    '[role="dialog"]:has-text("Unlock & Download")',
    '[role="dialog"]:has(button:has-text("MP4 video asset"))',
    '[role="dialog"]',
  ],

  /**
   * One format row, scoped to the dialog. Matching the row BUTTON through its inner
   * span is what makes this reliable: `text=/WAV Audio/i` used to match the
   * "WAV audio is available exclusively to Premier users" caption -- a plain <span>
   * three levels away from any button -- and clicking a caption does nothing, so Step 3
   * spent 30s retrying against the modal backdrop and then failed the song.
   * `:text-is()` alone is no good either: it resolves to the inner <span>, not the
   * clickable <button>.
   */
  downloadFormatRow: (label: string): string =>
    `button:has(span:text-is("${label}")), [role="menuitem"]:has-text("${label}")`,

  /**
   * The rows carry no aria-checked/aria-selected -- the only signal is the inverted
   * palette on the selected row. This matters because the list is MULTI-select and MP3
   * arrives pre-selected: clicking WAV without clearing MP3 downloads both files, and
   * Playwright only ever claims one of them, leaving the other in DOWNLOAD_DIR forever.
   */
  downloadFormatSelectedMarker: 'bg-foreground-primary',

  downloadWavItem: [
    '[role="dialog"] button:has(span:text-is("WAV"))',
    '.context-menu-item:has-text("WAV Audio")',
    '[role="menuitem"]:has-text("WAV")',
  ],
  downloadMp3Item: [
    '[role="dialog"] button:has(span:text-is("MP3"))',
    '[role="menuitem"]:has-text("MP3")',
    'text=/MP3 Audio/i',
  ],

  /**
   * Starts the transfer. Mandatory in the current modal -- older layouts downloaded
   * straight from the menu item and only sometimes interposed a confirmation.
   */
  downloadConfirmButton: [
    '[role="dialog"] button:has-text("Unlock & Download")',
    'button:has-text("Unlock & Download")',
    'button:has-text("Download File")',
    '[role="dialog"] button:has-text("Download")',
    'button:has-text("Download Anyway")',
    'button:has-text("Confirm")',
    'button:has-text("Continue")',
  ],

  /**
   * The Base UI backdrop. A dialog left open keeps one of these over the whole page, so
   * the NEXT song's click on the lyrics editor is intercepted by it -- which is how one
   * failed download cascaded into a second song failing with an unrelated-looking
   * "locator.click: Timeout" against the editor.
   */
  modalOverlay: ['.modal-overlay', '[data-base-ui-portal] [role="presentation"][aria-hidden="true"]'],

  /** Out of credits / rate limited -- worth reporting distinctly from a timeout. */
  outOfCreditsMarkers: [
    'text=/not enough credits/i',
    'text=/out of credits/i',
    'text=/upgrade to continue/i',
  ],
} as const;

export const SUNO_STUDIO_URL = 'https://suno.com/studio';

/**
 * Opens one finished clip in Suno Studio as a fresh single-track project. This is the
 * URL the create page's `Edit ▸ Open in Studio ▸ Single-track` chooser navigates to,
 * and it skips the chooser when loaded directly. Studio rewrites it to plain
 * `/studio` once the project exists, so it cannot be used to *re-open* a project.
 */
export function sunoStudioClipUrl(clipId: string): string {
  return `${SUNO_STUDIO_URL}?for_clip_id=${encodeURIComponent(clipId)}&create_new=1`;
}

/**
 * Suno Studio -- the download path since Suno capped library downloads (Free 7 total,
 * Pro 20/month, Premier 60/month from 2026-09-03). Studio exports are exempt, and
 * Studio itself needs the Premier plan.
 *
 * What was verified on 2026-09-09, so nobody has to rediscover it:
 * - `Export ▸ Full Song` does NOT download anything -- it renders a copy into the
 *   library ("Song Saved!"), which would then need a capped library download.
 * - The timeline is a single three.js canvas; the clip is not a DOM element. It is
 *   addressed by position: the first track lane sits at the top of the canvas and the
 *   clip spans the visible width, so a right-click a little way down and past the
 *   middle lands on it. The context menu that opens is ordinary DOM (`Download .WAV`).
 * - The canvas only registers the pointer when it *enters* from outside, so the mouse
 *   is parked at the page corner before every approach.
 */
export const studioSelectors = {
  /** Rendered once the workstation shell is up: signed in and on a plan with Studio. */
  readyMarkers: [
    'button[aria-label="Project menu"]',
    'button[aria-label="Export menu"]',
  ],

  /** Reads "No project loaded" until the clip's project has been built. */
  projectMenuButton: ['button[aria-label="Project menu"]'],

  /**
   * The `Single-track | Multi-track` chooser. Loading `sunoStudioClipUrl` directly has
   * not shown it, but the create-page route does, so it is handled if it appears --
   * Multi-track costs 50 credits and must never be the one clicked.
   */
  singleTrackButton: ['[role="dialog"] button:has-text("Single-track")'],

  timelineCanvas: [
    '[data-studio-main-canvas="true"] canvas',
    'canvas[data-engine^="three.js"]',
  ],

  /** Clip context menu -> free WAV download of that clip. */
  clipDownloadWavItem: [
    'button:has-text("Download .WAV")',
    '[role="menuitem"]:has-text("Download .WAV")',
    'text=/Download \\.WAV/i',
  ],

  /** The first-visit "What's This?" coach panel; its Turn off button sticks per profile. */
  whatsThisTurnOff: ['button:has-text("Turn off")'],
} as const;

export type SunoSelectorKey = keyof typeof sunoSelectors;
