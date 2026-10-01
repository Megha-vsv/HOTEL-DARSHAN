/**
 * One place to read, calculate and display order times.
 *
 * ## Why this file exists
 *
 * Every timestamp in `orders` is written by SQLite's `CURRENT_TIMESTAMP`, which
 * is **UTC**, and it reaches the browser as a naive string like
 * `"2026-09-30 17:52:00"` - no `T`, no `Z`, no offset. The server hands the row
 * to JSON untouched, so that string is the only thing the client gets.
 *
 * `new Date("2026-09-30 17:52:00")` does NOT mean 17:52 UTC. It is not a format
 * `Date.parse` is required to accept, so engines fall back to implementation
 * defined parsing and read it as *local* time. On an IST phone that turns an
 * order placed at 11:22 PM into a displayed 05:52 PM - the five-and-a-half hour
 * gap between the stored UTC value and the local value it was mistaken for.
 *
 * The same two mistakes were made independently at about twenty call sites, and
 * three places had already grown their own fix. So the fix is not new logic, it
 * is the existing `parseServerTimestamp` promoted somewhere every display can
 * reach it.
 *
 * ## The two rules
 *
 * 1. **Parse through `parseServerTimestamp`.** It returns epoch milliseconds, or
 *    `null` for anything unreadable. Never `new Date(rawString)`.
 * 2. **Display through the formatters here.** They pin `Asia/Kolkata` rather
 *    than falling back to the phone's ambient zone, so a customer in another
 *    timezone still reads the restaurant's local clock, and a customer on a
 *    misconfigured device still reads the right one.
 *
 * Times shown to a customer are India Standard Time because the restaurant is
 * in Dediapada, Gujarat. That is a property of where the food is made, not of
 * where the customer happens to be standing.
 */

/** The restaurant's timezone. Every customer-facing clock time is in this zone. */
export const APP_TIME_ZONE = 'Asia/Kolkata';

/**
 * Read a timestamp the server wrote, as a number of milliseconds.
 *
 * The database stores `2026-09-27 13:22:21`, which `Date.parse` does not accept
 * in a browser, so it is normalised the same way the server does it: space to
 * `T`, and read as UTC. Returns null rather than NaN or 0 for anything
 * unreadable, because a caller showing "last updated" needs to be able to say "I
 * do not know how old this is" - which is a different and more honest thing to
 * show than a position of unknown age presented as if it were current.
 *
 * This is the single parse for the whole client. `lib/geo.js` re-exports it for
 * the GPS call sites that were using it first.
 */
export function parseServerTimestamp(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  // A Date handed back by this module - `formatEstimatedArrival` renders one, and
  // so does `istDayStartMs`. Stringifying it would produce
  // "Tue Sep 29 2026 18:17:00 GMT+0530 (India Standard Time)", whose first space
  // would then be replaced by a "T" and a "Z" appended, which is nonsense that
  // Date.parse may or may not reject. Take the instant directly instead.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }

  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return Number(raw); // epoch millis

  // SQLite's "YYYY-MM-DD HH:MM:SS" is UTC but carries no zone marker, so the
  // space becomes a "T" and a "Z" is appended. A value that already states its
  // offset is left alone - re-labelling it as UTC would move it by 5h30m.
  const normalised = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const alreadyZoned = normalised.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(normalised);
  const ms = Date.parse(alreadyZoned ? normalised : `${normalised}Z`);

  return Number.isFinite(ms) ? ms : null;
}

/**
 * Turn anything into a `Date`, or null.
 *
 * `new Date(ms)` is the only construction used past this point. Adding a minute
 * to a Date is plain duration arithmetic and carries no timezone of its own,
 * which is why the estimated-arrival helper below can add minutes without
 * inventing an offset: the instant is already absolute, and rendering it in IST
 * is a separate step.
 */
export function toDate(value) {
  const ms = parseServerTimestamp(value);
  return ms === null ? null : new Date(ms);
}

/**
 * Shared Intl options.
 *
 * `hour12: false` with `en-IN` is deliberate: the Indian convention on a
 * restaurant ticket and on a customer's phone is a 24-hour clock, and letting
 * the locale decide produced 12-hour output with AM/PM glued on in some builds.
 * `hourCycle: 'h23'` is stated as well because `hour12: false` alone is
 * permitted to yield `h24` (midnight rendered as 24:00) in some engines, and
 * h24 is the one thing that makes a midnight order look like it was placed a day
 * late.
 */
const CLOCK_OPTIONS = {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
};

/** "14:35" in IST, or '' when the value cannot be read. */
export function formatClockTime(value) {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleString('en-IN', CLOCK_OPTIONS);
}

/** "30 Sep 2026" in IST, or ''. */
export function formatDate(value) {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleDateString('en-IN', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** "Wed, 30 Sep" in IST, for list rows that do not need the year. */
export function formatDayDate(value) {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleDateString('en-IN', {
    timeZone: APP_TIME_ZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

/** "30 Sep 2026, 14:35" in IST, or ''. */
export function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return '';
  return `${formatDate(value)} · ${formatClockTime(value)}`;
}

/**
 * Everything that marks the same calendar day in IST.
 *
 * Order grouping has to compare calendar days in the zone the day is lived in.
 * Comparing `getDate()` on a local Date compares the *device's* day, which is
 * the wrong day for a customer travelling in another timezone, and is the
 * origin of the "order placed yesterday" bug at 11:30 PM.
 */
export function istDayKey(value) {
  const date = toDate(value);
  if (!date) return '';
  // en-CA renders ISO-ordered dates, so this is already YYYY-MM-DD.
  return date.toLocaleDateString('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * The epoch instant of IST midnight on the day containing `value`.
 *
 * "Today" has to mean the restaurant's day, not the reviewer's. The old filter
 * built today's start with `new Date(y, m, d)`, which is midnight in the
 * *device's* timezone, and compared it against a UTC timestamp - so an admin in
 * any timezone other than IST saw reviews filed after their own midnight but
 * before IST midnight filed as "yesterday", and the first 5h30m of every
 * restaurant day counted towards the wrong bucket.
 *
 * India observes no daylight saving, so IST is a fixed +05:30 and midnight can
 * be found by arithmetic rather than by scanning. That is deliberate: an
 * `Intl`-based search would be correct too, but it is far harder to read and
 * there is no case here where the fixed offset is wrong.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Epoch ms of IST midnight for the day containing `value`; null if unreadable. */
export function istDayStartMs(value) {
  const date = toDate(value);
  if (!date) return null;

  const { year, month, day } = Object.fromEntries(
    date.toLocaleString('en-CA', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).split('-').map((part, index) => [index === 0 ? 'year' : index === 1 ? 'month' : 'day', Number(part)])
  );

  return Date.UTC(year, month - 1, day) - IST_OFFSET_MS;
}

/** Epoch ms of IST midnight `days` before the day containing `value`. */
export function istDaysAgoMs(value, days) {
  const start = istDayStartMs(value);
  return start === null ? null : start - days * 24 * 60 * 60 * 1000;
}

/** Epoch ms of IST midnight on the 1st of the month containing `value`. */
export function istMonthStartMs(value) {
  const start = istDayStartMs(value);
  if (start === null) return null;
  const date = toDate(start + IST_OFFSET_MS);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) - IST_OFFSET_MS;
}

/** Whole minutes between two timestamps, signed. null if either is unreadable. */
export function minutesBetween(from, to) {
  const a = parseServerTimestamp(from);
  const b = parseServerTimestamp(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 60000);
}

/** Minutes since a timestamp, as a positive number. null if unreadable. */
export function minutesSince(value, now = Date.now()) {
  const ms = parseServerTimestamp(value);
  if (ms === null) return null;
  return Math.max(0, Math.floor((now - ms) / 60000));
}

/**
 * "just now" / "12 min ago" / "1 hr ago" / "2 days ago", in IST-anchored terms.
 *
 * The duration between two instants is the same number in every timezone, so
 * there is nothing IST-specific to apply here - what matters is that the inputs
 * were parsed as UTC. "Just now" is given its own bucket because a rider
 * refreshing a notification list should not see "0 min ago".
 */
export function timeAgo(value, now = Date.now()) {
  const ms = parseServerTimestamp(value);
  if (ms === null) return '';
  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;

  // Past a week the absolute date says more than "9 days ago".
  return formatDate(ms);
}

/**
 * How long this order is expected to take, in minutes.
 *
 * Read off the order row, which is where checkout recorded it: 20 for a pickup,
 * 35 for a delivery (`server/src/routes/orders.js`). The fallbacks exist only for
 * orders placed before the column was populated, and they mirror those same
 * values rather than inventing a third number. There is deliberately no
 * hardcoded marketing figure here - `estimated_delivery_mins` is the estimate the
 * customer was shown at checkout, so the arrival time has to be built from it.
 */
export function getEstimatedMinutes(order) {
  const recorded = Number(order?.estimated_delivery_mins);
  if (Number.isFinite(recorded) && recorded > 0) return recorded;
  return order?.order_type === 'pickup' ? 20 : 35;
}

/**
 * The clock time this order is expected to be ready, as a `Date`.
 *
 * This is the actual fix for the reported symptom. The previous code labelled
 * `created_at` as "Estimated Time", which is the moment the order was *placed* -
 * so a 11:22 PM order read "11:22 pm" and read as though it were arriving then.
 * Arrival is placement plus the estimate the customer agreed to, and adding a
 * duration to an already-absolute instant needs no timezone correction.
 */
export function estimatedArrivalDate(order) {
  const created = parseServerTimestamp(order?.created_at);
  if (created === null) return null;
  return new Date(created + getEstimatedMinutes(order) * 60000);
}

/** The estimated arrival as an IST clock string, or ''. */
export function formatEstimatedArrival(order) {
  const arrival = estimatedArrivalDate(order);
  return arrival ? formatClockTime(arrival) : '';
}

/**
 * "in about 25 min" / "arrived 8:12 pm", phrased against the real clock.
 *
 * Used by tracking screens, where the useful sentence changes shape as the
 * estimate passes: a duration while it is still ahead, a clock time once it is
 * not. `Date.now()` is passed in rather than read here so a screen that is
 * already ticking can pass its own `now` and keep both halves consistent.
 */
export function describeArrival(order, now = Date.now()) {
  const arrival = estimatedArrivalDate(order);
  if (!arrival) return '';

  const minutesLeft = Math.round((arrival.getTime() - now) / 60000);
  if (minutesLeft > 1) return `in about ${minutesLeft} min`;
  if (minutesLeft > -60) return `arriving now`;
  return `expected ${formatClockTime(arrival)}`;
}

export default {
  APP_TIME_ZONE,
  parseServerTimestamp,
  toDate,
  formatClockTime,
  formatDate,
  formatDayDate,
  formatDateTime,
  istDayKey,
  minutesBetween,
  minutesSince,
  timeAgo,
  getEstimatedMinutes,
  estimatedArrivalDate,
  formatEstimatedArrival,
  describeArrival,
  istMinutesSinceMidnight,
  parseHHMM,
  orderingStatus,
  ORDERING_HOURS
};

/**
 * Ordering-hours check for the browser.
 *
 * The restaurant trades 10:30 to 22:00 IST every day. The boundaries are
 * inclusive: 10:30:00 opens, 22:00:00 closes, and anything after 22:00:00 or
 * before 10:30:00 is outside hours. The check is against Asia/Kolkata, never
 * the customer's device clock, so a phone set to the wrong timezone cannot
 * place an order the kitchen would never accept.
 *
 * The times come from `settings.opening_time` / `settings.closing_time`, which
 * CartContext loads from `/api/settings`, and fall back to the constants below
 * when they are absent - the same defaults the server uses, so the two sides
 * cannot drift apart.
 */
export const ORDERING_HOURS = {
  DEFAULT_OPENING: '10:30',
  DEFAULT_CLOSING: '22:00',
  TIMEZONE: 'Asia/Kolkata'
};

/** Minutes since midnight in IST for a given instant. */
export function istMinutesSinceMidnight(value = Date.now()) {
  const date = new Date(Number(value));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'
  }).formatToParts(date);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return h * 60 + m;
}

/** Parse a `HH:MM` string into minutes since midnight, or null when malformed. */
export function parseHHMM(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function formatHHMM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Is ordering open right now?
 *
 * `opening`/`closing` are `HH:MM` strings; when omitted the module defaults
 * apply. Returns an object describing the outcome rather than a bare boolean so
 * a caller can surface a message that names the actual hours.
 */
export function orderingStatus(opening, closing) {
  const openMin = parseHHMM(opening) ?? parseHHMM(ORDERING_HOURS.DEFAULT_OPENING);
  const closeMin = parseHHMM(closing) ?? parseHHMM(ORDERING_HOURS.DEFAULT_CLOSING);
  if (openMin == null || closeMin == null) {
    return { open: false, reason: 'Ordering hours are not configured.' };
  }
  const now = istMinutesSinceMidnight();
  // Both boundaries are inclusive: 10:30:00 opens and 22:00:00 closes, so a
  // request that lands on either minute is accepted and one that lands on
  // 22:01 is not. `istMinutesSinceMidnight` truncates to whole minutes, so
  // the comparison is exact to the minute.
  const openNow = now >= openMin && now <= closeMin;
  return {
    open: openNow,
    opening: formatHHMM(openMin),
    closing: formatHHMM(closeMin),
    now: formatHHMM(now)
  };
}
