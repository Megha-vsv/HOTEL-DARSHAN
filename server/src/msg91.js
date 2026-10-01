/**
 * MSG91, as the server sees it.
 *
 * The division of labour here is the whole security design, so it is worth stating
 * plainly before the code:
 *
 *   the browser holds a WIDGET token, the server holds the ACCOUNT authkey.
 *
 * MSG91 ships those as two different credentials on purpose - the widget token is
 * the browser-facing half, scoped to one widget, and it is what the Web SDK is
 * documented to be configured with. The account authkey is the server-facing half,
 * and it is the only credential that can ask MSG91 to confirm that a verification
 * actually happened. Nothing in this file may be bundled, and nothing below returns
 * the authkey to a caller.
 *
 * The consequence the rest of the app depends on: MSG91 is the only thing that can
 * decide a mobile number is verified. The browser's word for it - the access token
 * the widget hands back - is worth nothing on its own, because this file will not
 * believe it until MSG91 says so, and the number it resolves is read out of MSG91's
 * answer rather than out of the request that carried the token.
 *
 * Environment values are read on every call, never captured into a module constant.
 * That is deliberate belt-and-braces: even if something about the import order
 * changed, a key that is looked up when it is needed cannot have been read before
 * dotenv ran.
 */
import { normalizePhone } from './otpService.js';

const MSG91_CONTROL_ORIGIN = 'https://control.msg91.com';
const VERIFY_ACCESS_TOKEN_PATH = '/api/v5/widget/verifyAccessToken';

// A verification is a network round trip to somebody else's server, made while a
// customer waits on a spinner. Bounded, so a slow or hung upstream becomes a clear
// error the screen can show rather than a request that never comes back.
const REQUEST_TIMEOUT_MS = 10_000;

// The three keys this integration needs. Named, never valued: the error a
// misconfigured server returns lists which of these is missing, which is the one
// piece of information an operator needs and is not a secret.
const REQUIRED_KEYS = ['MSG91_AUTHKEY', 'MSG91_WIDGET_ID', 'MSG91_WIDGET_TOKEN'];

/** Read an environment value, trimmed. Never logs, never returns anything but the value. */
function readEnv(name) {
  return String(process.env[name] || '').trim();
}

/** Which of the required keys are absent. Names only - never values, never a prefix. */
export function missingMsg91Keys() {
  return REQUIRED_KEYS.filter((key) => !readEnv(key));
}

/**
 * Why the customer SMS path cannot run, or null when it can.
 *
 * Checked on every request rather than cached, so that fixing a missing key and
 * restarting is the only thing needed to bring verification back. There is
 * deliberately no "assume it works" branch: an unconfigured server has to say so,
 * because the alternative is a sign-in screen that quietly accepts nobody and gives
 * no reason why.
 */
export function msg91KeyProblem() {
  const missing = missingMsg91Keys();
  if (missing.length > 0) {
    return `Missing: ${missing.join(', ')}.`;
  }

  // The guard that matters most, and the reason this function exists rather than a
  // plain boolean.
  //
  // The widget token is handed to every browser that opens the sign-in screen, so
  // putting the account authkey in that field would publish the restaurant's MSG91
  // account key to the public - while every sign-in still appeared to work, because
  // the value was valid for the widget too. Nothing about the symptom says "key
  // leak": the screens behave perfectly. The only place it can be caught is here,
  // comparing the two values before either is used, and turning a silent
  // compromise into a sign-in screen that explains the mistake instead.
  if (readEnv('MSG91_WIDGET_TOKEN') === readEnv('MSG91_AUTHKEY')) {
    return 'MSG91_WIDGET_TOKEN holds the same value as MSG91_AUTHKEY. The widget token is a separate credential, created in the MSG91 panel under Token; putting the account authkey there would publish it to every browser that loads the sign-in screen.';
  }

  if (String(process.env.MSG91_OTP_ENABLED || '').trim().toLowerCase() === 'false') {
    return 'Switched off on the server (MSG91_OTP_ENABLED=false).';
  }

  return null;
}

/** Is the customer SMS path usable at all? */
export function isMsg91Configured() {
  return msg91KeyProblem() === null;
}

/**
 * The widget-side configuration, for the browser.
 *
 * This is the ONLY function in the codebase that hands anything to the client, and
 * what it hands over is the widget token - the credential MSG91 designed to be
 * public, and the one the Web SDK cannot run without. The account authkey is read
 * here and deliberately not returned; it is used a few lines below by the server
 * and never leaves this process.
 */
export function widgetConfig() {
  return {
    widgetId: readEnv('MSG91_WIDGET_ID'),
    tokenAuth: readEnv('MSG91_WIDGET_TOKEN')
  };
}

/** The one sentence a misconfigured server says, naming only the keys and the fault. */
export function notConfiguredMessage() {
  const problem = msg91KeyProblem();
  if (problem) return `SMS verification is not available on the server. ${problem}`;
  return 'SMS verification is not available on the server.';
}

/**
 * Ask MSG91 to perform one HTTP request, without ever putting a secret in the URL
 * or in a log line.
 *
 * The authkey travels as a header. That is not a style preference: MSG91's own
 * guidance is that the key must be sent as a header, and a query string ends up in
 * proxy logs, browser history and access logs on every hop between here and them.
 */
async function msg91Request(path, body) {
  const authkey = readEnv('MSG91_AUTHKEY');
  if (!authkey) throw new Error('MSG91_AUTHKEY is not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${MSG91_CONTROL_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authkey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Confirm with MSG91 that a widget access token really is a completed verification,
 * and report which number it verified.
 *
 * Returns `{ ok: true, phone }` where `phone` is the ten-digit number taken from
 * MSG91's own answer, or `{ ok: false, reason }` where reason is one of:
 *
 *   not_configured  the server has no authkey to ask with
 *   missing          no token was presented at all
 *   unreachable      MSG91 could not be reached, or did not answer in time
 *   rejected         MSG91 says the token is not a valid, unconsumed verification
 *   no_number        MSG91 accepted the token but it names no usable mobile number
 *
 * The `phone` is the entire point of the call, and it is deliberately NOT taken from
 * the request. A caller that says "I verified 9586132916" is asserting something it
 * got to choose; the number here came from a party that did not know what the
 * request wanted. That difference is the entire authentication.
 *
 * Nothing secret is logged on any path. The access token is never logged, never
 * echoed back, never included in an error. The log lines carry a status and an
 * error class, which is all that is needed to tell a bad key from an expired code
 * from an unreachable host.
 */
export async function verifyWidgetAccessToken(accessToken) {
  const token = String(accessToken || '').trim();

  if (!token) return { ok: false, reason: 'missing' };

  // A JWT is a few hundred bytes. Anything approaching this is not a verification
  // token, and forwarding it would be handing a third party an unbounded body.
  if (token.length > 4096) return { ok: false, reason: 'rejected' };

  let result;
  try {
    result = await msg91Request(VERIFY_ACCESS_TOKEN_PATH, { 'access-token': token });
  } catch (error) {
    // AbortError is a timeout; anything else is DNS, TLS or a refused connection.
    console.error('MSG91 access token check could not reach MSG91:', error?.name || 'network error');
    return { ok: false, reason: 'unreachable' };
  }

  const { status, data } = result;

  // MSG91's widget endpoints answer an authentication failure with HTTP 200 and an
  // error body, so the status code alone is never proof of anything. Both have to
  // agree before this is treated as a verification.
  if (status !== 200 || !data || data.type !== 'success') {
    console.error('MSG91 access token check rejected:', {
      httpStatus: status,
      type: data?.type ?? null,
      code: data?.code ?? null
    });
    return { ok: false, reason: 'rejected' };
  }

  // On success MSG91 returns the identifier it verified, in international form
  // without a plus - "919586132916". That string is the only accepted source of a
  // number in this whole flow.
  const phone = normalizePhone(String(data.message || '').trim());
  if (!/^[6-9]\d{9}$/.test(phone)) {
    // A widget can be configured for email or for a number this project's rules do
    // not accept. Either way there is no customer to sign in, and saying so beats
    // guessing at a number.
    return { ok: false, reason: 'no_number' };
  }

  return { ok: true, phone };
}
