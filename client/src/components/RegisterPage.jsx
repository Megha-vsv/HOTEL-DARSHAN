import React, { useState, useRef, useMemo } from 'react';
import { User, ShieldCheck, CheckCircle2, Loader2, Mail, MapPin } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const COUNTRY_CODE = '+91';

/**
 * Customer registration, reached only after the number has been verified.
 *
 * The route here is fixed by the server, not chosen: `customer-verify-otp`
 * compared this number against the *customer* accounts and reported that there is
 * none. Someone who also works at the hotel arrives here too, because a staff row
 * says nothing about whether they have ordered from it. Working here and ordering
 * here are separate identities, and this page creates the second one.
 *
 * `registrationToken` is the server's signed claim that the number was verified,
 * and it is the only credential this page has. The code is not here, is not asked
 * for, and cannot be re-checked - it was spent proving the number, and this is
 * what carries that result forward. Submitting it is what creates the account; the
 * server reads the number out of the claim rather than from the form.
 */
export default function RegisterPage({ registrationToken, onSuccess, onBack }) {
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // The last digit auto-submits the OTP step, so a fast tap on the button here
  // would fire a second request against the same, now-consumed code.
  const inFlight = useRef(false);

  // Shown to the customer for reassurance only. The number the account is actually
  // created against is the one inside the signed claim, so editing or forging this
  // string changes nothing about where the account lands.
  const cleanPhone = useMemo(() => {
    try {
      const payload = JSON.parse(atob(registrationToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return String(payload.phone || '').replace(/\D/g, '');
    } catch {
      return '';
    }
  }, [registrationToken]);
  const formatted = cleanPhone.length === 10 ? `${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5, 10)}` : cleanPhone;

  // Optional here, but if it is typed it has to be usable: a malformed address
  // would be worse than none, since it is the only way back into the account.
  const trimmedEmail = email.trim();
  const emailLooksValid = trimmedEmail === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Please enter your full name.');
    if (!emailLooksValid) return setError('Please enter a valid email address, or leave it blank.');
    if (inFlight.current) return;

    inFlight.current = true;
    setLoading(true);
    try {
      // The claim, never the code. There is no code on this screen to submit and
      // none is asked for, so the "your code expired" message that used to appear
      // here - after the screen had already confirmed the same code was good - has
      // nothing left to be triggered by.
      const user = await register(name.trim(), registrationToken, { email: trimmedEmail, address: address.trim() });
      onSuccess?.(user);
    } catch (e) {
      setError(e.message || 'Unable to create your account.');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-neutral-200">
        <div className="p-5 sm:p-7">
          {/* The mark this screen has always carried: a red ShieldCheck tile over
              the Hotel Darshan wordmark. */}
          <div className="text-center mb-5">
            <div className="w-16 h-16 rounded-2xl bg-[#e53935] text-white flex items-center justify-center mx-auto mb-4 shadow-lg">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black text-neutral-900">Hotel Darshan</h1>
            <p className="text-sm text-neutral-500 mt-1">Create your account</p>
          </div>

          {/* A true statement about the number, and the reason this page exists. */}
          <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 mb-5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-emerald-900">Your mobile number has been verified.</p>
              <p className="text-xs text-emerald-700">
                {COUNTRY_CODE} {formatted}
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-neutral-600 mb-1">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-3.5 w-4 h-4 text-neutral-400" />
                <input
                  type="text"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full pl-10 pr-3 py-3 rounded-xl border border-neutral-200 outline-none focus:border-[#e53935] transition text-sm"
                />
              </div>
            </div>

            {/* Read-only, and shown rather than collected. The number is already
                proven; letting it be edited here would allow an account to be
                created against a number nobody verified, and that account could
                never sign in again. */}
            <div>
              <label className="block text-xs font-bold text-neutral-600 mb-1">Mobile Number</label>
              <div className="flex items-center border border-neutral-200 rounded-xl overflow-hidden bg-neutral-50">
                <span className="px-3 py-3 bg-neutral-100 text-neutral-700 font-bold text-sm border-r border-neutral-200 shrink-0">
                  {COUNTRY_CODE}
                </span>
                <span className="flex-1 min-w-0 pl-3 pr-3 py-3 text-sm text-neutral-700">{formatted}</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mr-3 shrink-0" />
              </div>
              <p className="text-xs text-neutral-500 mt-1.5">Verified. This is the number your order will be delivered to.</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-600 mb-1">
                Email <span className="font-normal text-neutral-400">(optional)</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 w-4 h-4 text-neutral-400" />
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-3 py-3 rounded-xl border border-neutral-200 outline-none focus:border-[#e53935] transition text-sm"
                />
              </div>
              <p className="text-xs text-neutral-500 mt-1.5">Optional. You can leave this blank and add it later.</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-600 mb-1">
                Address <span className="font-normal text-neutral-400">(optional)</span>
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3.5 w-4 h-4 text-neutral-400" />
                <textarea
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Where should we deliver?"
                  className="w-full pl-10 pr-3 py-3 rounded-xl border border-neutral-200 outline-none focus:border-[#e53935] transition text-sm resize-none"
                />
              </div>
              <p className="text-xs text-neutral-500 mt-1.5">Optional. You can set your location after signing in.</p>
            </div>

            <button
              type="submit"
              disabled={loading || !name.trim() || !registrationToken}
              className="w-full py-3.5 rounded-xl bg-[#e53935] text-white font-black disabled:opacity-60 transition text-sm min-h-[44px] flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Creating account...
                </>
              ) : (
                'Create Account & Continue'
              )}
            </button>

            {onBack && (
              <div className="text-center">
                <button type="button" onClick={onBack} className="text-sm font-bold text-neutral-500 hover:text-neutral-700">
                  Use a different number
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
