/**
 * Phone number input rules, shared by the customer sign-in screen and the staff
 * portal so the two cannot drift apart.
 *
 * Both screens already stripped non-digits on change, but the stripping itself was
 * wrong in one case that matters. The field displays "+91" as a fixed prefix, so
 * pasting a number the way people actually keep it - "+91 98765 43210", or
 * "0091 98765 43210" - produced "9198765432" once the non-digits were removed and
 * the result was cut to ten characters. That is a well-formed ten-digit number
 * starting with 9, so it passed validation, and a one-time code was sent to a number
 * that belongs to somebody else. Stripping characters was not enough; the country
 * code the field is already showing has to come back off.
 *
 * The leading "91" is only dropped when more than ten digits arrived, which is
 * exactly the shape a pasted full number has. A genuine ten-digit mobile beginning
 * 91 - 9198765432 is one - is ten digits already, so the length test leaves it
 * alone. That test is the whole reason this is safe.
 */

/** An Indian mobile number, without the country code. */
export const PHONE_LENGTH = 10;

/**
 * Reduce whatever arrived in the field to at most ten digits, removing a country
 * code that a paste brought with it.
 *
 * Never throws and never returns a non-digit, so it is safe to call on every
 * keystroke, on a paste, and on whatever the browser hands over mid-edit.
 */
export function sanitizePhoneInput(raw) {
  let digits = String(raw == null ? '' : raw).replace(/\D/g, '');

  // International dialling prefix. Stripped before the country-code test so that
  // "0091..." is measured as the twelve digits it really is.
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (digits.length > PHONE_LENGTH && digits.startsWith('91')) {
    digits = digits.slice(2);
  }

  return digits.slice(0, PHONE_LENGTH);
}

/**
 * Whether a sanitised value is a real Indian mobile number, and so may be sent a
 * one-time code.
 *
 * Exactly ten digits, starting 6-9. Anything shorter is refused: the length is
 * checked here rather than only in the disabled state of the button, so the
 * one-time code request is never made for a number that is still being typed.
 */
export function isValidIndianMobile(value) {
  return /^[6-9]\d{9}$/.test(String(value == null ? '' : value).replace(/\D/g, ''));
}

/**
 * Build the onChange handler for a phone field.
 *
 * Two things are wrong with the obvious implementation - sanitise in onChange and
 * call setState - and both are worth recording because each one looks like the code
 * is already right.
 *
 * 1. React diffs a controlled input against the value *it* last rendered. Typing "a"
 *    makes the DOM "a" and fires onChange; the sanitiser returns ""; the new props
 *    are "" and the old props were also "", so React sees no change to make and
 *    leaves the DOM alone. The letter stays on screen and the field looks exactly as
 *    if nothing were sanitising it. Digits appear to work, which makes it look like
 *    only the letters are broken. Writing the sanitised value back to the element
 *    first is what closes it.
 *
 * 2. This handler deliberately does not rely on the input's maxLength attribute. A
 *    maxLength caps the *raw* value the browser accepts, so a paste of
 *    "abc95861-32916xyz" is cut to its first ten characters - "abc95861-3" - and the
 *    sanitiser then has only six digits left to work with. The field silently kept
 *    the wrong number. The cap belongs here, after the characters have been removed,
 *    so the ten that are kept are ten digits.
 *
 * Shared so the customer screen and the staff portal cannot fix one and forget the
 * other.
 */
export function phoneInputOnChange(setValue) {
  return (event) => {
    const element = event.target;
    const next = sanitizePhoneInput(element.value);
    if (element.value !== next) element.value = next;
    setValue(next);
  };
}
