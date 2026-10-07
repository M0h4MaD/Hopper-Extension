/**
 * time-utils.js — pure helpers for the "when does the limit reset?" alarm-style picker.
 * No DOM, no browser APIs, so they can be unit-tested with plain Node.
 */

/** "In 2 h 30 min": hours/minutes from now. Returns an epoch ms, or null when both are empty/zero. */
export function untilFromIn(hours, minutes, now = Date.now()) {
  const h = Number.isFinite(hours) ? Math.trunc(hours) : 0;
  const m = Number.isFinite(minutes) ? Math.trunc(minutes) : 0;
  const total = Math.max(0, h) * 60 + Math.max(0, m);
  return total > 0 ? now + total * 60000 : null;
}

/** "At 18:30": the next time the clock shows HH:MM (today, or tomorrow if that moment has already passed). */
export function untilFromClock(hhmm, now = Date.now()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!match) return null;
  const H = Number(match[1]), M = Number(match[2]);
  if (H > 23 || M > 59) return null;
  const d = new Date(now);
  d.setHours(H, M, 0, 0);
  if (d.getTime() <= now + 60000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Split a duration into days / hours / minutes (rounded to the nearest minute, at least 1 minute). */
export function durationParts(ms) {
  const total = Math.max(1, Math.round(ms / 60000));
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
}

/** Value for <input type="datetime-local" min=...> in local time. */
export function localDateTimeMin(now = Date.now()) {
  return new Date(now - new Date(now).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
