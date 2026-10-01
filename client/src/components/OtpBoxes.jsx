import React, { useRef } from 'react';

export const OTP_LENGTH = 6;

// Six single-character boxes for entering a one-time code.
//
// The behaviour is the same on the customer sign-in screen: typing advances to
// the next box, Backspace clears the current box or steps back to the previous
// one, and pasting a full 6-digit code fills every box at once. It is its own
// component so the staff portal and the customer screen enter a code the same
// way instead of each carrying a near-identical copy that can drift apart.
export default function OtpBoxes({ otp, setOtp, onComplete, length = OTP_LENGTH, disabled = false }) {
  const refs = useRef([]);

  // The final digit completing the code submits it, so a person who pasted or
  // typed their way to the end is not left to also find the button.
  const handleChange = (index, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);

    if (digit && index < length - 1) refs.current[index + 1]?.focus();
    if (digit && index === length - 1 && next.every((d) => d)) {
      setTimeout(() => onComplete?.(next.join('')), 300);
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key !== 'Backspace') return;
    e.preventDefault();
    if (otp[index]) {
      const next = [...otp];
      next[index] = '';
      setOtp(next);
    } else if (index > 0) {
      const next = [...otp];
      next[index - 1] = '';
      setOtp(next);
      refs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (pasted.length === length) {
      setOtp(pasted.split(''));
      onComplete?.(pasted);
    }
  };

  return (
    <div className="flex justify-center gap-1.5 sm:gap-2">
      {otp.map((digit, index) => (
        <input
          key={index}
          ref={(el) => (refs.current[index] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          autoComplete="one-time-code"
          disabled={disabled}
          value={digit}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={index === 0 ? handlePaste : undefined}
          className="w-10 h-10 sm:w-12 sm:h-12 text-center text-lg sm:text-xl font-black rounded-xl border border-neutral-200 outline-none focus:border-[#e53935] focus:ring-2 focus:ring-red-100 transition disabled:opacity-60"
        />
      ))}
    </div>
  );
}
