import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiBase as API_BASE } from '../lib/apiBase';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('hotelDarshanUser');
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem('hotelDarshanUser');
      return null;
    }
  });
  const [token, setToken] = useState(() => {
    const saved = localStorage.getItem('hotelDarshanToken');
    if (!saved) return null;
    try {
      return saved;
    } catch {
      localStorage.removeItem('hotelDarshanToken');
      return null;
    }
  });

  const tokenRef = useRef(token);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    if (user) localStorage.setItem('hotelDarshanUser', JSON.stringify(user));
    else localStorage.removeItem('hotelDarshanUser');
  }, [user]);

  useEffect(() => {
    if (token) localStorage.setItem('hotelDarshanToken', token);
    else localStorage.removeItem('hotelDarshanToken');
  }, [token]);

  // The cached user in localStorage can be stale (it may still contain values
  // that no longer exist in the database). Always re-sync it with the server so
  // My Account and Edit Profile render the real persisted profile.
  const refreshUser = useCallback(async () => {
    const authToken = tokenRef.current;
    if (!authToken) return null;

    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      if (res.status === 401) {
        setUser(null);
        setToken(null);
      }
      throw new Error(data?.message || 'Unable to load your profile');
    }

    setUser(data.user);
    return data.user;
  }, []);

  // Whether the session is settled: either there is no token to verify, or the
  // server has answered the one /me call that confirms the token is still good.
  //
  // Until this is true, `user` is only a cached guess read from localStorage.
  // Routing that decides "you are signed out" from that guess is a coin flip: a
  // valid returning customer gets bounced to the login screen and the URL they
  // asked for is lost, while a revoked token gets a flash of the wrong page
  // first. Callers must wait for this flag instead of reacting to `user`.
  const [isAuthReady, setIsAuthReady] = useState(false);

  const hydratedToken = useRef(null);
  useEffect(() => {
    if (!token) {
      hydratedToken.current = null;
      setIsAuthReady(true);
      return;
    }
    // Only hydrate once per token, so a profile save is never overwritten by a
    // late-arriving /me response.
    if (hydratedToken.current === token) return;
    hydratedToken.current = token;
    // A 401 inside refreshUser clears the session, which flips this effect to
    // the no-token branch and marks the session ready. Any other failure keeps
    // the cached user in place and still marks it ready, so a flaky network
    // cannot trap the app on a loading screen.
    refreshUser()
      .catch(() => {})
      .finally(() => setIsAuthReady(true));
  }, [token, refreshUser]);

  // The customer's sign-in, as a single flow.
  //
  // The screen no longer asks whether to log in or register - it cannot know, and
  // guessing wrong used to strand people. The server looks the number up and the
  // reply carries `exists`, so the first screen has one code request and no mode
  // to get wrong.
  //
  // This sends nothing. It opens the step: the server decides whether the number may
  // try at all, which account state it is in, and how many codes it may still ask
  // for. MSG91 does the sending, from the browser, through the widget - so the reply
  // also says `otpProvider`, and the screen hands the number to the widget rather
  // than to this function.
  const startCustomerOtp = async (phone) => {
    const res = await fetch(`${API_BASE}/auth/customer-start-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw Object.assign(new Error(data?.message || 'Unable to send OTP'), { code: data?.code, retryAfter: data?.retryAfter });
    return data;
  };

  /**
   * Trade a completed MSG91 verification for a Hotel Darshan outcome.
   *
   * Takes the access token the widget produced, and nothing else. In particular no
   * phone number: the server asks MSG91 which number that token verified and acts
   * on the answer, so a caller cannot nominate a number it did not prove. That is
   * what makes this a sign-in rather than a form that can be filled in with any
   * nine digits the attacker likes.
   *
   * Two quite different outcomes come back, and the caller has to keep them apart: a
   * first-time customer gets `{ needsRegistration: true }` plus a `registrationToken`
   * - a signed claim that the number was verified, which is what the registration
   * page spends instead of the code. An existing customer gets a session `token` and
   * is signed in.
   *
   * No account is created here. The code proved control of the number, and that is
   * all it proved.
   */
  const verifyCustomerWithMsg91 = async (accessToken) => {
    const res = await fetch(`${API_BASE}/auth/customer-verify-msg91`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      // `status` travels with the error so a development log can name the HTTP
      // result of the handoff without this file logging anything itself.
      throw Object.assign(new Error(data?.message || 'OTP verification failed'), {
        code: data?.code,
        status: res.status
      });
    }
    if (data.token) { setUser(data.user); setToken(data.token); }
    return data;
  };

  /**
   * Create the customer account from a verified registration claim.
   *
   * Takes the claim the OTP step issued, not the code. The code was spent proving
   * the number, and asking the server to check it a second time is what made the
   * registration screen tell a customer their code had expired one moment after
   * the screen had confirmed it - a message about the past, in a form that was
   * never going to work. The claim is the durable proof, and it names one number
   * and one purpose.
   *
   * The phone number is deliberately not sent. The server takes it from the signed
   * claim instead, so the account is created against a number somebody proved they
   * control rather than against whatever the request body happened to say.
   *
   * `email` and `address` are optional and blank stays blank - nothing is
   * synthesised from the phone number, because a made-up address would be
   * indistinguishable from a real one in a delivery receipt.
   */
  const register = async (name, registrationToken, { email = '', address = '' } = {}) => {
    if (!registrationToken) throw new Error('Please verify your mobile number with OTP first');

    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, registrationToken, email: String(email || '').trim(), address: String(address || '').trim() })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw Object.assign(new Error(data?.message || 'Registration failed'), { code: data?.code });
    }
    setUser(data.user); setToken(data.token); return data.user;
  };

  const setSession = (sessionUser, sessionToken) => { setUser(sessionUser); setToken(sessionToken); };

  // Staff sign-in is a mobile number and a one-time code, not a password. The
  // server decides whether the number is staff before it sends anything, so a
  // number that is not staff is refused here rather than being texted a code.
  const sendStaffOtp = async (phone) => {
    const res = await fetch(`${API_BASE}/auth/send-staff-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      // The status and code are carried on the error because the screen has to say
      // something specific: a rate limit is "wait N seconds", a disabled account is
      // "ask the owner", and an unknown number is "not staff". One flat string
      // would collapse all three into the same unhelpful line.
      const err = new Error(data?.message || 'Unable to send the code');
      err.code = data?.code || null;
      err.retryAfter = data?.retryAfter || null;
      err.status = res.status;
      throw err;
    }
    return data;
  };

  /**
   * Trade a completed MSG91 verification for a Hotel Darshan staff session.
   *
   * Takes the access token the widget produced, and nothing else. In particular no
   * phone number and no code: the server asks MSG91 which number that token verified
   * and then looks that number up against the staff list, so a caller cannot nominate
   * a number it did not prove, and - the part that matters - completing a real MSG91
   * verification is not by itself staff membership. That is decided by the users
   * table, on the server, and nowhere else.
   *
   * This replaces a version of this function that took `(phone, otp)` and handed the
   * six digits to the server. There is no longer a code on the server to compare
   * them to, so a raw code is no longer proof of anything and is not sent.
   */
  const verifyStaffWithMsg91 = async (accessToken) => {
    const res = await fetch(`${API_BASE}/auth/staff-verify-msg91`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      // `code` travels with the error because the screen has to say something
      // specific: a rate limit is "wait N seconds", a disabled account is "ask the
      // owner", and a number that is not staff is "not staff". One flat string would
      // collapse all three into the same unhelpful line.
      const err = new Error(data?.message || 'Staff login failed');
      err.code = data?.code || null;
      err.retryAfter = data?.retryAfter || null;
      err.status = res.status;
      throw err;
    }
    setSession(data.user, data.token);
    return data.user;
  };

  const logout = () => { setUser(null); setToken(null); localStorage.removeItem('hotelDarshanLocation'); };

  const updateUserProfile = async (updatedData) => {
    const res = await fetch(`${API_BASE}/auth/profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` }, body: JSON.stringify(updatedData)
    });
    const data = await res.json().catch(() => null);

    // Never update React state with unsaved data: a failed save must throw and
    // leave the current customer state untouched.
    if (!res.ok || !data?.success) {
      throw new Error(data?.message || 'Unable to update profile');
    }

    const updatedUser = data.user;
    if (!updatedUser) throw new Error('Profile update did not return the saved profile');

    setUser(updatedUser);
    return updatedUser;
  };

  return <AuthContext.Provider value={{ user, token, isAuthReady, startCustomerOtp, verifyCustomerWithMsg91, register, sendStaffOtp, verifyStaffWithMsg91, setSession, logout, updateUserProfile, refreshUser }}>
    {children}
  </AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
