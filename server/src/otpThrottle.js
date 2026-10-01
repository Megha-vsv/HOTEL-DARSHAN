/**
 * Request throttling for the customer sign-in path, in memory.
 *
 * The customer path stopped writing its own OTP rows when MSG91 took over sending
 * and checking codes, and those rows were what the old resend cooldown was measured
 * against. Something has to take that job's place, and this is it: without it,
 * "Continue" on the sign-in screen is a button that makes this server ask MSG91 to
 * text any number in India, as fast as the browser can be clicked, at the
 * restaurant's expense.
 *
 * In memory, and that is a deliberate limit rather than an oversight. The limit that
 * matters is the one in front of a paid SMS, it is enforced inside a single Node
 * process, and there is one. A shared store would be the right answer the moment
 * this were scaled horizontally, and it is the right answer the moment a bypass
 * through more than one instance is worth worrying about - neither is today. What it
 * does buy immediately is that it cannot be reset by restarting a process the
 * attacker controls, and it needs no schema change to the OTP table that the staff
 * sign-in path still depends on.
 *
 * Counters are timestamps in a list, and a list is pruned of its expired entries on
 * every call, so a key that stops being used costs one map entry and then nothing.
 */
const buckets = new Map();

// Bounded, so a flood of one-off keys cannot grow this map without limit. When the
// cap is reached the expired entries are swept; if everything is live, the oldest
// bucket goes. Either way the throttle degrades to "forget the oldest attempts",
// which is a weaker limit, not a failure.
const MAX_BUCKETS = 5_000;

/**
 * Count one attempt against `key` and say whether it is allowed.
 *
 * Returns `{ allowed, retryAfter }`, where `retryAfter` is whole seconds until the
 * oldest counted attempt falls out of the window - the number to put in a 429 so
 * the screen can tell the person how long to wait rather than just refusing them.
 */
export function throttle(key, { limit, windowMs }) {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) sweep(now);

  const hits = (buckets.get(key) || []).filter((time) => now - time < windowMs);

  if (hits.length >= limit) {
    buckets.set(key, hits);
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
    return { allowed: false, retryAfter };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, retryAfter: 0 };
}

/** Drop buckets that can no longer refuse anything, then the oldest if still over cap. */
function sweep(now) {
  for (const [key, hits] of buckets) {
    const live = hits.filter((time) => now - time < 60 * 60 * 1000);
    if (live.length === 0) buckets.delete(key);
    else buckets.set(key, live);
  }

  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next();
    if (oldest.done) break;
    buckets.delete(oldest.value);
  }
}

/** Forget everything. Exists for tests, and for nothing else. */
export function resetThrottle() {
  buckets.clear();
}
