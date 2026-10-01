import React, { useMemo, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useCart } from '../context/CartContext';
import FoodImage from './FoodImage';
import { resolveFoodImage } from '../data/foodImages';
import {
  X,
  Plus,
  Minus,
  Trash2,
  Tag,
  ArrowRight,
  ShoppingBag,
  CheckCircle2,
  Sparkles,
  Info,
  AlertTriangle,
  ArrowLeft,
  Edit3
} from 'lucide-react';

// Which existing menu categories best complete each category, in priority order.
// Keys are the category ids already used by the menu (see data/categories.js).
// e.g. a Sweet (Rotlano Churmo) cart is completed by Milk Items + Tea & Coffee,
// a Punjabi curry by Roti + Milk Items + Salad.
const CATEGORY_COMPLEMENTS = {
  1: [2, 15, 4],        // Hotel Special -> milk, salad, tea
  2: [4, 3, 1],         // Milk Items -> tea, sweets, thali
  3: [2, 4, 1],         // Sweet -> milk (chaas/butter), tea, thali
  4: [3, 2, 12],        // Tea & Coffee -> sweets, milk, rice
  5: [2, 4, 14],        // Starter -> milk, tea, papad
  6: [14, 2, 11],       // Soup -> papad, milk, roti
  7: [5, 2, 4],         // Noodles -> starters, milk, tea
  8: [5, 2, 4],         // Chinese Rice -> starters, milk, tea
  9: [11, 2, 4, 13],    // Kathiyavadi -> roti, milk, tea, dal
  10: [11, 2, 4, 15],   // Punjabi -> roti, milk, tea, salad
  11: [10, 13, 2, 15],  // Roti -> curries, dal, milk, salad
  12: [13, 10, 11, 2],  // Rice & Khichdi -> dal, curry, roti, milk
  13: [11, 12, 2, 15],  // Dal -> roti, rice, milk, salad
  14: [13, 2, 10],      // Papad -> dal, milk, curry
  15: [10, 11, 2],      // Salad -> curries, roti, milk
  16: [11, 2, 12],      // Special Sabji -> roti, milk, rice
  17: [11, 15, 2],      // Kofta -> roti, salad, milk
  18: [11, 2, 4]        // Cheese Items -> roti, milk, tea
};

const MAX_RECOMMENDATIONS = 5;
const MAX_PER_CATEGORY = 2;

// Several menu rows carry a category_id that disagrees with the dish itself
// (e.g. Rotlano Churmo is filed under "Milk Items", Paneer Angara under "Soup").
// The dish name is the reliable signal, so classify on that first and only fall
// back to the stored category_id. This reuses the existing menu taxonomy; no
// food data is duplicated here.
const NAME_CATEGORY_HINTS = [
  [15, ['salad']],
  [14, ['papad']],
  [6, ['soup']],
  [7, ['noodle', 'hakka']],
  [8, ['chinese', 'manchurian', 'fried rice']],
  [4, ['tea', 'coffee', 'cappuccino', 'latte', 'mocha']],
  [18, ['cheese']],
  [3, ['sweet', 'churmo', 'churma', 'ladoo', 'laddoo', 'ladu', 'rasgulla', 'rasguli', 'jalebi', 'gulab', 'halwa', 'kheer', 'basundi', 'shrikhand', 'barfi', 'kalakand', 'peda', 'mishti', 'khaja']],
  [11, ['roti', 'rotla', 'rotlo', 'parotha', 'paratha', 'bhakri', 'poori', 'phulka', 'thepla', 'rotli']],
  [12, ['rice', 'pulao', 'pulav', 'khich', 'biriyani', 'biryani', 'bhaat', 'bhat']],
  [13, ['dal', 'daal']],
  [10, ['paneer', 'angara', 'kadai', 'kadhai', 'kofta', 'tikka', 'malai']],
  [2, ['chaas', 'chhas', 'chhash', 'milk', 'dahi', 'doodh', 'lassi', 'butter', 'bhuna']],
  [5, ['starter', 'pakora', 'bhajiya']],
  [1, ['hotel special', 'thali']]
];

function inferCategory(item) {
  const name = `${item.name_en || ''} ${item.name_hi || ''} ${item.name_gu || ''}`.toLowerCase();
  if (name) {
    for (const [categoryId, keywords] of NAME_CATEGORY_HINTS) {
      if (keywords.some((keyword) => name.includes(keyword))) return categoryId;
    }
  }
  const declared = Number(item.category_id);
  return Number.isFinite(declared) && declared > 0 ? declared : null;
}

function isAvailable(item) {
  if (!item) return false;
  if (item.is_available === false) return false;
  if (item.available_qty !== undefined && item.available_qty !== null && item.available_qty <= 0) return false;
  return true;
}

// Recommends menu items that complement what is already in the cart.
// Reuses the existing menuItems data and its category ids — no new food data.
function buildRecommendations(items, cartItems, limit = MAX_RECOMMENDATIONS) {
  if (!Array.isArray(items) || !Array.isArray(cartItems) || cartItems.length === 0) return [];

  const inCart = new Set(cartItems.map((c) => String(c && c.id)));
  const candidates = items.filter(
    (it) => isAvailable(it) && !inCart.has(String(it.id)) && Number(it.price) > 0
  );
  if (!candidates.length) return [];

  const scored = candidates.map((it) => {
    const cat = inferCategory(it);
    let best = 0;
    for (const c of cartItems) {
      const cartCat = inferCategory(c);
      const complements = CATEGORY_COMPLEMENTS[cartCat] || [];
      const pos = complements.indexOf(cat);
      if (pos !== -1) {
        // Earlier complements score higher.
        best = Math.max(best, complements.length - pos);
      } else if (cartCat === cat) {
        // Same category as something in the cart: still useful, but weakly.
        best = Math.max(best, 1);
      }
    }
    return { item: it, category: cat, score: best };
  });

  // Prefer genuine complements; only widen if that leaves the section empty.
  const complements = scored.filter((s) => s.score > 1);
  const sameCategory = scored.filter((s) => s.score === 1);
  const pool = complements.length ? complements : sameCategory;
  if (!pool.length) return [];

  const picked = [];
  const perCategory = new Map();
  for (const entry of pool) {
    const used = perCategory.get(entry.category) || 0;
    if (used >= MAX_PER_CATEGORY) continue;
    picked.push(entry.item);
    perCategory.set(entry.category, used + 1);
    if (picked.length >= limit) break;
  }
  return picked;
}

export default function CartDrawer({ isOpen, onClose, onProceedToCheckout, menuItems }) {
  const { t, itemText } = useLanguage();
  const {
    cart,
    updateQuantity,
    removeFromCart,
    clearCart,
    addToCart,
    validateCart,
    coupon,
    applyCoupon,
    removeCoupon,
    activeCoupons,
    orderType,
    totals
  } = useCart();

  const { unavailableItems } = validateCart();

  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [orderNote, setOrderNote] = useState('');

  const quickCoupons = activeCoupons.slice(0, 3).map((c) => ({
    code: c.code,
    desc: c.discount_type === 'percentage' ? `${c.discount_value}% OFF` : `Flat ₹${c.discount_value} OFF`
  }));

  const recommendedItems = useMemo(
    () => buildRecommendations(menuItems, cart),
    [menuItems, cart]
  );

  if (!isOpen) return null;

  const handleApplyCoupon = async (codeToApply) => {
    const code = codeToApply || couponInput;
    if (!code.trim()) return;
    setIsApplying(true);
    setCouponError('');
    const res = await applyCoupon(code.trim());
    setIsApplying(false);
    if (!res.success) {
      setCouponError(res.error);
    } else {
      setCouponInput('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-white h-full flex flex-col animate-in slide-in-from-right duration-300 shadow-2xl border-l border-neutral-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with back button, restaurant name, location */}
        <div className="p-4 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-neutral-100 text-neutral-600 transition cursor-pointer"
              title="Back to menu"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-red-50 text-[#e53939]">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-black text-neutral-900 leading-tight">
                  Hotel Darshan
                </h2>
                <p className="text-xs text-neutral-400">
                  Dediapada, Gujarat 393040
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="text-xs text-neutral-400 hover:text-red-500 font-medium px-2 py-1 transition cursor-pointer"
                title="Clear all items"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-neutral-100 text-neutral-500 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center text-[#e53939] mb-4">
                <ShoppingBag className="w-10 h-10" />
              </div>
              <h3 className="text-base font-bold text-neutral-800 mb-1">
                {t('emptyCart')}
              </h3>
              <p className="text-xs text-neutral-500 max-w-xs mb-6 leading-relaxed">
                {t('emptyCartSub')}
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-[#e53939] hover:bg-[#d32f2f] text-white rounded-xl text-xs font-bold transition shadow-md shadow-red-500/20 cursor-pointer"
              >
                {t('browseFood')}
              </button>
            </div>
          ) : (
            <>
              {/* Unavailable items warning */}
              {unavailableItems.length > 0 && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-bold">Some items are no longer available.</span>
                    <p className="mt-1">Please remove them or proceed without them.</p>
                  </div>
                </div>
              )}

              {cart.map((item) => {
                const name = itemText(item, 'name');
                const isItemUnavailable = item.is_available === false || (item.available_qty !== undefined && item.available_qty <= 0);
                const unitPrice = Number(item.unitPrice) || Number(item.price) || 0;
                const hasDiscount = item.price && item.discount_price && item.discount_price > 0 && item.discount_price < item.price;

                return (
                  <div
                    key={item.cartItemId}
                    className={`group flex gap-3.5 p-3.5 rounded-2xl bg-white border transition-shadow ${
                      isItemUnavailable
                        ? 'opacity-60 border-red-200 line-through'
                        : 'border-neutral-100 hover:shadow-md'
                    }`}
                  >
                    {/* Food thumbnail */}
                    <div className="relative shrink-0">
                      <FoodImage
                        src={resolveFoodImage(item)}
                        alt={name}
                        className="w-18 h-18 rounded-xl object-cover border border-neutral-200"
                      />
                      {item.is_veg !== undefined && (
                        <span className={`absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white flex items-center justify-center ${
                          item.is_veg ? 'bg-emerald-600' : 'bg-red-600'
                        }`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                        </span>
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <h4 className="font-bold text-xs sm:text-sm text-neutral-900 line-clamp-1">
                            {name}
                          </h4>
                          {hasDiscount && (
                            <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.25 rounded">
                              {Math.round(((Number(item.price) - Number(item.discount_price)) / Number(item.price)) * 100)}% off
                            </span>
                          )}
                          {item.is_special && (
                            <Sparkles className="w-3 h-3 text-amber-400" />
                          )}
                          {isItemUnavailable && (
                            <span className="text-[9px] font-bold text-red-600 whitespace-nowrap">UNAVAILABLE</span>
                          )}
                        </div>
                        <button
                          onClick={() => removeFromCart(item.cartItemId)}
                          className="text-neutral-300 hover:text-red-500 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Customizations tags */}
                      {item.selectedCustomizations && item.selectedCustomizations.length > 0 && (
                        <div className="text-[11px] text-neutral-500 my-1 space-y-0.5">
                          {item.selectedCustomizations.map((c) => (
                            <div key={c.id} className="text-[#e53939] font-medium flex items-center gap-1">
                              <span>•</span>
                              <span>{itemText(c, 'name')}</span>
                              {c.price > 0 && <span>(+₹{c.price})</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {item.specialInstructions && (
                        <div className="text-[10px] text-neutral-400 italic mb-1 line-clamp-1">
                          Note: "{item.specialInstructions}"
                        </div>
                      )}

                      {/* Price & Quantity */}
                      <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-neutral-50">
                        <div className="text-right">
                          {hasDiscount && (
                            <span className="text-[10px] text-neutral-400 line-through">
                              ₹{Number(item.price) * item.quantity}
                            </span>
                          )}
                          <span className={`font-black text-xs sm:text-sm text-neutral-900 block ${isItemUnavailable ? 'line-through opacity-50' : ''}`}>
                            ₹{item.itemTotalPrice}
                          </span>
                          {item.quantity > 1 && (
                            <span className="text-[10px] text-neutral-400">
                              ₹{unitPrice} × {item.quantity}
                            </span>
                          )}
                        </div>

                        <div className={`flex items-center rounded-xl border overflow-hidden shadow-xs ${
                          isItemUnavailable ? 'bg-neutral-200' : 'bg-neutral-50 border-neutral-200'
                        }`}>
                          <button
                            onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}
                            disabled={isItemUnavailable}
                            className="p-1 text-neutral-400 transition cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="px-2 font-bold text-xs text-neutral-800 min-w-[32px] text-center">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
                            disabled={isItemUnavailable}
                            className="p-1 text-neutral-400 transition cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Remove unavailable button */}
              {cart.some((item) => item.is_available === false || (item.available_qty !== undefined && item.available_qty <= 0)) && (
                <button
                  onClick={() => {
                    cart
                      .filter((item) => item.is_available === false || (item.available_qty !== undefined && item.available_qty <= 0))
                      .forEach((item) => removeFromCart(item.cartItemId));
                  }}
                  className="w-full py-2 mt-2 text-xs font-bold text-red-600 hover:text-red-700 hover:underline cursor-pointer"
                >
                  Remove Unavailable Items
                </button>
              )}
            </>
          )}
        </div>

        {/* Cart Actions + Recommended Section (only when items exist) */}
        {cart.length > 0 && (
          <div className="border-t border-neutral-100">
            {/* Add More Items link */}
            <div className="px-4 sm:px-5 py-3 border-b border-neutral-100">
              <button
                onClick={onClose}
                className="flex items-center justify-center gap-2 w-full text-center text-xs font-bold text-neutral-700 hover:text-[#e53939] transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add more items</span>
              </button>
            </div>

            {/* Order Note / Cooking Instructions */}
            <div className="px-4 sm:px-5 py-3 border-b border-neutral-100">
              <div className="flex items-center gap-2 text-xs text-neutral-500 mb-2">
                <Edit3 className="w-3.5 h-3.5 text-neutral-400" />
                <span className="font-medium">Cooking instructions for your order</span>
              </div>
              <textarea
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                placeholder="e.g. Less spicy, extra ghee, no onion..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 outline-none focus:border-[#e53939] resize-none"
                rows={2}
              />
            </div>

            {/* Recommended / Complete your meal */}
            {recommendedItems.length > 0 && (
              <div className="px-4 sm:px-5 py-3 border-b border-neutral-100">
                <h3 className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-[#e53939]" />
                  <span>Complete your meal</span>
                </h3>
                <div className="flex gap-2 overflow-x-auto pb-1 overscroll-x-contain">
                  {recommendedItems.map((item) => {
                    const img = resolveFoodImage(item);
                    const name = item.name_en || item.name || 'Food Item';
                    const price = item.discount_price && item.discount_price > 0 ? item.discount_price : item.price;

                    return (
                      <div
                        key={item.id}
                        className="w-[168px] shrink-0 flex items-center gap-2 p-1.5 rounded-xl border border-neutral-200 bg-white"
                      >
                        <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-neutral-100">
                          <FoodImage
                            src={img}
                            alt={name}
                            category={item.category_name_en || item.category_id}
                            className="w-full h-full object-cover"
                          />
                          {item.is_veg === false ? (
                            <span className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-red-100 border border-red-500 flex items-center justify-center">
                              <span className="w-1 h-1 rounded-full bg-red-500"></span>
                            </span>
                          ) : (
                            <span className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-emerald-100 border border-emerald-500 flex items-center justify-center">
                              <span className="w-1 h-1 rounded-full bg-emerald-600"></span>
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <h4 className="text-[11px] font-bold text-neutral-900 truncate leading-tight">{name}</h4>
                          <div className="flex items-center justify-between gap-1 mt-1">
                            <span className="text-[11px] font-black text-[#e53939]">₹{price}</span>
                            <button
                              type="button"
                              onClick={() => addToCart({ ...item, image: img, image_url: img })}
                              className="w-6 h-6 min-h-0 min-w-0 rounded-lg bg-[#e53939] hover:bg-[#d32f2f] text-white flex items-center justify-center transition cursor-pointer"
                              title={`Add ${name}`}
                              aria-label={`Add ${name}`}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Coupon Section */}
        {cart.length > 0 && (
          <div className="px-4 sm:px-5 py-4 border-b border-neutral-100">
            {coupon ? (
              <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <div>
                    <span className="font-bold">{coupon.code}</span> applied! Saved ₹{coupon.discount_amount}
                  </div>
                </div>
                <button
                  onClick={removeCoupon}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 hover:underline cursor-pointer"
                >
                  {t('remove')}
                </button>
              </div>
            ) : (
              <div>
                <div className="flex gap-2 mb-2">
                  <div className="relative flex-1">
                    <Tag className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      placeholder={t('couponCode')}
                      className="w-full pl-9 pr-3 py-2 bg-neutral-100 text-xs uppercase font-mono rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden transition-colors"
                    />
                  </div>
                  <button
                    onClick={() => handleApplyCoupon(couponInput)}
                    disabled={isApplying || !couponInput.trim()}
                    className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold transition disabled:opacity-50 cursor-pointer"
                  >
                    {isApplying ? '...' : t('apply')}
                  </button>
                </div>

                {couponError && (
                  <p className="text-[11px] text-red-600 mb-1.5 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    {couponError}
                  </p>
                )}

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {quickCoupons.map((qc) => (
                    <button
                      key={qc.code}
                      onClick={() => handleApplyCoupon(qc.code)}
                      className="group px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-red-50 hover:text-[#e53939] border border-neutral-200 text-[10px] font-mono font-semibold shrink-0 transition flex items-center gap-1.5"
                      title={qc.desc}
                    >
                      <Sparkles className="w-3 h-3 text-neutral-400 group-hover:text-[#e53939]" />
                      <span>{qc.code}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Price Summary + Checkout */}
        {cart.length > 0 && (
        <div className="p-4 sm:p-5 bg-neutral-50 border-t border-neutral-200 space-y-3">
          <div className="space-y-1.5 text-xs text-neutral-600">
            <div className="flex justify-between">
              <span>{t('itemTotal')}</span>
              <span className="font-semibold text-neutral-800">₹{totals.itemTotal}</span>
            </div>

            {totals.discount > 0 && (
              <div className="flex justify-between text-emerald-600 font-medium">
                <span>{t('discount')}</span>
                <span>-₹{totals.discount}</span>
              </div>
            )}

            {orderType === 'delivery' && (
              <div className="flex justify-between">
                <span>Delivery Distance</span>
                <span className="font-semibold text-neutral-800">
                  {totals.deliveryDistanceKnown ? `${totals.deliveryDistanceKm} km` : 'Location unavailable'}
                </span>
              </div>
            )}

            <div className="flex justify-between">
              <span>{t('deliveryFee')}</span>
              <span className="font-semibold text-neutral-800">
                {orderType === 'delivery' && totals.deliveryAllowed === false ? (
                  <span className="text-red-600 uppercase font-bold">Unavailable</span>
                ) : totals.deliveryFee === 0 ? (
                  <span className="text-emerald-600 uppercase font-bold">{t('free')}</span>
                ) : (
                  `₹${totals.deliveryFee}`
                )}
              </span>
            </div>

            <div className="flex justify-between">
              <span>{t('taxes')}</span>
              <span className="font-semibold text-neutral-800">₹{totals.tax}</span>
            </div>

            <div className="flex justify-between text-sm font-black text-neutral-900 pt-2 border-t border-neutral-200">
              <span>{t('grandTotal')}</span>
              <span className="text-base text-[#e53939]">₹{totals.grandTotal}</span>
            </div>
          </div>

          {/* Checkout Action Button */}
          <button
            onClick={() => {
              // Only the proceed handler. The cart's open state is the URL now,
              // so navigating to /checkout closes the drawer by itself - calling
              // onClose() first would push the menu onto the history stack and
              // leave the back button landing somewhere the customer never chose.
              onProceedToCheckout();
            }}
            disabled={cart.length === 0 || cart.some((item) => item.is_available === false || (item.available_qty !== undefined && item.available_qty <= 0))}
            className="w-full py-3.5 px-4 bg-[#e53939] hover:bg-[#d32f2f] text-white rounded-2xl font-black text-sm flex items-center justify-between shadow-lg shadow-red-500/25 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>{t('proceedToCheckout')}</span>
            <div className="flex items-center gap-1 font-extrabold">
              <span>₹{totals.grandTotal}</span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
