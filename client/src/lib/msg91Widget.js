/**
 * The MSG91 OTP Widget, as the browser sees it.
 *
 * MSG91 splits its OTP flow across two credentials, and this file is on the side of
 * that split where nothing is secret. The widget token it configures is the
 * browser-facing half - the one MSG91's own documentation says to put in this
 * script - and it can do nothing on its own: with it you can ask MSG91 to text a
 * number and read back your own widget's state. Deciding whether a number is
 * verified is done by the account authkey, which is in the server's environment and
 * never reaches a browser, a bundle, or this file.
 *
 * That is why the configuration is fetched from the server rather than declared in
 * the client. It keeps the widget settings in one place, next to the authkey they
 * belong with, and it means there is no MSG91 value in client/.env, no VITE_
 * variable, and nothing hardcoded here for a secret to hide in.
 *
 * Nothing in this file logs. The access token the widget returns is a live
 * credential for as long as it is valid, and a console.log is the last place anyone
 * wants it to end up.
 */
import { apiBase as API_BASE } from './apiBase';

// MSG91's Web SDK, loaded on demand. Not in index.html: it is only needed once
// somebody reaches the code step, and a third-party script on the sign-in page's
// critical path is a dependency nobody asked for.
const SDK_SRC = 'https://verify.msg91.com/otp-provider.js';

// How long to wait for the SDK file to arrive, and how long for the widget to be
// genuinely ready. Both bounded. The second is one deadline rather than two because
// it waits on one condition - methods published and configuration loaded - and the
// configuration is the slower of the two by a wide margin.
const SDK_LOAD_TIMEOUT_MS = 15_000;
const WIDGET_READY_TIMEOUT_MS = 15_000;

// How long to wait for a widget method to answer before giving up on it.
//
// A deadline, because the widget does not always answer at all. It runs its captcha
// in an observable and, when that captcha cannot produce a token - a blocked network,
// a challenge that fails, a third-party script that never finishes - it logs the
// failure and returns without calling the method's success callback or its failure
// callback. A caller waiting on those two is therefore waiting on something that will
// never arrive, which is how a customer ends up looking at "Sending OTP..." for ever
// with no message and nothing to press.
//
// This turns that silence into an ordinary failure, which the screen can already show
// and recover from. It is deliberately not a retry: the send is not repeated, because
// the whole point is that nobody knows whether the first attempt reached MSG91.
const WIDGET_CALL_TIMEOUT_MS = 45_000;

// How often to look. Often enough that nobody notices, rarely enough that a fifteen
// second wait is around seventy checks rather than thousands.
const READY_POLL_MS = 150;

/**
 * What a customer is told when the widget never finishes booting.
 *
 * Deliberately says nothing about why. By the time this fires the possible causes -
 * a blocked third-party script, a network that dropped the SDK, a widget configured
 * in a way this app cannot drive - are indistinguishable from here, and naming one
 * of them would send the person to fix the wrong thing. It also names no token, no
 * key and no number, because the failure is about the widget and nothing else.
 */
const WIDGET_INIT_TIMEOUT_MESSAGE = 'MSG91 OTP widget failed to initialize. Please refresh and try again.';

let sdkPromise = null;
let widgetPromise = null;

// The one script element, held so a retry re-uses it rather than adding a second
// copy of a script this size to the page. Cleared when a load genuinely fails, so
// that a retry after a real network failure is able to fetch it again.
let scriptElement = null;

/**
 * Turn ten digits into the identifier MSG91 wants: country code, no plus sign.
 */
export function toIdentifier(phone) {
  return `91${String(phone || '').replace(/\D/g, '')}`;
}

/**
 * A message a person can act on, out of whatever the widget handed back.
 *
 * The widget reports failures as strings, as objects, or as an Error depending on
 * which of its methods failed, so all three are read. The result is only ever used
 * for display - it is never logged, and it is never trusted for anything.
 */
function toMessage(rejection, fallback) {
  if (typeof rejection === 'string' && rejection.trim()) return rejection.trim();
  const candidate = rejection?.message || rejection?.error || rejection?.data?.message;
  if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  return fallback;
}

/**
 * Does this string look like the access token, rather than an id or a sentence?
 *
 * A JWT is three dot-separated parts, which no MSG91 id or message ever is - a
 * request id is a flat hex string, and a refusal is English. The length is a floor
 * rather than a ceiling, so a future token shape still passes.
 */
function looksLikeAccessToken(value) {
  const candidate = value.trim();
  if (candidate.length <= 20) return false;
  if (candidate.split('.').length === 3) return true;
  // Not a JWT, so only accept it on a success if it cannot be an id either: MSG91's
  // request ids are pure hex, and this is the fallback for a token that arrives
  // without the usual punctuation.
  return /^[0-9a-f]+$/i.test(candidate) === false;
}

/**
 * Pull the access token out of a successful widget response.
 *
 * The field it arrives in is the whole difficulty, and getting it wrong is silent
 * and total: the code is verified by MSG91, the OTP is consumed, and this returns an
 * empty string, so the screen reports a failure that never happened and the only way
 * forward - trying the same code again - is refused by MSG91 as already verified.
 *
 * On a completed verification MSG91 answers `{"type":"success","message":"<token>"}`.
 * The token is the entire body of `message`; there is no `access_token` key in it at
 * all. The invisible-OTP case is the mirror image, answering `access-token` while
 * `message` holds a request id, so the named fields are read first and `message` only
 * afterwards, and only on a success.
 *
 * Returns an empty string when there is nothing that looks like a token, and the
 * caller treats that as a failure - which is correct, because a response with no
 * token in it has verified nothing.
 */
export function readAccessToken(payload) {
  if (!payload || typeof payload !== 'object') return '';

  const sources = [payload, payload.data, payload.response, payload.d];

  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of ['access-token', 'access_token', 'accessToken']) {
      const value = source[key];
      if (typeof value === 'string' && looksLikeAccessToken(value)) return value.trim();
    }
  }

  // Only ever on a success. On a failure `message` is a sentence - "invalid otp" -
  // and reading it here would hand the backend a sentence in place of a token.
  if (payload.type === 'success') {
    for (const source of sources) {
      const message = source?.message;
      if (typeof message === 'string' && looksLikeAccessToken(message)) return message.trim();
    }
  }

  return '';
}

/** Have the widget published its methods yet? */
function isWidgetReady() {
  if (typeof window === 'undefined') return false;
  return (
    typeof window.sendOtp === 'function' &&
    typeof window.retryOtp === 'function' &&
    typeof window.verifyOtp === 'function'
  );
}

/**
 * What the widget says about itself, or null before it can say anything.
 *
 * Public configuration only - widget type, captcha settings, retry channels. Read
 * for shape and for decisions, never written anywhere.
 */
function widgetData() {
  if (typeof window === 'undefined' || typeof window.getWidgetData !== 'function') return null;
  try {
    return window.getWidgetData() || null;
  } catch {
    return null;
  }
}

/**
 * Is the widget genuinely ready to accept a request?
 *
 * This is the check that was missing, and its absence is the whole of the "Invalid
 * Captcha Token" bug. The widget publishes `sendOtp` and its configuration are two
 * separate events, and the second one arrives much later: the SDK calls
 * `exposeMethodsToWindow()` synchronously while it boots, then fetches the widget's
 * settings over the network. So for the first second or two of its life the widget
 * can be asked to send a code and will do exactly that - straight past the branch
 * that acquires a captcha token, because it does not yet know this widget needs one.
 * The request goes out with no token, and MSG91 refuses it.
 *
 * `widgetId` is the marker for the second event, because it is only ever present in
 * a configuration that genuinely came back from MSG91. Waiting for it is waiting for
 * the widget to know what it is, which is the thing that has to be true before a
 * send can carry the right token.
 */
function isWidgetUsable() {
  return isWidgetReady() && Boolean(widgetData()?.widgetId);
}

/**
 * Wait for a condition, polling, with a hard deadline.
 *
 * One timer outstanding at a time and each firing leading to exactly one check, so
 * a condition that never becomes true produces a bounded wait rather than a loop
 * that spins for as long as the tab is open. One resolve or one reject, never both.
 */
function waitUntil(isSatisfied, { timeoutMs, timeoutMessage }) {
  if (isSatisfied()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let timer = null;

    const stop = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const check = () => {
      if (isSatisfied()) {
        stop();
        resolve();
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        stop();
        reject(new Error(timeoutMessage));
        return;
      }

      timer = setTimeout(check, READY_POLL_MS);
    };

    timer = setTimeout(check, READY_POLL_MS);
  });
}

/** Wait for the widget to be usable: methods published and configuration loaded. */
function waitForWidgetUsable() {
  return waitUntil(isWidgetUsable, {
    timeoutMs: WIDGET_READY_TIMEOUT_MS,
    timeoutMessage: WIDGET_INIT_TIMEOUT_MESSAGE
  });
}

/** Load the Web SDK once. Cached, including the failure - a retry re-attempts. */
function loadSdk() {
  // Checked first, so a retry costs nothing and a page that already has the script
  // never re-injects it.
  if (typeof window !== 'undefined' && typeof window.initSendOTP === 'function') {
    return Promise.resolve();
  }

  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('SMS verification needs a browser.'));
      return;
    }

    let settled = false;
    let timer = null;

    const cleanUp = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (scriptElement) {
        scriptElement.removeEventListener('load', onLoad);
        scriptElement.removeEventListener('error', fail);
      }
    };

    // A failed load is the one case where the element is thrown away, so the next
    // attempt really does fetch the script again. Waiting on an element that has
    // already errored would hang until the timeout on an event that cannot fire twice.
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanUp();
      if (scriptElement) {
        scriptElement.remove();
        scriptElement = null;
      }
      reject(new Error('We could not reach the SMS verification service. Please check your connection and try again.'));
    };

    const onLoad = () => {
      if (settled) return;
      // The file arrived, which is not the same thing as the widget being usable -
      // that is waitForWidgetReady's job. But a file that never defined initSendOTP is
      // a failure worth reporting now rather than fifteen seconds from now.
      if (typeof window.initSendOTP !== 'function') {
        fail();
        return;
      }
      settled = true;
      cleanUp();
      resolve();
    };

    // One element, ever. Adding a second copy of a script this size because a retry
    // happened to arrive first would be its own kind of bug.
    if (!scriptElement) {
      scriptElement = document.createElement('script');
      scriptElement.src = SDK_SRC;
      scriptElement.async = true;
      document.head.appendChild(scriptElement);
    }

    scriptElement.addEventListener('load', onLoad);
    scriptElement.addEventListener('error', fail);

    timer = setTimeout(fail, SDK_LOAD_TIMEOUT_MS);
  });

  // A rejected load must not be cached, or one network hiccup would keep the sign-in
  // screen broken for the rest of the session.
  sdkPromise.catch(() => {
    sdkPromise = null;
  });

  return sdkPromise;
}

/**
 * Configure the widget, once per page, and do not resolve until it can be used.
 *
 * `exposeMethods: true` is what moves the OTP entry into this app: the widget stops
 * rendering its own popup and instead publishes `sendOtp`, `retryOtp` and
 * `verifyOtp` on `window`, which the sign-in screen drives from its own `OtpBoxes`
 * input. That is why the code step still looks exactly as it always did.
 *
 * This is called once per page load and that is not an optimisation, it is a
 * requirement. The SDK publishes those six methods through a single guarded call:
 * it defines them only when *all* of them are absent, and it defines them
 * non-writable and non-configurable, so they can never be replaced afterwards.
 * Booting a second widget therefore builds a second <msg91-otp-provider> while
 * `window.sendOtp` keeps pointing at the first, now detached, one - every call
 * would go to a widget nobody can see. So the guard below is the only safe answer
 * to a second call, and the phone number is passed per-send to `sendOtp` instead of
 * being baked into the widget, which is exactly what the widget's own API is for.
 *
 * No captcha is configured, and that is deliberate rather than an omission. The SDK
 * branches on `exposeMethods && !captchaRenderId` and, on that branch, runs its own
 * invisible hCaptcha and attaches the resulting token to the request itself. Naming
 * a `captchaRenderId` selects the *other* branch, where the page is expected to own
 * a captcha and hand the token over - and then the SDK runs its captcha anyway, so
 * two hCaptcha widgets are alive at once. The page's copy is never the one the
 * request is signed with, MSG91 rejects the token, and the failure surfaces as the
 * deliberately uninformative "Invalid Captcha Token." Letting the widget own its own
 * captcha is both the branch it is built for and the only one that does not fight it.
 *
 * The config-level `success`/`failure` handlers do nothing on purpose: with the
 * methods exposed, results arrive in each method's own callbacks, and a second path
 * to the same event is a second way to submit a verification twice.
 *
 * Resolving only once the widget is usable is the whole contract of this function:
 * every caller is entitled to assume that awaiting it means the next line may safely
 * call `window.sendOtp`. Callers do not check, and they should not have to.
 */
export function initWidget() {
  if (widgetPromise) return widgetPromise;

  widgetPromise = (async () => {
    const response = await fetch(`${API_BASE}/auth/msg91-widget-config`);
    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      // The server says which key is missing, in a message written for a person
      // setting this up rather than for a customer. It is passed through as-is
      // because during setup it is the only useful thing on the screen.
      throw new Error(data?.message || 'SMS verification is not available right now.');
    }

    await loadSdk();

    // Boot the widget only if it is not already up - see the note above on why a
    // second boot is not merely wasteful.
    if (!isWidgetReady()) {
      window.initSendOTP({
        widgetId: data.widgetId,
        tokenAuth: data.tokenAuth,
        exposeMethods: true,
        success: () => {},
        failure: () => {}
      });
    }

    // By the time this resolves, the very next line can send a request, and the
    // widget knows enough about itself to put a valid captcha token on it. Both
    // halves matter: waiting only for the methods is what produced the tokenless
    // request that MSG91 rejected.
    await waitForWidgetUsable();

    return data;
  })();

  // A rejected init must not be cached, or one failure would keep the sign-in
  // screen broken for the rest of the session. The retry is the person's next tap,
  // not a loop: nothing here re-arms on its own, and every wait below always ends in
  // exactly one resolve or one reject.
  widgetPromise.catch(() => {
    widgetPromise = null;
  });

  return widgetPromise;
}

/**
 * Call one of the widget's published methods and wait for its answer.
 *
 * The widget's methods all take the operation's own arguments, then a success and a
 * failure callback - and then, on the two that continue an existing request, the
 * request id *after* the callbacks. So the request id cannot simply be appended with
 * the rest of the arguments: doing that puts it where the success callback belongs,
 * moves the real callbacks along by one, and ships a callback function to MSG91 as
 * the id of the request being answered. It is passed separately for exactly that
 * reason, and it is only ever sent on a method that accepts one.
 *
 * The result of a failure is never logged; it becomes an Error to display.
 *
 * The missing-method check is a fallback, not the ordinary path: `initWidget` has
 * already waited for these to exist, so a caller that awaited it is entitled to
 * assume they are there. Reaching the branch means the widget booted and then lost
 * them - a reloaded page, a re-bootstrapped component - which is a different thing
 * from not having booted at all, and is worded as such.
 */
function callWidget(method, args, { requestId, fallbackMessage, timeoutMessage } = {}) {
  return new Promise((resolve, reject) => {
    const fn = typeof window === 'undefined' ? undefined : window[method];
    if (typeof fn !== 'function') {
      reject(new Error('The SMS verification service is no longer responding. Please refresh the page and try again.'));
      return;
    }

    // One deadline for the whole call. Cleared on either outcome, so a method that
    // does answer leaves nothing running behind it, and a settled promise ignores a
    // timer that fires afterwards - there is no second settlement and no unhandled
    // rejection either way.
    let timer = null;
    const settle = (settleFn, value) => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      settleFn(value);
    };

    timer = setTimeout(() => {
      settle(reject, new Error(timeoutMessage));
    }, WIDGET_CALL_TIMEOUT_MS);

    const onSuccess = (data) => settle(resolve, data);
    const onFailure = (error) => settle(reject, new Error(toMessage(error, fallbackMessage)));

    fn(...args, onSuccess, onFailure, ...(requestId ? [requestId] : []));
  });
}

/**
 * Wait until the widget is able to accept a request, and say why if it never is.
 *
 * Run before every send and resend rather than once at start-up, for the same
 * reason the readiness check exists at all: a widget that has published its methods
 * is not yet a widget that knows what it is, and the difference is invisible from
 * the outside. The widget is booted exactly once per page, so this is cheap - the
 * common case is a single property read and an immediate return.
 */
async function ensureUsable() {
  if (isWidgetUsable()) return;
  await waitForWidgetUsable();
}

/**
 * Which channel a resend should go over.
 *
 * A plain OTP widget takes no channel and resends the way it was sent. A widget of
 * the more advanced type insists on one and refuses the call without it - the SDK
 * answers with "Channel not provided in retryOtp() method." - so rather than
 * guessing, the widget's own configuration is read and its first configured retry
 * channel is used. That is the channel MSG91 itself published for this widget, so it
 * is the one the resend is expected to use.
 */
function retryChannel() {
  const data = widgetData();
  if (!data) return null;
  if (String(data.widgetType?.value) !== '2') return null;

  const process = (data.processes || []).find((entry) => entry?.channel?.value);
  return process?.channel?.value || null;
}

/**
 * Ask MSG91 to send a code to this number.
 *
 * The number is an argument rather than part of the widget's configuration, which is
 * what lets the widget be booted once and still serve every number this screen is
 * used with. Returns whatever MSG91 answered with - including its request id, which
 * the resend and the verification both use.
 */
export async function sendOtp(phone) {
  await ensureUsable();
  return callWidget('sendOtp', [toIdentifier(phone)], {
    fallbackMessage: 'We could not send a code to this number. Please try again.',
    timeoutMessage: 'We could not reach the SMS service while sending your code. Please check your connection and try again.'
  });
}

/**
 * Ask MSG91 to send the code again.
 *
 * The widget's own retry method, never a fresh send and never anything local: the
 * widget holds the transaction it started, and a resend has to continue that one
 * rather than begin another. The request id is passed through when there is one,
 * because a widget of the more advanced type matches the resend to the request it is
 * answering.
 */
export async function retryOtp(requestId) {
  await ensureUsable();

  return callWidget('retryOtp', [retryChannel()], {
    requestId: requestId || '',
    fallbackMessage: 'We could not resend the code. Please try again.',
    timeoutMessage: 'We could not reach the SMS service while resending your code. Please try again.'
  });
}

/**
 * Have the widget check the code the person typed, and return its access token.
 *
 * The raw digits go to MSG91 and only to MSG91. They are never sent to this
 * application's backend, which is why the flow continues with an access token rather
 * than with the code.
 */
export async function verifyOtp(otp, requestId) {
  return callWidget('verifyOtp', [otp], {
    requestId: requestId || '',
    fallbackMessage: 'That code is not valid. Please check it and try again.',
    timeoutMessage: 'We could not reach the SMS service to check your code. Please try again.'
  });
}

/**
 * Pull MSG91's request id out of a response.
 *
 * Needed so a resend and a verification can be tied to the request that produced the
 * code. Optional throughout: a widget that does not report one is still driven
 * correctly, it simply has nothing to pass back. Never logged.
 *
 * The field it arrives in is not the one it is called, which is the part worth
 * knowing. The widget's send answers `{"message":"<id>","type":"success"}` - the id
 * is the whole body of `message`, and there is no `requestId` key anywhere in it. The
 * SDK reads that same field internally and falls back to its own copy when a caller
 * passes nothing, so a flow works whether or not this finds it; it is read here so
 * this app knows which request a code belongs to, and so a resend is a real retry of
 * that request rather than a second message.
 *
 * `message` is only read when it looks like an id, because on a failure it is a
 * sentence instead - "invalid otp", "reqId is required." - and none of those are hex.
 */
export function readRequestId(payload) {
  if (!payload || typeof payload !== 'object') return '';

  const sources = [payload, payload.data, payload.response, payload.d, payload.request];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of ['requestId', 'request_id', 'reqId']) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }

  // Only ever on a success, and only when it is the long hex string MSG91 issues.
  const isSuccess = payload.type === 'success';
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const message = source.message;
    if (typeof message === 'string' && /^[0-9a-f]{16,}$/i.test(message.trim())) {
      if (source === payload && !isSuccess) continue;
      return message.trim();
    }
  }

  return '';
}
