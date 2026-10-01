import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useCart } from '../context/CartContext';
import { formatDate } from '../lib/time.js';
import { Tag, Sparkles, ShieldCheck, Truck, Timer, Star } from 'lucide-react';

const formatCouponLabel = (c) => {
  if (!c) return '';
  if (c.discount_type === 'percentage') {
    const parts = [`${c.discount_value}% OFF`];
    if (c.max_discount) parts.push(`up to ₹${c.max_discount}`);
    return parts.join(' ');
  }
  return `Flat ₹${c.discount_value} OFF`;
};

const formatCouponDesc = (c) => {
  const parts = [];
  if (c.min_order_value && Number(c.min_order_value) > 0) {
    parts.push(`Min ₹${c.min_order_value}`);
  }
  if (c.valid_to) {
    // Parsed and rendered in IST. Read as a local `Date`, a coupon expiring at
    // 23:59 IST on the 30th displayed as the 30th at 18:29 - close enough to
    // look right, which is what made it survive so long.
    const till = formatDate(c.valid_to);
    if (till) parts.push(`Till ${till}`);
  }
  if (c.usage_limit && c.used_count !== undefined) {
    parts.push(`${c.used_count}/${c.usage_limit} used`);
  }
  return parts.join(' · ') || 'Limited time offer';
};

export default function HeroBanner({ onExploreMenu, onTrackOrder }) {
  const { language, t } = useLanguage();
  const { applyCoupon, activeCoupons, coupon } = useCart();

  const offers = activeCoupons.length > 0 ? activeCoupons : [];

  return (
    <>
      {/*
        Mobile promo card. The full hero below is a tall, centred block with a
        stacked offers column, which pushed the first food card roughly two
        screens down. On a phone the same welcome, rating and offers are folded
        into a single short card with a horizontal offer strip instead. Nothing
        is removed — every string and every colour here is the one the desktop
        hero uses, only the arrangement is different.
      */}
      <div className="lg:hidden relative overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 text-white shadow-md mb-3 border border-neutral-800">
        {/* Same red glow the desktop hero uses, kept small so it does not read as
            a second banner on a phone. */}
        <div className="absolute -top-10 -right-8 w-32 h-32 rounded-full bg-red-600/20 blur-3xl pointer-events-none" />

        <div className="relative z-10 px-3.5 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-300 leading-none">
                {language === 'gu' ? 'અસલી કાઠિયાવાડી & ગુજરાતી સ્વાદ' : language === 'hi' ? 'प्रामाणिक गुजराती और काठियावाड़ी भोजन' : 'Original Kathiyawadi, Punjabi & Gujarati Flavors'}
              </p>
              <h1 className="text-base font-extrabold tracking-tight text-white leading-tight mt-1 truncate">
                {t('welcome')}
              </h1>
            </div>

            <div className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded-lg border border-white/15 shrink-0">
              <Star className="w-3 h-3 fill-amber-300 text-amber-300" />
              <span className="font-bold text-white text-[11px]">4.3</span>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-neutral-300">
            <span className="flex items-center gap-1">
              <Timer className="w-3 h-3 text-emerald-300" />
              25-35 {t('prepTime')}
            </span>
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-300" />
              100% {t('vegOnly')}
            </span>
          </div>

          {onTrackOrder && (
            <button
              type="button"
              onClick={onTrackOrder}
              className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-1.5 bg-white/10 active:bg-white/20 border border-white/20 text-white font-semibold text-[11px] rounded-lg transition cursor-pointer"
            >
              <Truck className="w-3.5 h-3.5" />
              Track your order
            </button>
          )}
        </div>

        {offers.length > 0 && (
          <div className="relative z-10 flex items-center gap-2 overflow-x-auto px-3.5 pb-3 -mt-0.5">
            <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-300">
              <Tag className="w-3 h-3" />
              {t('specialOffers')}
            </span>
            {offers.map((off) => {
              const isApplied = coupon?.code === off.code;
              return (
                <button
                  key={off.id || off.code}
                  type="button"
                  onClick={() => !isApplied && applyCoupon(off.code)}
                  disabled={isApplied}
                  title={`Click to apply coupon ${off.code}`}
                  className={`shrink-0 flex flex-col items-start px-2.5 py-1 bg-white/10 active:bg-white/20 border border-white/15 rounded-lg text-left transition ${
                    isApplied ? 'opacity-60 cursor-default' : 'cursor-pointer'
                  }`}
                >
                  <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="font-mono font-bold text-[11px]">{off.code}</span>
                    <span className="font-black text-[11px]">{formatCouponLabel(off)}</span>
                  </span>
                  <span className="text-[9px] text-neutral-300 whitespace-nowrap">
                    {isApplied ? 'Applied!' : formatCouponDesc(off)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Desktop / tablet hero — unchanged from before. */}
      <div className="hidden lg:block relative overflow-hidden rounded-3xl bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 text-white mb-8 shadow-xl border border-neutral-800">
      {/* Background Decorative Orbs */}
      <div className="absolute top-0 right-0 -mt-16 -mr-16 w-80 h-80 rounded-full bg-red-600/20 blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-0 left-1/3 -mb-16 w-60 h-60 rounded-full bg-amber-600/15 blur-2xl pointer-events-none"></div>

      <div className="relative z-10 px-4 sm:px-6 py-6 sm:py-8 flex flex-col lg:flex-row items-center justify-between gap-6 lg:gap-8">
        {/* Main Tagline */}
        <div className="max-w-xl text-center lg:text-left w-full lg:w-auto">
          {/* Badge + Rating */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-semibold uppercase tracking-wider mb-4">
            <Sparkles className="w-3.5 h-3.5 text-red-400" />
            <span>{language === 'gu' ? 'ਅસલੀ ਕાਠਿયાવાડੀ & ગુજરાતੀ સ્વાદ' : language === 'hi' ? 'प्रामाणिक गुजराती और कાਠਿયાવડ਼ी भोजन' : 'Original Kathiyawadi, Punjabi & Gujarati Flavors'}</span>
          </div>

          <div className="flex items-center justify-center lg:justify-start gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-1.5 bg-white/10 px-2.5 py-1 rounded-xl border border-white/15">
              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              <span className="font-bold text-white text-sm">4.3</span>
              <span className="text-neutral-400 text-xs">(100+ ratings)</span>
            </div>
          </div>

          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white leading-tight mb-3">
            {t('welcome')}
          </h1>

          <p className="text-neutral-300 text-sm sm:text-base mb-6 leading-relaxed max-w-md mx-auto lg:mx-0">
            {t('welcomeSub')}
          </p>

          <div className="flex flex-col sm:flex-row flex-wrap items-center lg:justify-start gap-3">
            <button
              type="button"
              onClick={onExploreMenu}
              className="w-full sm:w-auto px-6 py-3 bg-[#e53939] hover:bg-[#d32f2f] text-white font-bold text-sm rounded-xl shadow-lg shadow-red-500/25 transition cursor-pointer hover:scale-105"
            >
              {t('exploreMenu')}
            </button>

            {onTrackOrder && (
              <button
                type="button"
                onClick={onTrackOrder}
                className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-xs rounded-xl transition cursor-pointer"
              >
                <Truck className="w-3.5 h-3.5" />
                Track your order
              </button>
            )}

            <div className="flex items-center justify-center lg:justify-start gap-4 text-xs text-neutral-300 w-full sm:w-auto">
              <div className="flex items-center gap-1.5">
                <Timer className="w-4 h-4 text-emerald-400" />
                <span>25-35 {t('prepTime')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>100% {t('vegOnly')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Promo Offers Cards — stack vertically on mobile instead of overlapping */}
        <div className="w-full lg:w-auto flex flex-col gap-3 min-w-[200px] max-w-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              <Tag className="w-3.5 h-3.5 text-red-400" />
              <span>{t('specialOffers')}</span>
            </div>
            {offers.length > 3 && (
              <span className="text-[10px] text-neutral-400 font-medium">+{offers.length} offers</span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5">
            {offers.map((off) => {
              const isApplied = coupon?.code === off.code;
              return (
                <button
                  key={off.id || off.code}
                  type="button"
                  onClick={() => !isApplied && applyCoupon(off.code)}
                  disabled={isApplied}
                  className={`group relative overflow-hidden flex items-center justify-between gap-3 p-3.5 bg-white/10 hover:bg-white/15 backdrop-blur-md rounded-2xl border border-white/15 transition transform ${
                    isApplied ? 'scale-100 opacity-60 cursor-default' : 'hover:scale-[1.02] cursor-pointer'
                  }`}
                  title={`Click to apply coupon ${off.code}`}
                >
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono font-bold text-sm text-white">{off.code}</span>
                      <span className="font-black text-sm text-white truncate">{formatCouponLabel(off)}</span>
                    </div>
                    <p className="text-[10px] text-neutral-300 mt-0.5 truncate">{formatCouponDesc(off)}</p>
                  </div>
                  {isApplied ? (
                    <span className="text-[10px] font-semibold text-emerald-300 whitespace-nowrap">
                      Applied!
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-red-300 group-hover:underline whitespace-nowrap">
                      {t('apply')}
                    </span>
                  )}
                </button>
              );
            })}

            {offers.length === 0 && (
              <div className="text-[11px] text-neutral-400 py-3 text-center">
                No active offers at the moment. Check back soon!
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
