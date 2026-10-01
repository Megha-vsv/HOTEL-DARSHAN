import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChefHat, LogOut, ShieldCheck, Truck, ArrowLeft } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { useAuth } from '../context/AuthContext';
import { AdminThemeProvider } from '../context/ThemeContext';
import AdminView from './AdminView';
import KitchenView from './KitchenView';
import RiderView from './RiderView';
import OtpBoxes, { OTP_LENGTH } from './OtpBoxes';
import { sanitizePhoneInput, isValidIndianMobile, phoneInputOnChange } from '../lib/phoneInput';
import { initWidget, sendOtp as sendOtpWithWidget, retryOtp as retryOtpWithWidget, verifyOtp as verifyOtpWithWidget, readAccessToken, readRequestId } from '../lib/msg91Widget';

const OTP_RESEND_COUNTDOWN = 60;

// The admin role deliberately has no title/subtitle here: the Admin dashboard
// renders its own main header (page title + navigation), so this shell must not
// print a second branding bar above it.
const ROLE_META = {
  admin: { label: 'Owner / Admin', icon: ShieldCheck },
  chef: { label: 'Kitchen', icon: ChefHat, title: 'Hotel Darshan Kitchen', subtitle: 'Live kitchen queue and preparation workflow' },
  rider: { label: 'Delivery Rider', icon: Truck, title: 'Hotel Darshan Delivery', subtitle: 'Assigned deliveries, navigation & live location' },
};

// Staff sign-in is the mobile number the owner registered, then a real code sent by
// MSG91. There is no password to share around or leak, and the server refuses a
// number that is not staff before anything is texted to it.
//
// The code is MSG91's, exactly as it is for a customer, and the steps are the same
// three: the widget sends, the widget checks, and the server asks MSG91 which number
// the resulting token actually verified. What differs is the last step, and it is the
// one that matters - that number is then matched against a staff row, so a customer
// who completes a flawless verification still does not reach the staff portal.
function StaffLogin() {
  const { sendStaffOtp, verifyStaffWithMsg91 } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(Array(OTP_LENGTH).fill(''));
  const [resendCountdown, setResendCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // MSG91's id for the request this screen started. The resend and the verification
  // are both tied to it. A ref, because it is bookkeeping rather than anything to
  // render.
  const msg91RequestId = useRef('');
  // The number a code has actually gone out to. Keeps this to one send per number,
  // and is why returning to this step with a different number re-sends.
  const sentTo = useRef('');
  // One verification at a time. Without it a double tap, or OtpBoxes firing
  // onComplete as the last box fills, can spend the same code twice - and a spent
  // code is refused, so the second attempt would report the person's own correct code
  // as invalid.
  const inFlight = useRef(false);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => setResendCountdown((p) => (p <= 1 ? 0 : p - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  const cleanPhone = sanitizePhoneInput(phone);
  const validPhone = isValidIndianMobile(cleanPhone);

  const goToPortal = (staff) => {
    // A router navigation, not a private history write. Signing in from a
    // bookmarked /staff/admin/orders address has to land on the portal the role
    // grants, and the router is what decides what that address renders - so the
    // URL is moved through the same door as everything else.
    navigate(`/staff/${staff.role === 'admin' ? 'admin' : staff.role === 'chef' ? 'kitchen' : 'rider'}`, { replace: true });
  };

  // Open the code step.
  //
  // The server is asked first even though it sends nothing: it owns the staff
  // check, the MSG91 configuration check, and the rate limit on a request that will
  // cost money a moment later. A number that is not staff is refused here, before
  // any text goes anywhere.
  const requestOtp = async () => {
    setError('');
    if (!validPhone) return setError('Please enter a valid 10-digit Indian mobile number.');

    setLoading(true);
    try {
      const data = await sendStaffOtp(cleanPhone);
      // A reply naming a provider this screen cannot drive is a failure, not a
      // reason to show an empty code box that will never be filled.
      if (data.otpProvider !== 'msg91') {
        throw new Error('SMS verification is not available right now. Please try again later.');
      }
      setStep('otp');
      setOtp(Array(OTP_LENGTH).fill(''));
    } catch (e) {
      // A rate limit is the one refusal worth showing as a wait, because the
      // person did nothing wrong and can try again in a moment.
      if (e.code === 'OTP_COOLDOWN' && e.retryAfter) {
        setResendCountdown(e.retryAfter);
      }
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Send the code.
  //
  // An effect rather than part of requestOtp, because the send needs the widget
  // booted first and booting is asynchronous - it fetches its configuration, loads
  // a third-party script, and waits for the widget to publish its methods. Folding
  // that into the tap that got here would mean starting a request the screen is not
  // yet able to show the result of.
  //
  // A send that fails leaves the person on this step rather than throwing them back
  // to the number screen. There is no code on its way, but the number they typed is
  // still right, and sending them away from a form they filled in correctly is the
  // wrong answer to a service that was briefly unreachable.
  useEffect(() => {
    if (step !== 'otp' || !cleanPhone) return;
    if (sentTo.current === cleanPhone) return;

    let cancelled = false;
    setError('');

    (async () => {
      try {
        await initWidget();
        if (cancelled) return;
        const result = await sendOtpWithWidget(cleanPhone);
        if (cancelled) return;
        msg91RequestId.current = readRequestId(result);
        sentTo.current = cleanPhone;
        setResendCountdown(OTP_RESEND_COUNTDOWN);
      } catch (e) {
        if (cancelled) return;
        setError(e.message || 'We could not send a code to this number. Please try again.');
        setOtp(Array(OTP_LENGTH).fill(''));
      }
    })();

    return () => { cancelled = true; };
  }, [step, cleanPhone]);

  // Ask for the code again, on the channel the widget is configured for.
  //
  // The server is asked first even though it sends nothing, because it owns the
  // rate limit on a request that will cost money. Its refusal arrives as a
  // `retryAfter`, and that number becomes the countdown - so a person who taps
  // Resend too early is told how long to wait rather than simply being refused.
  const resendOtp = async () => {
    setError('');
    setLoading(true);
    try {
      try {
        await sendStaffOtp(cleanPhone);
      } catch (e) {
        if (e.code === 'OTP_COOLDOWN' && e.retryAfter) setResendCountdown(e.retryAfter);
        throw e;
      }

      await initWidget();
      // The widget's own retry, against the request it already started, with the id
      // of that request. Not a fresh send, and nothing local: a resend has to
      // continue MSG91's transaction or it is not a resend at all.
      //
      // Unless there is no transaction to continue. The first send can fail before
      // MSG91 ever answers - a captcha that cannot be solved, a service that stops
      // responding - and then no request exists and nothing was texted. Asking the
      // widget to retry a request that was never made would fail in a way the person
      // can do nothing about, because the only button on this screen is this one. So
      // the first genuine send happens in the effect above, and every resend after it
      // is a real retry.
      const hasRequest = Boolean(msg91RequestId.current);
      const result = hasRequest
        ? await retryOtpWithWidget(msg91RequestId.current)
        : await sendOtpWithWidget(cleanPhone);

      // A resend can answer with a new request id, and the next resend - and the
      // verification - belong to that one rather than the original.
      const nextRequestId = readRequestId(result);
      if (nextRequestId) msg91RequestId.current = nextRequestId;

      sentTo.current = cleanPhone;

      // The countdown restarts only now, because until this succeeds there is no new
      // code on its way and a ticking clock would be counting towards nothing.
      setResendCountdown(OTP_RESEND_COUNTDOWN);
      setOtp(Array(OTP_LENGTH).fill(''));
    } catch (e) {
      setError(e.message || 'We could not resend the code. Please try again.');
      setOtp(Array(OTP_LENGTH).fill(''));
    } finally {
      setLoading(false);
    }
  };

  // Check the code the person typed.
  //
  // Two parties to this step and both of them have to agree before anything is
  // signed in. The widget asks MSG91 whether the code is right, and on success hands
  // back an access token; the server then asks MSG91, with the authkey the browser
  // never sees, which number that token verified - and only then whether that number
  // is on the staff list.
  //
  // The six digits go to MSG91 and to nothing else. They are never sent to this
  // application's backend, which is why what comes back from the widget - a token -
  // is what the backend is given instead. There is no code on the server to compare
  // them to, and no response that carries a code to this screen.
  const verifyOtp = async (otpValue) => {
    const otpString = otpValue !== undefined ? otpValue : otp.join('');
    setError('');
    // Nothing is sent until there are six digits.
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(otpString)) return;
    // So that a verification can never go out without the request it belongs to and
    // answer with MSG91's "reqId is required." in place of a sentence somebody can do
    // something about.
    if (!msg91RequestId.current) {
      setError('No code was sent to this number. Please send a new one.');
      return;
    }
    if (inFlight.current) return;

    inFlight.current = true;
    setLoading(true);

    // Two stages, told apart because only one of them is about the code. Stage one
    // asks MSG91 whether the digits are right. Stage two asks our server to turn the
    // result into a staff session - and a failure there has nothing to do with the
    // digits, since MSG91 has already accepted them. Telling somebody their correct
    // code is invalid sends them back to retype a code MSG91 has now consumed, which
    // is refused as already verified and leaves them with nothing to do at all.
    let stage = 'msg91';

    try {
      await initWidget();
      const widgetResult = await verifyOtpWithWidget(otpString, msg91RequestId.current || undefined);
      const accessToken = readAccessToken(widgetResult);

      // MSG91 answered success and there is no token in the answer. The code was
      // accepted and spent, so this is a hand-off failure and not a wrong code, and
      // it must never be reported as one.
      if (!accessToken) {
        stage = 'handoff';
        throw new Error('Your code was accepted but we could not confirm your number. Please try again.');
      }

      stage = 'handoff';
      goToPortal(await verifyStaffWithMsg91(accessToken));
    } catch (e) {
      setError(
        e.message || (stage === 'msg91'
          ? 'That code is not valid any more. Please request a new OTP.'
          : 'Your code was accepted but we could not sign you in. Please try again.')
      );
      setOtp(Array(OTP_LENGTH).fill(''));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const backToPhone = () => {
    setStep('phone');
    setOtp(Array(OTP_LENGTH).fill(''));
    setResendCountdown(0);
    setError('');
    // The number is no longer the one a code was sent to, and the request MSG91
    // holds belongs to that number. Keeping either would let a resend or a
    // verification act on the previous number's transaction.
    sentTo.current = '';
    msg91RequestId.current = '';
  };

  const displayPhone = cleanPhone.length === 10 ? `${cleanPhone.slice(0, 5)} ${cleanPhone.slice(5)}` : cleanPhone;

  return (
    <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden border border-neutral-200">
        <div className="bg-gradient-to-br from-[#e53935] to-[#b71c1c] text-white p-7">
          {/* No plate behind the logo: a white or red container here is exactly
              what the dark-theme artwork must not be sat on. The wrapper only
              reserves the box, so the spacing does not change. */}
          <div className="w-12 h-12 flex items-center justify-center mb-4">
            <BrandLogo size="sm" className="w-10 h-10" />
          </div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/80 font-bold">Hotel Darshan Staff Portal</p>
          <h1 className="text-2xl font-black mt-1">Staff Sign In</h1>
          <p className="text-sm text-white/80 mt-2">
            {step === 'phone'
              ? 'Enter the mobile number the restaurant owner registered for you.'
              : 'Enter the 6-digit code sent to your mobile.'}
          </p>
        </div>

        {step === 'phone' ? (
          <form
            onSubmit={(e) => { e.preventDefault(); requestOtp(); }}
            className="p-7 space-y-4"
          >
            {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}
            <label className="block text-xs font-bold text-neutral-700">
              Mobile number
              <div className="mt-1.5 flex items-center gap-2">
                <span className="px-3 py-3 rounded-xl bg-neutral-100 border border-neutral-200 text-sm font-black text-neutral-600">+91</span>
                <input
                  value={phone}
                  onChange={phoneInputOnChange(setPhone)}
                  // No maxLength here on purpose. It caps the raw text the browser
                  // will accept, so a paste of "abc95861-32916xyz" is cut to ten
                  // characters before the sanitiser runs and the field is left holding
                  // six digits. The ten-digit cap is applied by the handler instead,
                  // after the other characters are gone.
                  // type="text" with inputMode="numeric", the same choice the
                  // customer sign-in screen makes, and for the same reason.
                  //
                  // "tel" and autoComplete="tel-national" are the two attributes that
                  // tell a browser this field wants a phone number, so Chrome offers to
                  // fill it from the numbers it has already seen. A staff member then
                  // signs in as whichever number the browser happened to offer, and the
                  // one-time code goes to that person's phone instead of the one the
                  // owner registered. The numeric keypad still appears on a phone -
                  // that is what inputMode is for.
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 outline-none focus:border-[#e53935]"
                  placeholder="Enter Phone Number"
                  required
                />
              </div>
            </label>
            <button
              disabled={loading || !validPhone}
              className="w-full py-3.5 rounded-xl bg-[#e53935] hover:bg-red-700 disabled:opacity-60 text-white font-black text-sm"
            >
              {loading ? 'Sending code…' : 'Send Code'}
            </button>
            <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200 text-[10px] text-neutral-500">
              Use the mobile number the owner added you with. There is no password — a code is sent to your phone each time you sign in.
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); verifyOtp(); }}
            className="p-7 space-y-4"
          >
            {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}

            <div className="text-center">
              <p className="text-sm text-neutral-600">Enter the OTP sent to</p>
              <p className="font-bold text-neutral-900">+91 {displayPhone}</p>
            </div>

            <OtpBoxes otp={otp} setOtp={setOtp} onComplete={verifyOtp} disabled={loading} />

            <button
              disabled={loading || !otp.every((d) => d)}
              className="w-full py-3.5 rounded-xl bg-[#e53935] hover:bg-red-700 disabled:opacity-60 text-white font-black text-sm"
            >
              {loading ? 'Verifying…' : 'Verify & Sign In'}
            </button>

            <div className="flex items-center justify-between text-xs font-bold">
              <button type="button" onClick={backToPhone} className="text-neutral-500 hover:text-neutral-900">
                Change number
              </button>
              <button
                type="button"
                onClick={resendOtp}
                disabled={loading || resendCountdown > 0}
                className="text-[#e53935] disabled:text-neutral-400"
              >
                {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}

        <div className="px-7 pb-7">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full py-2.5 text-xs font-bold text-neutral-500 hover:text-neutral-900"
          >
            Back to Customer App
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StaffPortal({ initialRole }) {
  const { user, logout } = useAuth();
  const routerNavigate = useNavigate();
  const location = useLocation();
  // The router's location, not a private copy taken at mount and updated by a
  // hand-rolled popstate listener. That second copy was the reason this component
  // needed its own navigation: it wrote the address bar with history.pushState
  // and then told itself about it, so the router never learned the path had
  // changed. Anything that reads the router - which is how the admin sections now
  // decide what to show - would then have been reading a stale path.
  const path = location.pathname;

  const role = user?.role;
  // The third segment is the role, so /staff/admin/staff still resolves to the
  // admin portal: the section name in the fourth segment does not disturb it.
  const requestedRole = initialRole || path.split('/')[2];
  const allowed = role && ['admin', 'chef', 'rider'].includes(role);

  if (!allowed) return <StaffLogin />;

  const meta = ROLE_META[role];

  const goToPortal = (target) => routerNavigate(`/staff/${target}`);

  const canOpen = (target) => role === 'admin' || (role === 'chef' && target === 'kitchen') || (role === 'rider' && target === 'rider');
  const activeRole = ['admin', 'chef', 'rider'].includes(requestedRole) && canOpen(requestedRole) ? requestedRole : role;

  // Admin and rider each own a complete header of their own - admin renders a
  // page title, navigation and a role switcher, and the rider app is a mobile
  // product with its own top bar carrying the availability switch. Printing the
  // staff shell's bar above either of them would give the rider two branding
  // bars, and would put the Online/Offline control the rider actually uses on a
  // strip that scrolls away. Kitchen has no internal header and keeps this one.
  const ownsOwnHeader = activeRole === 'admin' || activeRole === 'rider';

  // Admin carries its own light/dark/system preference. Wrapping only the admin
  // branch leaves the kitchen and rider appearances exactly as they are.
  const content = activeRole === 'admin'
    ? <AdminThemeProvider><AdminView onNavigate={goToPortal} canOpen={canOpen} /></AdminThemeProvider>
    : activeRole === 'chef' ? <KitchenView /> : <RiderView />;

  return (
    <div className="min-h-screen bg-neutral-100">
      {!ownsOwnHeader && (
        <header className="bg-neutral-950 text-white border-b border-neutral-800 sticky top-0 z-[60]">
          <div className="max-w-[1500px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <BrandLogo size="sm" className="w-9 h-9" />
              <div className="min-w-0"><div className="font-black text-sm sm:text-base truncate">{meta.title}</div><div className="text-[10px] text-neutral-400 truncate">{meta.subtitle}</div></div>
            </div>
            <div className="flex items-center gap-2">
              {canOpen('kitchen') && <button onClick={() => navigate('kitchen')} className={`hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold ${activeRole === 'kitchen' ? 'bg-white text-neutral-900' : 'bg-neutral-800 text-neutral-300'}`}><ChefHat className="w-3.5 h-3.5"/>Kitchen</button>}
              {canOpen('rider') && <button onClick={() => navigate('rider')} className={`hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold ${activeRole === 'rider' ? 'bg-white text-neutral-900' : 'bg-neutral-800 text-neutral-300'}`}><Truck className="w-3.5 h-3.5"/>Rider</button>}
              <span className="hidden md:block text-xs text-neutral-400 ml-2">{user.name}</span>
              <button onClick={() => { logout(); routerNavigate('/staff', { replace: true }); }} className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700" title="Staff logout"><LogOut className="w-4 h-4"/></button>
            </div>
          </div>
        </header>
      )}
      {content}
      <div className="fixed bottom-4 left-4 z-50 hidden sm:block">
        <button onClick={() => routerNavigate('/')} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-neutral-200 shadow-lg text-xs font-bold text-neutral-600 hover:text-neutral-900"><ArrowLeft className="w-3.5 h-3.5"/>Customer App</button>
      </div>
    </div>
  );
}
