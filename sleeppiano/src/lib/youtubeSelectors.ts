/**
 * Every YouTube Studio selector lives here, for the same reason as sunoSelectors.ts:
 * Studio's upload dialog is restyled regularly, and isolating the selectors keeps a
 * redesign to a one-file fix. Candidates are tried in order, newest layout first.
 */

export const YOUTUBE_STUDIO_URL = 'https://studio.youtube.com/';

/**
 * Studio no longer resolves the literal `UC` placeholder -- that URL silently redirects
 * to the channel dashboard with no upload dialog -- so the real channel id has to be
 * substituted. `uploadUrlForChannel` builds it from the id STEP6 reads off the dashboard.
 */
export const YOUTUBE_UPLOAD_URL = 'https://studio.youtube.com/channel/UC/videos/upload?d=ud';
export const CHANNEL_ID_IN_URL = /\/channel\/(UC[\w-]+)/;
export function uploadUrlForChannel(channelId: string): string {
  return `https://studio.youtube.com/channel/${channelId}/videos/upload?d=ud`;
}

export const youtubeSelectors = {
  signedOutMarkers: [
    'a[href*="accounts.google.com"]',
    'text=/Sign in/i',
  ],

  /**
   * Present only in a signed-in Studio shell (signed-out Studio redirects to
   * accounts.google.com, which renders none of these). Used by setup:login to skip
   * the wait when the profile already carries a session.
   */
  signedInMarkers: [
    '#avatar-btn',
    'ytcp-app #avatar-btn',
    'ytcp-navigation-drawer',
  ],

  /** The hidden <input type=file> the upload dialog renders. */
  fileInput: ['input[type="file"]'],

  /** Confirms the upload dialog is actually open, however it was reached. */
  uploadDialogMarkers: ['ytcp-uploads-dialog', 'ytcp-button#select-files-button'],

  /**
   * Fallback path when the dialog needs opening explicitly. The dashboard no longer
   * carries `#create-icon`, so STEP6 opens the dialog by URL and only falls back to
   * these. Studio is also localised -- the account this runs against renders in
   * Vietnamese -- so text-matching candidates are last resorts behind id-based ones.
   */
  createButton: [
    '#create-icon',
    'ytcp-button#create-icon',
    'ytcp-button[aria-label*="Create" i]',
    'button[aria-label*="Create" i]',
    'button[aria-label="Tạo"]',
    'ytcp-button:has-text("Tạo")',
    'a[href$="/videos/upload"]',
  ],
  /**
   * The dashboard's dedicated upload icon. Preferred over the Create menu because it is
   * an icon with no caption: this account renders Studio in Vietnamese ("Tạo", "Tải video
   * lên"), where every English-text and aria-label*="Create" candidate misses.
   */
  uploadIconLink: ['[test-id="upload-icon-url"]', 'a[test-id="upload-icon-url"]'],

  // Studio's Create menu reads "Upload video" (singular) in English and "Tải video lên"
  // in Vietnamese, so the localised wordings are listed alongside the test-id.
  uploadVideosMenuItem: [
    'tp-yt-paper-item[test-id="upload-beta"]',
    'text=/^\\s*(Upload videos?|Tải video lên)\\s*$/i',
    'tp-yt-paper-item:has-text("Upload video")',
    'tp-yt-paper-item:has-text("Tải video lên")',
  ],
  selectFilesButton: ['ytcp-button#select-files-button', 'button:has-text("Select files")'],

  /** Details step. Studio uses contenteditable divs, not <input>, for these two. */
  titleBox: [
    'ytcp-social-suggestions-textbox[id="title-textarea"] #textbox',
    '#title-textarea #textbox',
    'div[aria-label*="Add a title" i]',
  ],
  descriptionBox: [
    'ytcp-social-suggestions-textbox[id="description-textarea"] #textbox',
    '#description-textarea #textbox',
    'div[aria-label*="Tell viewers about your video" i]',
  ],

  /** Audience -- required before Studio will let the flow advance. */
  notMadeForKidsRadio: [
    'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
    '#audience tp-yt-paper-radio-button:has-text("No, it\'s not made for kids")',
    'text=/No, it\'s not made for kids/i',
  ],

  /** "Show more" reveals tags and the altered-content disclosure. */
  showMoreButton: ['ytcp-button#toggle-button', 'button:has-text("Show more")'],
  tagsInput: ['input[aria-label*="Tags" i]', '#tags-container input', '#text-input'],

  /**
   * YouTube's synthetic/AI-altered-content question, required for AI-generated music.
   * The radio `name` attributes are VIDEO_HAS_ALTERED_CONTENT_*, not ALTERED_CONTENT_* --
   * the older guess matched nothing, and the `:has-text("No")` fallback missed because
   * this account renders Studio in Vietnamese ("Không"). Both were why every run logged
   * "altered-content question not found on this page".
   */
  alteredContentSection: ['#altered-content', 'text=/Altered content|Sử dụng AI/i'],
  alteredContentYes: [
    'tp-yt-paper-radio-button[name="VIDEO_HAS_ALTERED_CONTENT_YES"]',
    '#altered-content tp-yt-paper-radio-button[aria-label*="AI" i]:not([aria-label*="Không" i])',
    '#altered-content tp-yt-paper-radio-button:has-text("Có")',
  ],
  alteredContentNo: [
    'tp-yt-paper-radio-button[name="VIDEO_HAS_ALTERED_CONTENT_NO"]',
    '#altered-content tp-yt-paper-radio-button[aria-label*="Không" i]',
    '#altered-content tp-yt-paper-radio-button:has-text("Không")',
  ],

  /**
   * The monetisation step, shown only on channels in the Partner Programme. Studio
   * blocks Next until the ads dropdown is answered. Labels are localised ("Kiếm tiền",
   * "Bật"/"Tắt"), so id/structural candidates come first and wordings are last resorts.
   */
  monetisationSection: ['ytcp-uploads-monetization', 'ytcp-video-monetization', '#monetization-container'],
  /**
   * The control is NOT a `ytcp-select`. Studio renders it as a plain clickable div
   * inside `ytcp-video-monetization` whose text is the current setting ("Đang tắt" /
   * "Đang bật"). The old candidates matched nothing, and the bare `ytcp-select`
   * fallback matched the *content table's* rows-per-page dropdown behind the dialog --
   * so the handler could only ever click the wrong thing.
   */
  monetisationDropdown: [
    'ytcp-video-monetization .m10n-text.clickable',
    'ytcp-video-monetization .m10n-text',
  ],
  /** Radios in the dialog the control opens. The ids and names are not localised. */
  monetisationOnRadio: ['#radio-on', 'tp-yt-paper-radio-button[name="ON"]'],
  monetisationOffRadio: ['#radio-off', 'tp-yt-paper-radio-button[name="OFF"]'],
  /** "Xong" — confirms the monetisation dialog. Distinct from the wizard's #done-button. */
  monetisationSaveButton: [
    'ytcp-video-monetization-edit-dialog #save-button',
    '#save-button',
  ],

  /**
   * CONTENT_RATINGS -- the ad-suitability self-certification. It only appears once
   * monetisation is ON, which is why it was never seen until the monetisation handler
   * started working, and Studio blocks the wizard on it ("Bạn cần đánh giá video của
   * mình để tiếp tục").
   *
   * `.all-none-checkbox` is the questionnaire-level "contains none of the above"
   * (label "Không chứa nội dung nào ở trên"). It is the honest answer for a two-hour
   * instrumental piano track over an abstract backdrop; the per-question radios are
   * severity tiers that all assert the category IS present, so none of them may be
   * used as a stand-in for "no".
   */
  contentRatingsQuestionnaire: ['ytpp-self-certification-questionnaire'],
  contentRatingsNoneCheckbox: [
    'ytpp-self-certification-questionnaire .all-none-checkbox',
    'ytcp-checkbox-lit.all-none-checkbox',
  ],
  contentRatingsSubmit: ['#submit-questionnaire-button'],

  /**
   * The wizard's step bar. `test-id` is language-independent (DETAILS, MONETIZATION,
   * CONTENT_RATINGS, VIDEO_ELEMENTS, CHECKS, REVIEW) and `aria-selected` marks the
   * current one, so failures can name the screen they actually stopped on.
   */
  stepBadges: ['ytcp-stepper button[role="tab"]'],
  currentStepBadge: ['ytcp-stepper button[role="tab"][aria-selected="true"]'],

  nextButton: ['ytcp-button#next-button', '#next-button', 'button:has-text("Next")', 'ytcp-button:has-text("Tiếp")'],

  /** Visibility step. */
  visibilityPublic: ['tp-yt-paper-radio-button[name="PUBLIC"]', 'text=/^Public$/'],
  visibilityUnlisted: ['tp-yt-paper-radio-button[name="UNLISTED"]', 'text=/^Unlisted$/'],
  visibilityPrivate: ['tp-yt-paper-radio-button[name="PRIVATE"]', 'text=/^Private$/'],

  doneButton: ['ytcp-button#done-button', 'button:has-text("Save")', 'button:has-text("Done")'],
  closeDialogButton: ['ytcp-button#close-button', 'button[aria-label="Close"]'],

  /** Where the finished URL is read from. */
  videoUrlLink: [
    'a.ytcp-video-info[href*="youtu.be/"]',
    'a[href*="youtu.be/"]',
    'span.video-url-fadeable a',
  ],

  /** Processing / checks progress text, polled until it settles. */
  uploadStatusText: [
    'ytcp-video-upload-progress span.progress-label',
    '.progress-label',
    'span[class*="progress"]',
  ],

  /** Copyright / Content ID warnings worth logging before continuing. */
  copyrightWarning: ['text=/copyright/i', '#copyright-issues'],
} as const;

/** The visibility radio matching the VISIBILITY config value. */
export function visibilitySelectors(visibility: string): readonly string[] {
  switch (visibility.toLowerCase()) {
    case 'public':
      return youtubeSelectors.visibilityPublic;
    case 'private':
      return youtubeSelectors.visibilityPrivate;
    default:
      return youtubeSelectors.visibilityUnlisted;
  }
}
