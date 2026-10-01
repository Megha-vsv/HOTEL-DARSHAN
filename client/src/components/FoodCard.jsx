import React from 'react';
import FoodImage from './FoodImage';
import { useCart } from '../context/CartContext';
import { resolveFoodImage } from '../data/foodImages';
import { Sparkles, Plus, Minus, Heart, Star, Clock } from 'lucide-react';

const getRating = (item) => {
  if (item.rating && item.rating > 0) return item.rating;
  const seed = (item.id || 0) % 10;
  const base = item.is_popular ? 4.3 : item.is_special ? 4.5 : 4.0;
  const offset = (seed * 0.07) % 0.5;
  return base + offset;
};

/**
 * How long this dish takes, as a short range on the card.
 *
 * This used to bucket dishes by category id in a hardcoded table
 * (`quick = [2, 4, 6, 14, 15]`, and so on) that had no connection to any setting
 * — not to the per-dish `prep_time_mins` the admin edits, not to the
 * `prep_time_mins` tracking setting, not to the estimate the order is actually
 * given. It also read a `delivery_time` field that does not exist on
 * `menu_items` and is never written by any route, so that branch was dead.
 *
 * Both are gone. The real per-dish value is used when the server sends one, and
 * the range is derived from it rather than looked up from a category number, so
 * a dish an admin retimes shows its new time here too.
 */
const getDeliveryTime = (item) => {
  const prep = Number(item?.prep_time_mins);
  if (Number.isFinite(prep) && prep > 0) return `${prep}`;

  // No per-dish time on this row. Fall back to the restaurant's own prep
  // setting when it has been fetched, and say so plainly rather than inventing
  // a number that disagrees with the order.
  const configured = Number(item?.settings_prep_time_mins);
  if (Number.isFinite(configured) && configured > 0) return `${configured}`;

  return '—';
};

export default function FoodCard({ item, onOpenDetails }) {
  const { addToCart, cart, favorites, toggleFavorite } = useCart();

  if (!item) return null;

  const imageUrl = resolveFoodImage(item);

  const foodName =
    item.name_en ||
    item.name ||
    'Food Item';

  const price =
    item.discount_price && item.discount_price > 0
      ? item.discount_price
      : item.price;

  const description =
    item.desc_en ||
    `Authentic Hotel Darshan ${foodName}`;

  const isAvailable =
    item.is_available !== false &&
    (item.available_qty === undefined || item.available_qty > 0);

  const isFavorite = favorites.includes(item.id);

  const rating = getRating(item);
  const deliveryTime = getDeliveryTime(item);

  const discountPercent =
    item.discount_price && item.discount_price > 0 && item.discount_price < item.price
      ? Math.round(((item.price - item.discount_price) / item.price) * 100)
      : null;

  const existingCartItem = Array.isArray(cart)
    ? cart.find((c) => c.id === item.id)
    : null;

  const cartQty = existingCartItem ? existingCartItem.quantity : 0;

  const handleAddToCart = (e) => {
    e.stopPropagation();
    if (!isAvailable) return;
    addToCart({
      ...item,
      image: imageUrl,
      image_url: imageUrl
    });
  };

  const handleIncrement = (e) => {
    e.stopPropagation();
    if (!isAvailable) return;
    addToCart({
      ...item,
      image: imageUrl,
      image_url: imageUrl
    });
  };

  const handleDecrement = (e) => {
    e.stopPropagation();
  };

  const handleFavorite = (e) => {
    e.stopPropagation();
    toggleFavorite(item.id);
  };

  return (
    <div
      className={`
        group relative flex flex-col bg-white rounded-xl sm:rounded-2xl
        border border-neutral-200 overflow-hidden
        shadow-xs hover:shadow-md transition-shadow duration-200
        ${!isAvailable ? 'opacity-60 grayscale' : ''}
      `}
    >
      {/* FOOD IMAGE — square on mobile so two columns fit four cards on the
          first screen, back to the original 4:3 from `sm` upward. */}
      <div
        className="relative aspect-square sm:aspect-[4/3] w-full bg-neutral-100 cursor-pointer overflow-hidden"
        onClick={() => onOpenDetails && onOpenDetails({
          ...item,
          image: imageUrl,
          image_url: imageUrl
        })}
      >
        <FoodImage
          src={imageUrl}
          alt={foodName}
          category={item.category_name_en || item.category_id}
        />

        {/* VEG / NON-VEG BADGE */}
        <div className="absolute top-1.5 sm:top-3 left-1.5 sm:left-3">
          {item.is_veg === false ? (
            <span
              className="inline-flex items-center justify-center w-[18px] h-[18px] sm:w-6 sm:h-6 rounded-full bg-red-100 border-2 border-red-500"
              title="Non-Veg"
            >
              <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-red-500 relative">
                <span className="absolute -top-0.5 -left-0.5 w-1 h-1 border-l-2 border-b-2 border-red-500 rounded-sm transform rotate-45 translate-x-1/2 translate-y-1/2"></span>
              </span>
            </span>
          ) : (
            <span
              className="inline-flex items-center justify-center w-[18px] h-[18px] sm:w-6 sm:h-6 rounded-full bg-emerald-100 border-2 border-emerald-500"
              title="Pure Veg"
            >
              <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-emerald-600"></span>
            </span>
          )}
        </div>

        {/* SPECIAL + DISCOUNT BADGES (top-right) */}
        <div className="absolute top-1.5 sm:top-3 right-1.5 sm:right-3 flex flex-col gap-1 items-end">
          {discountPercent > 0 && (
            <span className="bg-amber-500 text-white text-[9px] sm:text-[10px] font-black px-1.5 sm:px-2 py-0.5 rounded-md shadow">
              {discountPercent}% OFF
            </span>
          )}
          {item.is_special && (
            <span className="bg-[#e53939] text-white text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-full flex items-center gap-0.5 sm:gap-1 shadow">
              <Sparkles className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-amber-300" />
              Special
            </span>
          )}
        </div>

        {/* FAVORITE HEART */}
        <button
          type="button"
          onClick={handleFavorite}
          className="absolute bottom-1.5 sm:bottom-3 right-1.5 sm:right-3 w-6 h-6 sm:w-7 sm:h-7 rounded-full hd-media-chip shadow transition flex items-center justify-center z-10"
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart
            className={`w-3.5 h-3.5 transition-colors ${isFavorite ? 'fill-[#e53939] text-[#e53939]' : 'text-neutral-400'}`}
          />
        </button>

        {/* UNAVAILABLE OVERLAY */}
        {!isAvailable && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="hd-media-chip font-black text-[10px] sm:text-xs px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl">
              Sold Out
            </span>
          </div>
        )}
      </div>

      {/* FOOD DETAILS */}
      <div className="p-2.5 sm:p-4 flex-1 flex flex-col">
        {/* NAME + RATING */}
        <div className="flex items-start justify-between gap-1 mb-0.5 sm:mb-1">
          <h3
            className="font-bold text-neutral-900 text-[13px] sm:text-sm line-clamp-1"
            title={foodName}
          >
            {foodName}
          </h3>
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            <Star className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-amber-400 text-amber-400" />
            <span className="text-[10px] sm:text-xs font-bold text-neutral-900">{rating.toFixed(1)}</span>
          </div>
        </div>

        {/* DESCRIPTION */}
        <p className="text-neutral-500 text-[10px] sm:text-xs line-clamp-2 mb-1 sm:mb-2 flex-1">
          {description}
        </p>

        {/* DELIVERY TIME */}
        <div className="flex items-center gap-1 text-[10px] sm:text-xs text-neutral-500 mb-1.5 sm:mb-2">
          <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-neutral-400" />
          <span>{deliveryTime === '—' ? 'Prep time not set' : `${deliveryTime} min prep`}</span>
        </div>

        {/* PRICE + ADD */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex flex-col items-start">
            {item.discount_price &&
              item.discount_price > 0 &&
              item.discount_price < item.price && (
                <span className="text-[9px] sm:text-[10px] text-neutral-400 line-through mb-0.5">
                  ₹{item.price}
                </span>
              )}
            <span className="text-sm sm:text-lg font-black text-neutral-900">
              ₹{price}
            </span>
          </div>

          {/* QUANTITY COUNTER / ADD BUTTON */}
          {isAvailable && cartQty > 0 ? (
            <div className="flex items-center gap-0.5 sm:gap-1 bg-neutral-50 rounded-lg sm:rounded-xl border border-neutral-200 overflow-hidden">
              <button
                type="button"
                onClick={handleDecrement}
                className="p-1 sm:p-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border-r border-neutral-200"
                disabled
              >
                <Minus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
              <span className="px-1.5 sm:px-2.5 font-black text-[10px] sm:text-xs text-neutral-900 min-w-[1rem] sm:min-w-[1.25rem] text-center">
                {cartQty}
              </span>
              <button
                type="button"
                onClick={handleIncrement}
                className="p-1 sm:p-1.5 text-[#e53939] hover:bg-red-50 transition cursor-pointer border-l border-neutral-200"
              >
                <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
            </div>
          ) : isAvailable ? (
            <button
              type="button"
              onClick={handleAddToCart}
              className="flex items-center justify-center gap-0.5 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-[#e53939] hover:bg-red-700 text-white font-bold text-[10px] sm:text-xs rounded-lg sm:rounded-xl shadow transition cursor-pointer"
            >
              <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              Add
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-neutral-300 text-neutral-500 font-bold text-[10px] sm:text-xs rounded-lg sm:rounded-xl cursor-not-allowed"
            >
              Sold Out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
