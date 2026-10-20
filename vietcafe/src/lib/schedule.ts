import { config } from './config.js';

/**
 * When a finished video should go public.
 *
 * Kept apart from the Studio automation so the arithmetic is testable on its own: the
 * browser half only has to type whatever this produces. Everything is local time,
 * because that is what Studio's date and time fields expect -- it schedules against the
 * channel's timezone, not UTC.
 */
export interface PublishSlot {
  /** Local Date the video should publish at. */
  at: Date;
  /** As Studio's date field wants it, e.g. "31 thg 8, 2026" is locale-rendered by the UI;
   *  this is the neutral ISO form used for logging and for typing into the input. */
  isoDate: string;
  /** 24-hour "HH:MM", matching the time field. */
  time24: string;
  /** Human summary for the run log. */
  label: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * A slot `daysAhead` days from now at a random time inside the configured hour window.
 *
 * Minutes are quantised to a quarter hour: Studio's time field offers a dropdown of
 * 15-minute options, and typing a value it does not list can silently fail to stick.
 */
export function nextPublishSlot(now = new Date()): PublishSlot {
  const daysAhead = Math.max(0, Math.floor(config.youtubeScheduleDaysAhead));

  const minHour = Math.min(23, Math.max(0, Math.floor(config.youtubeScheduleHourMin)));
  const maxHour = Math.min(23, Math.max(minHour, Math.floor(config.youtubeScheduleHourMax)));
  const hour = minHour + Math.floor(Math.random() * (maxHour - minHour + 1));
  const minute = [0, 15, 30, 45][Math.floor(Math.random() * 4)] ?? 0;

  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, hour, minute, 0, 0);

  // A window that has already passed today would schedule in the past and Studio would
  // reject it; push to the next day rather than failing the upload at the last step.
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);

  const isoDate = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time24 = `${pad(at.getHours())}:${pad(at.getMinutes())}`;

  return { at, isoDate, time24, label: `${isoDate} ${time24}` };
}
