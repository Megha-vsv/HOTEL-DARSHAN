import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useCart } from '../context/CartContext';
import BrandLogo from './BrandLogo';
import {
  ShoppingCart,
  Search,
  User,
  Radio,
  X,
  MapPin,
  Package,
  ArrowLeft
} from 'lucide-react';

export default function Navbar({
  currentView,
  setCurrentView,
  setIsCartOpen,
  searchTerm,
  setSearchTerm,
  setIsAuthModalOpen,
  onOpenAccount
}) {
  const { language, t } = useLanguage();
  const { cart, activeOrder, totals } = useCart();

  const cartItemCount = cart?.reduce((sum, item) => sum + item.quantity, 0) || 0;
  const isOrderTrackingAvailable = Boolean(activeOrder);

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-neutral-200 shadow-xs">
      {/* Main Navbar — kept to a single 56px row on mobile, expanding only from
          the `sm` breakpoint up where there is room for the full desktop bar. */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-8 h-14 sm:h-auto sm:py-2.5 flex items-center justify-between gap-1.5 sm:gap-2 md:gap-4">
        {/* Back Button (visible on non-customer views) */}
        {currentView !== 'customer' && (
          <button
            onClick={() => setCurrentView('customer')}
            className="icon-btn-sm p-2 rounded-xl text-neutral-700 hover:bg-neutral-100 transition cursor-pointer shrink-0"
            title="Back to menu"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}

        {/* Brand Logo — collapse to icon on very small screens to save width */}
        <div
          onClick={() => setCurrentView('customer')}
          className="flex items-center cursor-pointer select-none group shrink-0 min-w-0"
        >
      <BrandLogo
        size="sm"
        className="sm:w-10 sm:h-10 group-hover:scale-105 transition duration-200"
      />
          {/*
            The wordmark. This was `hidden sm:block`, so on a phone the header
            showed the logo alone with the restaurant's name nowhere — and when
            Cart and Account moved to the bottom nav there was nothing at all on
            the right of the bar. It now sits beside the logo at every width.

            The Veg badge and the tagline stay desktop-only: the first competes
            for width next to the town at 360px, and the second is the one piece
            of header text that was not asked for. Type is the project's own
            system stack (there is no webfont loaded anywhere) carried by weight
            and letter-spacing rather than by a new family — `font-black` with
            tight tracking, in the brand red, which is what makes it read as a
            wordmark rather than as body text.
          */}
          <div className="ml-2 min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-[15px] sm:text-xl font-black tracking-tight text-[#e53935] group-hover:text-[#c62828] transition leading-none truncate">
                Hotel Darshan
              </span>
              <span className="hidden sm:inline-block px-1 py-0.5 text-[9px] font-bold uppercase rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 leading-none">
                Veg
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-neutral-500 font-medium hidden sm:block leading-none mt-0.5">
              {language === 'gu'
                ? 'હોટેલ દર્શન'
                : language === 'hi'
                ? 'होटल दर्शन'
                : 'Pure Vegetarian Dining'}
            </p>
          </div>
        </div>

        {/* Delivery Location — the only place the restaurant address appears in the header.
            The full address is desktop-only; mobile keeps just the town so the row stays 56px. */}
        <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 shrink text-neutral-600">
          <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#e53939] shrink-0" />
          <span className="text-[11px] sm:text-xs font-medium truncate">
            <span className="sm:hidden">Dediapada</span>
            <span className="hidden sm:inline">Dediapada, Gujarat 393040</span>
          </span>
        </div>

        {/* Global Search Bar (Desktop only — mobile gets its own bar below) */}
        {currentView === 'customer' && (
          <div className="hidden md:flex flex-1 max-w-xl relative ml-2">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('searchPlaceholder') || 'Search dishes, thalis, beverages...'}
              className="w-full pl-10 pr-8 py-2.5 bg-neutral-100 hover:bg-neutral-200 focus:bg-white text-sm rounded-xl border border-neutral-200/80 focus:border-[#e53939] focus:ring-2 focus:ring-red-100 outline-none transition"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Action Buttons — desktop/tablet only.
            Cart, Orders and Account each already have a slot in the fixed
            mobile bottom nav, so every button in here is hidden below `sm`.
            That leaves the mobile header as logo + location only, with nothing
            duplicated between the two bars. */}
        <div className="hidden sm:flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Active Order Pill (desktop only) */}
          {isOrderTrackingAvailable && (
            <button
              onClick={() => setCurrentView('tracking')}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-red-50 hover:bg-red-100/80 border border-red-200 text-[#e53939] rounded-xl font-medium text-xs transition cursor-pointer"
              title="View live order status"
            >
              <Radio className="w-4 h-4 text-[#e53939]" />
              <span>#{activeOrder.order_number || activeOrder.id}</span>
            </button>
          )}

          {/* Cart Button — desktop/tablet only; the mobile bottom nav carries it. */}
          <button
            onClick={() => setIsCartOpen(true)}
            className="relative flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3.5 py-2 bg-[#e53939] hover:bg-[#d32f2f] text-white rounded-xl font-semibold text-xs sm:text-sm shadow-md transition cursor-pointer"
            title="View Cart"
          >
            <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">Cart</span>
            {cartItemCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-neutral-900 text-white text-[10px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center border-2 border-white">
                {cartItemCount > 9 ? '9+' : cartItemCount}
              </span>
            )}
            <span className="hidden sm:inline bg-white/20 px-1.5 py-0.5 rounded-md text-[10px] font-bold">
              ₹{Number(totals?.grandTotal || 0).toFixed(0)}
            </span>
          </button>

          {/* My Orders Button — desktop/tablet only. */}
          <button
            onClick={() => setCurrentView('my_orders')}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-200 hover:bg-neutral-50 text-neutral-700 font-bold text-xs transition cursor-pointer"
            title={t('myOrders') || 'My Orders'}
          >
            <Package className="w-4 h-4" />
            <span>{t('myOrders') || 'My Orders'}</span>
          </button>

          {/* Profile Button — desktop/tablet only, where it stays in the far-right corner. */}
          <button
            onClick={() => (onOpenAccount ? onOpenAccount() : setIsAuthModalOpen(true))}
            className="icon-btn-sm p-2 rounded-xl border border-neutral-200 hover:bg-neutral-50 text-neutral-700 transition cursor-pointer"
            title={t('customerRole') || 'Account'}
          >
            <User className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mobile Search Bar — one compact row directly under the 56px header */}
      {currentView === 'customer' && (
        <div className="md:hidden px-3 pb-2">
          <div className="relative">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('searchPlaceholder') || 'Search dishes...'}
              className="w-full h-10 pl-9 pr-8 bg-neutral-100 text-sm rounded-xl border border-neutral-200 focus:border-[#e53939] outline-none"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-0.5 icon-btn-sm"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
