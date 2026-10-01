import React from 'react';
import BrandLogo from './BrandLogo';

export default function PermissionScreen({ onAllow }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-neutral-200 p-7 text-center">
        <BrandLogo size="xl" className="mx-auto mb-4" />
        <h2 className="text-xl font-black text-neutral-900 mb-2">
          Enable Location Access
        </h2>
        <p className="text-sm text-neutral-500 mb-6">
          We need your location to show nearby Hotel Darshan outlets and deliver your food to the right address.
        </p>
        <button
          onClick={onAllow}
          className="w-full py-3.5 rounded-xl bg-[#e53935] text-white font-black transition"
        >
          Allow Location Access
        </button>
      </div>
    </div>
  );
}
