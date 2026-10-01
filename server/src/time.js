/**
 * Server-side time helpers.
 *
 * Storage is UTC everywhere — SQLite's `CURRENT_TIMESTAMP` for every order
 * column, `toISOString()` for every socket payload — and that is correct and is
 * not being changed. What needs care is the small number of places that have to
 * reason about a *calendar day* rather than an instant, because the restaurant
 * does not trade in UTC days.
 *
 * The concrete bug this exists for: order numbers were stamped with
 * `new Date().toISOString().slice(0, 10)`, which is today's date in **UTC**. An
 * order placed at 00:30 IST is 18:00 UTC the previous day, so it was numbered
 * `HD-20260929-001` while its own `created_at` — displayed to the customer as
 * the 30th — said the 30th. The order number and the order disagreed about what
 * day it was, and the same off-by-one would have split the daily counter
 * across two rows at the one hour of the day the restaurant is busiest after
 * midnight.
 *
 * India observes no daylight saving, so IST is a fixed +05:30 and a calendar
 * day is a fixed 5h30m shift from the UTC one. No timezone library is needed for
 * that, and none is installed.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The `YYYY-MM-DD` calendar date in IST for a given instant. */
export function istDateString(value = Date.now()) {
  return new Date(Number(value) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The same, as `YYYYMMDD`, for order-number prefixes. */
export function istCompactDateString(value = Date.now()) {
  return istDateString(value).replace(/-/g, '');
}

/**
 * SQLite stores `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker, and the
 * equivalent inline parse was repeated in three files. This is the one place it
 * happens, so a change to the storage format has a single place to be applied.
 */
export function parseSqliteTimestamp(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) return Number(raw);

  const normalised = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const alreadyZoned = normalised.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(normalised);
  const ms = Date.parse(alreadyZoned ? normalised : `${normalised}Z`);

  return Number.isFinite(ms) ? ms : null;
}

/**
 * Ordering-hours check, centralised in one place so the frontend and the backend
 * can never drift apart.
 *
 * The restaurant trades 10:30 to 22:00 IST every day. The boundaries are
 * inclusive: 10:30:00 opens, 22:00:00 closes, and anything after 22:00:00 or
 * before 10:30:00 is outside hours. The check is against Asia/Kolkata, never
 * the customer's device clock, so a phone set to the wrong timezone cannot
 * place an order the kitchen would never accept.
 *
 * The times live in settings.opening_time / settings.closing_time as `HH:MM` and
 * fall back to these constants when they are absent, so the values are
 * configurable from the admin panel without touching this file.
 */
export const ORDERING_HOURS = {
  DEFAULT_OPENING: '10:30',
  DEFAULT_CLOSING: '22:00',
  TIMEZONE: 'Asia/Kolkata'
};

/** Minutes since midnight in IST for a given instant. */
export function istMinutesSinceMidnight(value = Date.now()) {
  const d = new Date(Number(value) + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Parse a `HH:MM` string into minutes since midnight. Returns null for input
 * that is not a well-formed time, so a misconfigured setting fails closed
 * rather than silently allowing every order.
 */
export function parseHHMM(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is ordering open right now?
 *
 * `opening`/`closing` are `HH:MM` strings; when omitted the module defaults
 * apply. Returns an object describing the outcome rather than a bare boolean so
 * the caller can surface a message that names the actual hours.
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

function formatHHMM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default { istDateString, istCompactDateString, parseSqliteTimestamp, ORDERING_HOURS, istMinutesSinceMidnight, parseHHMM, orderingStatus };
