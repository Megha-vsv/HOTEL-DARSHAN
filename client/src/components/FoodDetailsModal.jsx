import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useCart } from '../context/CartContext';
import { resolveFoodImage } from '../data/foodImages';
import { X, Star, Clock, Plus, Minus, Check, Sparkles, AlertCircle } from 'lucide-react';
import FoodImage from './FoodImage';

export default function FoodDetailsModal({ item, onClose }) {
  const { language, t, itemText } = useLanguage();
  const { addToCart } = useCart();

  const [quantity, setQuantity] = useState(1);
  const [selectedCustomizations, setSelectedCustomizations] = useState([]);
  const [specialInstructions, setSpecialInstructions] = useState('');

  if (!item) return null;

  const name = itemText(item, 'name');
  const desc = itemText(item, 'desc');
  const ingredients = itemText(item, 'ingredients');

  const baseUnitPrice = item.discount_price && item.discount_price > 0 ? item.discount_price : item.price;
  const isAvailable = Boolean(item.is_available && item.available_qty > 0);

  const availableCustomizations = item.customizations || [];

  const handleToggleCustomization = (cust) => {
    // If it's a spice-level option, make sure only one spice option is picked
    const isSpiceOption = ['spicy_more', 'spicy_less'].includes(cust.id);

    setSelectedCustomizations(prev => {
      const exists = prev.some(c => c.id === cust.id);
      if (exists) {
        return prev.filter(c => c.id !== cust.id);
      } else {
        if (isSpiceOption) {
          // Remove any other spice option
          const withoutSpice = prev.filter(c => !['spicy_more', 'spicy_less'].includes(c.id));
          return [...withoutSpice, cust];
        }
        return [...prev, cust];
      }
    });
  };

  const customizationsTotal = selectedCustomizations.reduce((sum, c) => sum + (c.price || 0), 0);
  const singleItemTotal = baseUnitPrice + customizationsTotal;
  const totalPrice = singleItemTotal * quantity;

  const handleAddToCart = () => {
    if (!isAvailable) return;
    addToCart(item, quantity, selectedCustomizations, specialInstructions);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div
        className="relative bg-white rounded-3xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-neutral-100 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white backdrop-blur-md transition cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 pb-4">
          {/* Hero Food Image — shorter on mobile so the CTA stays reachable above the keyboard */}
          <div className="relative h-52 sm:h-64 w-full bg-neutral-900">
            <FoodImage
              src={resolveFoodImage(item)}
              alt={name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>

            {/* Bottom info on image */}
            <div className="absolute bottom-3 left-3 right-3 sm:bottom-4 sm:left-4 sm:right-4 text-white">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="food-veg-badge" title="Pure Veg">
                  <span className="food-veg-dot"></span>
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                  {t('vegOnly')}
                </span>
                {item.is_special ? (
                  <span className="px-2 py-0.5 rounded-md bg-[#e53935] text-white text-[10px] font-bold uppercase tracking-wider">
                    {t('todaysSpecial')}
                  </span>
                ) : null}
              </div>

              <h2 className="text-lg sm:text-xl font-black leading-tight text-white">
                {name}
              </h2>
            </div>
          </div>

          {/* Details Section */}
          <div className="p-5 sm:p-6 space-y-5">
            {/* Price & Meta row */}
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-neutral-100">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-neutral-900">₹{baseUnitPrice}</span>
                {item.discount_price && item.discount_price < item.price && (
                  <span className="text-sm text-neutral-400 line-through">₹{item.price}</span>
                )}
                {customizationsTotal > 0 && (
                  <span className="text-xs text-[#e53935] font-semibold">
                    (+₹{customizationsTotal} customizations)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold">
                  <Star className="w-3.5 h-3.5 fill-emerald-600 text-emerald-600" />
                  <span>{item.rating || 4.8}</span>
                  <span className="text-neutral-400 font-normal">({item.review_count || 120})</span>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-neutral-600">
                  <Clock className="w-3.5 h-3.5 text-neutral-400" />
                  <span>{item.prep_time_mins || 15}m {t('prepTime')}</span>
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1.5">
                {language === 'gu' ? 'વાનગી વિશે' : language === 'hi' ? 'व्यंजन का विवरण' : 'Description'}
              </h3>
              <p className="text-sm text-neutral-700 leading-relaxed">
                {desc}
              </p>
            </div>

            {/* Ingredients */}
            {ingredients && (
              <div className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#e53935]" />
                  <span>{t('ingredients')}</span>
                </h3>
                <p className="text-xs text-neutral-600 leading-relaxed font-medium">
                  {ingredients}
                </p>
              </div>
            )}

            {/* Customizations Section */}
            {availableCustomizations.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-neutral-900 mb-2.5 flex items-center gap-2">
                  <span>{t('customizationsTitle')}</span>
                  <span className="text-[11px] font-normal text-neutral-500">
                    ({language === 'gu' ? 'તમારી પસંદગી મુજબ તૈયાર કરાવો' : 'customize to your taste'})
                  </span>
                </h3>

                <div className="space-y-2">
                  {availableCustomizations.map((cust) => {
                    const isSelected = selectedCustomizations.some(c => c.id === cust.id);
                    const custName =
                      language === 'gu'
                        ? cust.name_gu || cust.name_en
                        : language === 'hi'
                        ? cust.name_hi || cust.name_en
                        : cust.name_en;

                    return (
                      <div
                        key={cust.id}
                        onClick={() => handleToggleCustomization(cust)}
                        className={`flex items-center justify-between p-3 rounded-xl border transition cursor-pointer select-none ${
                          isSelected
                            ? 'bg-red-50/80 border-red-300 text-neutral-900 shadow-xs'
                            : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-5 h-5 rounded-md flex items-center justify-center border transition ${
                              isSelected
                                ? 'bg-[#e53935] border-[#e53935] text-white'
                                : 'border-neutral-300 bg-white'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5" />}
                          </div>
                          <span className="text-sm font-medium">{custName}</span>
                        </div>

                        <span className="text-xs font-bold text-neutral-700">
                          {cust.price > 0 ? `+₹${cust.price}` : 'Free'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Special Instructions */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
                {t('specialCookingInstructions')}
              </h3>
              <textarea
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                placeholder={
                  language === 'gu'
                    ? 'દા.ત. મીઠું ઓછું રાખજો, રોટલીમાં ઘી વધુ લગાડજો...'
                    : language === 'hi'
                    ? 'उदा. कम तेल में बनाएं, रोटली पर घी ज्यादा लगाएं...'
                    : 'e.g. Make it less oily, pack chutney separately...'
                }
                rows={2}
                className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-xs focus:bg-white focus:border-[#e53935] outline-hidden resize-none transition"
              />
            </div>
          </div>
        </div>

        {/* Footer with Quantity selector & Add to Cart button */}
        <div className="p-4 sm:p-5 bg-white border-t border-neutral-100 flex items-center justify-between gap-4">
          {/* Quantity Selector */}
          <div className="flex items-center rounded-2xl bg-neutral-100 p-1 border border-neutral-200">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              disabled={quantity <= 1 || !isAvailable}
              className="w-8 h-8 rounded-xl bg-white hover:bg-neutral-200 flex items-center justify-center text-neutral-700 disabled:opacity-40 transition cursor-pointer shadow-xs"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-10 text-center font-black text-sm text-neutral-900">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity(Math.min(item.available_qty || 20, quantity + 1))}
              disabled={!isAvailable}
              className="w-8 h-8 rounded-xl bg-white hover:bg-neutral-200 flex items-center justify-center text-neutral-700 disabled:opacity-40 transition cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Add to Cart Button */}
          {isAvailable ? (
            <button
              onClick={handleAddToCart}
              className="flex-1 py-3.5 px-6 rounded-2xl bg-[#e53935] hover:bg-[#d32f2f] text-white font-black text-sm flex items-center justify-between shadow-lg shadow-red-500/25 transition cursor-pointer active:scale-98"
            >
              <span>{t('add')} {quantity} {t('itemsInCart')}</span>
              <span className="bg-white/20 px-2 py-0.5 rounded-lg text-xs font-black">
                ₹{totalPrice}
              </span>
            </button>
          ) : (
            <div className="flex-1 py-3.5 px-4 rounded-2xl bg-neutral-200 text-neutral-500 font-bold text-center text-xs select-none">
              {t('currentlyUnavailable')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
