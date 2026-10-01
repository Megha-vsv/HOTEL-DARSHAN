import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { hotelDarshanCategories } from './data/categories';
import { resolveFoodImage } from './data/foodImages';
import { useLanguage } from './context/LanguageContext';
import { useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { useCart } from './context/CartContext';
import { useSocket } from './context/SocketContext';


import Navbar from './components/Navbar';
import BrandLogo from './components/BrandLogo';
import HeroBanner from './components/HeroBanner';
import CategorySlider from './components/CategorySlider';
import FoodCard from './components/FoodCard';
import FoodDetailsModal from './components/FoodDetailsModal';
import CartDrawer from './components/CartDrawer';
import CheckoutModal from './components/CheckoutModal';
import OrderTrackingView from './components/OrderTrackingView';
import OrderSuccess from './components/OrderSuccess';
import { MyOrdersView, OrderDetailView } from './components/CustomerExtraViews';
import AuthModal from './components/AuthModal';
import NotificationToast from './components/NotificationToast';
import AuthPage from './components/AuthPage';
import AccountSettings from './components/AccountSettings';
import PermissionScreen from './components/PermissionScreen';
import LocationGate from './components/LocationGate';
import { apiBase as API_BASE } from './lib/apiBase';
const StaffPortal = React.lazy(() => import('./components/StaffPortal.jsx'));

import {
  Sparkles,
  Flame,
  ThumbsUp,
  Filter,
  Utensils,
  Star,
  Home,
  Package,
  ShoppingCart,
  User
} from 'lucide-react';

/**
 * Every customer URL, resolved into the view the body should render.
 *
 * This is the replacement for the `currentView` string the app used to keep in
 * React state. That string was the reason a refresh lost your place: it started
 * at 'customer' on every mount and the address bar was never written to, so
 * F5 on /orders/41/tracking rendered the home page under a tracking URL. The URL
 * is now the only place a route is recorded, and this function is the single
 * place that turns it into something renderable.
 *
 * `/`, `/menu`, `/cart` and `/checkout` all render the same menu body, because
 * cart and checkout are an overlay on top of the menu rather than a separate
 * page. `overlay` says which one, so a reload of /checkout reopens checkout
 * instead of dropping the customer back on the food grid.
 */
const MENU_ROUTES = new Set(['/', '/menu', '/cart', '/checkout']);

function matchCustomerRoute(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';

  if (MENU_ROUTES.has(path)) {
    return {
      view: 'menu',
      // Where the overlays go back to. Checkout sits one step further along
      // than cart, so its close button returns to the cart rather than to the
      // menu the customer never asked to leave yet.
      backTo: path === '/checkout' ? '/cart' : '/',
      overlay: path === '/cart' ? 'cart' : path === '/checkout' ? 'checkout' : null,
      // /menu is the menu section, not the top of the landing page, so entering
      // it scrolls the grid into view.
      scrollToMenu: path === '/menu',
    };
  }

  if (path === '/account') return { view: 'account', backTo: '/' };
  if (path === '/orders') return { view: 'my_orders', backTo: '/' };

  const tracking = path.match(/^\/orders\/([^/]+)\/tracking$/);
  if (tracking) return { view: 'tracking', orderId: decodeURIComponent(tracking[1]), backTo: `/orders/${encodeURIComponent(decodeURIComponent(tracking[1]))}` };

  const order = path.match(/^\/orders\/([^/]+)$/);
  if (order) return { view: 'order_detail', orderId: decodeURIComponent(order[1]), backTo: '/orders' };

  const success = path.match(/^\/order-success(?:\/([^/]+))?$/);
  if (success) return { view: 'order_success', orderId: success[1] ? decodeURIComponent(success[1]) : null, backTo: '/' };

  return { view: 'not_found', backTo: '/' };
}

// Post-Order Feedback Modal Component
function PostOrderFeedbackModal({ orderId, onClose, onReviewed }) {
  const { token, user } = useAuth();
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // The review is written to the database through the same endpoint the admin
  // reads, so it is only reported as submitted once the server has confirmed it.
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rating === 0) return setError('Please select a star rating.');
    if (submitting) return;

    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          rating,
          comment: feedback.trim(),
          customer_name: user?.name || undefined
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // The review already existing means the outcome the customer wanted is
        // already true, so this closes the prompt rather than reporting a fault.
        if (res.status === 400 && /already reviewed/i.test(data.error || '')) {
          onClose();
          return;
        }
        throw new Error(data.error || 'Could not save your review. Please try again.');
      }

      setSubmitted(true);
      if (onReviewed) onReviewed(orderId);
    } catch (err) {
      setError(err.message || 'Could not save your review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-2xl text-center max-w-md w-full">
          <h3 className="font-bold text-emerald-900 text-base">Thank You!</h3>
          <p className="text-xs text-emerald-700 mt-1">
            Your feedback helps Hotel Darshan maintain authentic quality.
          </p>
          <button 
            onClick={onClose}
            className="mt-4 px-4 py-2 bg-emerald-600 text-white font-bold text-xs rounded-xl"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="p-6 bg-white rounded-2xl border border-neutral-200 shadow-xl max-w-md w-full">
        <h3 className="text-lg font-black text-neutral-900 mb-1">How was your meal?</h3>
        <p className="text-xs text-neutral-500 mb-4">Rate your order from Hotel Darshan</p>

        <div className="flex justify-center gap-2 mb-4">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              className="p-1 focus:outline-none cursor-pointer"
            >
              <Star
                className={`w-7 h-7 ${
                  star <= rating ? 'text-amber-400 fill-amber-400' : 'text-neutral-300'
                }`}
              />
            </button>
          ))}
        </div>

        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Tell us about the taste, packaging, or delivery..."
          className="w-full p-3 border border-neutral-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#e53935] mb-4"
          rows={3}
        />

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-xs rounded-xl transition cursor-pointer disabled:opacity-60"
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-2.5 bg-[#e53935] hover:bg-red-700 text-white font-bold text-xs rounded-xl transition cursor-pointer disabled:opacity-60"
          >
            {submitting ? 'Saving...' : 'Submit Feedback'}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs font-bold text-red-600 leading-relaxed">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function AppContent() {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const { cart, activeOrder, totals, addToCart } = useCart();

  // The mobile bottom nav badge reads the same cart the header badge does.
  const cartItemCount = cart?.reduce((sum, item) => sum + item.quantity, 0) || 0;
  const { socket } = useSocket();

  // Customer navigation. The URL is the route: there is no view state here to
  // disagree with the address bar, so a reload, a back button and a typed URL
  // all resolve to the same page.
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const route = matchCustomerRoute(pathname);
  const view = route.view;
  const [confirmedOrder, setConfirmedOrder] = useState(null);

  // Categories and Menu items
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [vegOnly, setVegOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [popularOnly, setPopularOnly] = useState(false);
  const [specialOnly, setSpecialOnly] = useState(false);

  // Modals. Cart and checkout are overlays that the URL now owns, so they are
  // read off the route instead of being remembered: /cart reloads with the
  // drawer open and /checkout reloads with checkout open. The auth modal has no
  // route of its own and stays local.
  const [selectedFoodItem, setSelectedFoodItem] = useState(null);
  const isCartOpen = route.overlay === 'cart';
  const isCheckoutOpen = route.overlay === 'checkout';
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  // The exact order the feedback form belongs to, captured while that order is
  // the one being tracked.
  const [feedbackOrderId, setFeedbackOrderId] = useState(null);

  // The order the nav's tracking pill should open. The track route carries its
  // own id, so this is only consulted when a button has to choose a destination.
  const activeOrderId = activeOrder?.id ?? activeOrder?.order_number ?? null;

  const goToTracking = useCallback(() => {
    if (activeOrderId) navigate(`/orders/${encodeURIComponent(activeOrderId)}/tracking`);
  }, [navigate, activeOrderId]);

  /**
   * The one translation from view names to URLs.
   *
   * Navbar and the child views still speak in view names, so every one of those
   * calls is funnelled through here. That leaves a single place that knows what
   * each view is called on the internet, instead of a name hard-coded at each
   * call site where a typo would silently become a dead button.
   */
  const goToView = useCallback((target) => {
    switch (target) {
      case 'account': navigate('/account'); return;
      case 'my_orders': navigate('/orders'); return;
      case 'tracking': goToTracking(); return;
      case 'order_success': {
        const id = confirmedOrder?.id ?? confirmedOrder?.order_number;
        navigate(id ? `/order-success/${encodeURIComponent(id)}` : '/order-success');
        return;
      }
      default: navigate('/');
    }
  }, [navigate, goToTracking, confirmedOrder]);

  // Opening the cart is a navigation now, not a state flip, so the drawer has an
  // address. Closing it returns to whatever the cart was opened over.
  const setCartOpen = useCallback((open) => {
    navigate(open ? '/cart' : (route.backTo || '/'));
  }, [navigate, route.backTo]);

  // /menu is the menu section rather than the top of the landing page, so
  // arriving there (by link, back button or reload) puts the grid in view.
  useEffect(() => {
    if (!route.scrollToMenu) return;
    const el = document.getElementById('menu-section');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [route.scrollToMenu]);


// Hotel Darshan Menu Dataset
// Every food item has an image URL.

const hotelDarshanMenuItems = [

  // MILK ITEMS - CATEGORY 2
  { id: 1, name_en: 'Simple Chhas', price: 11, base_price: 10, category_id: 2, is_veg: true, is_available: true },
  { id: 2, name_en: 'Special Chhas', price: 17, base_price: 15, category_id: 2, is_veg: true, is_available: true },
  { id: 3, name_en: 'Dahi', price: 22, base_price: 20, category_id: 2, is_veg: true, is_available: true },
  { id: 4, name_en: 'Milk', price: 33, base_price: 30, category_id: 2, is_veg: true, is_available: true },
  { id: 5, name_en: 'Ghee', price: 33, base_price: 30, category_id: 2, is_veg: true, is_available: true },
  { id: 6, name_en: 'Gol', price: 22, base_price: 20, category_id: 2, is_veg: true, is_available: true },
  { id: 7, name_en: 'Butter (Vadki)', price: 33, base_price: 30, category_id: 2, is_veg: true, is_available: true },

  // SWEET - CATEGORY 3
  { id: 8, name_en: 'Rotlano Churmo', price: 77, base_price: 70, category_id: 3, is_veg: true, is_available: true, is_special: true },
  { id: 9, name_en: 'Churma Ladoo', price: 22, base_price: 20, category_id: 3, is_veg: true, is_available: true },
  { id: 10, name_en: 'Rasgulla', price: 22, base_price: 20, category_id: 3, is_veg: true, is_available: true },
  { id: 11, name_en: 'Gulab Jamun', price: 22, base_price: 20, category_id: 3, is_veg: true, is_available: true, is_popular: true },

  // TEA & COFFEE - CATEGORY 4
  { id: 12, name_en: 'Tea', price: 22, base_price: 20, category_id: 4, is_veg: true, is_available: true },
  { id: 13, name_en: 'Coffee', price: 28, base_price: 25, category_id: 4, is_veg: true, is_available: true },
  { id: 14, name_en: 'Milk', price: 33, base_price: 30, category_id: 4, is_veg: true, is_available: true },

  // PAPAD - CATEGORY 14
  { id: 15, name_en: 'Roasted Papad', price: 11, base_price: 10, category_id: 14, is_veg: true, is_available: true },
  { id: 16, name_en: 'Fried Papad', price: 22, base_price: 20, category_id: 14, is_veg: true, is_available: true },
  { id: 17, name_en: 'Masala Papad', price: 33, base_price: 30, category_id: 14, is_veg: true, is_available: true, is_popular: true },
  { id: 18, name_en: 'Nagli Papad', price: 22, base_price: 20, category_id: 14, is_veg: true, is_available: true },

  // RICE & KHICHDI - CATEGORY 12
  { id: 19, name_en: 'Jeera Rice', price: 77, base_price: 70, category_id: 12, is_veg: true, is_available: true },
  { id: 20, name_en: 'Plain Rice', price: 55, base_price: 50, category_id: 12, is_veg: true, is_available: true },
  { id: 21, name_en: 'Dal Rice', price: 55, base_price: 50, category_id: 12, is_veg: true, is_available: true },
  { id: 22, name_en: 'Veg. Pulav', price: 88, base_price: 80, category_id: 12, is_veg: true, is_available: true },
  { id: 23, name_en: 'Veg. Biryani', price: 132, base_price: 120, category_id: 12, is_veg: true, is_available: true, is_popular: true },
  { id: 24, name_en: 'Veg. Hyderabadi', price: 165, base_price: 150, category_id: 12, is_veg: true, is_available: true },
  { id: 25, name_en: 'Kaju Pulav', price: 154, base_price: 140, category_id: 12, is_veg: true, is_available: true },
  { id: 26, name_en: 'Paneer Pulav', price: 154, base_price: 140, category_id: 12, is_veg: true, is_available: true },
  { id: 27, name_en: 'Paneer Khichdi', price: 143, base_price: 130, category_id: 12, is_veg: true, is_available: true },
  { id: 28, name_en: 'Butter Khichadi', price: 143, base_price: 130, category_id: 12, is_veg: true, is_available: true, is_special: true },
  { id: 29, name_en: 'Cheese Khichadi', price: 154, base_price: 140, category_id: 12, is_veg: true, is_available: true },
  { id: 30, name_en: 'Kadhi Khichadi', price: 55, base_price: 50, category_id: 12, is_veg: true, is_available: true },
  { id: 31, name_en: 'Masala Rice', price: 88, base_price: 80, category_id: 12, is_veg: true, is_available: true },
  { id: 32, name_en: 'Punjabi Khichadi', price: 110, base_price: 100, category_id: 12, is_veg: true, is_available: true },
  { id: 33, name_en: 'Tadka Khichadi', price: 121, base_price: 110, category_id: 12, is_veg: true, is_available: true },

  // PUNJABI - CATEGORY 10
  { id: 34, name_en: 'Palak Paneer', price: 165, base_price: 150, category_id: 10, is_veg: true, is_available: true },
  { id: 35, name_en: 'Paneer Matar', price: 165, base_price: 150, category_id: 10, is_veg: true, is_available: true },
  { id: 36, name_en: 'Paneer Chatpata', price: 165, base_price: 150, category_id: 10, is_veg: true, is_available: true },
  { id: 37, name_en: 'Paneer Kadhai', price: 176, base_price: 160, category_id: 10, is_veg: true, is_available: true },
  { id: 38, name_en: 'Paneer Handi', price: 176, base_price: 160, category_id: 10, is_veg: true, is_available: true },
  { id: 39, name_en: 'Paneer Balti', price: 187, base_price: 170, category_id: 10, is_veg: true, is_available: true },
  { id: 40, name_en: 'Paneer Bhurji', price: 176, base_price: 160, category_id: 10, is_veg: true, is_available: true },
  { id: 41, name_en: 'Paneer Butter Masala', price: 176, base_price: 160, category_id: 10, is_veg: true, is_available: true, is_popular: true },
  { id: 42, name_en: 'Paneer Tufani', price: 176, base_price: 160, category_id: 10, is_veg: true, is_available: true },
  { id: 43, name_en: 'Paneer Tikka', price: 154, base_price: 140, category_id: 10, is_veg: true, is_available: true },
  { id: 44, name_en: 'Paneer Tawa', price: 176, base_price: 160, category_id: 10, is_veg: true, is_available: true },
  { id: 45, name_en: 'Paneer Pasanda', price: 220, base_price: 200, category_id: 10, is_veg: true, is_available: true, is_special: true },
  { id: 46, name_en: 'Paneer Angara', price: 198, base_price: 180, category_id: 10, is_veg: true, is_available: true, is_special: true },
  { id: 47, name_en: 'Cheese Angara', price: 220, base_price: 200, category_id: 10, is_veg: true, is_available: true },
  { id: 48, name_en: 'Shahi Paneer', price: 165, base_price: 150, category_id: 10, is_veg: true, is_available: true },
  { id: 49, name_en: 'Chana Paneer', price: 165, base_price: 150, category_id: 10, is_veg: true, is_available: true },
  { id: 50, name_en: 'Paneer Aflatun', price: 198, base_price: 180, category_id: 10, is_veg: true, is_available: true },
  { id: 51, name_en: 'Paneer Cheese', price: 198, base_price: 180, category_id: 10, is_veg: true, is_available: true },
  { id: 52, name_en: 'Paneer Lasaniya', price: 176, base_price: 160, category_id: 10, is_veg: true, is_available: true },
  { id: 53, name_en: 'Cheese Aflatun', price: 220, base_price: 200, category_id: 10, is_veg: true, is_available: true },

  // SOUP - CATEGORY 6
  { id: 54, name_en: 'Manchow Soup', price: 88, base_price: 80, category_id: 6, is_veg: true, is_available: true },
  { id: 55, name_en: 'Manchurian Soup', price: 99, base_price: 90, category_id: 6, is_veg: true, is_available: true },
  { id: 56, name_en: 'Garlic Soup', price: 99, base_price: 90, category_id: 6, is_veg: true, is_available: true },

  // STARTER - CATEGORY 5
  { id: 57, name_en: 'Manchurian Dry', price: 88, base_price: 80, category_id: 5, is_veg: true, is_available: true, is_popular: true },
  { id: 58, name_en: 'Paneer Chilli Dry', price: 165, base_price: 150, category_id: 5, is_veg: true, is_available: true },
  { id: 59, name_en: 'Paneer Chilli Gravy', price: 176, base_price: 160, category_id: 5, is_veg: true, is_available: true },
  { id: 60, name_en: 'Manchurian Gravy', price: 88, base_price: 80, category_id: 5, is_veg: true, is_available: true },

  // NOODLES - CATEGORY 7
  { id: 61, name_en: 'Veg. Hakka Noodles', price: 88, base_price: 80, category_id: 7, is_veg: true, is_available: true },
  { id: 62, name_en: 'Veg. Schezwan Noodles', price: 110, base_price: 100, category_id: 7, is_veg: true, is_available: true },
  { id: 63, name_en: 'Manchurian Noodles', price: 99, base_price: 90, category_id: 7, is_veg: true, is_available: true },

  // CHINESE RICE - CATEGORY 8
  { id: 64, name_en: 'Veg. Fried Rice', price: 99, base_price: 90, category_id: 8, is_veg: true, is_available: true },
  { id: 65, name_en: 'Veg. Schezwan Fried Rice', price: 110, base_price: 100, category_id: 8, is_veg: true, is_available: true },
  { id: 66, name_en: 'Manchurian Fried Rice', price: 99, base_price: 90, category_id: 8, is_veg: true, is_available: true },
  { id: 67, name_en: 'Chinese Pulav', price: 88, base_price: 80, category_id: 8, is_veg: true, is_available: true },
  { id: 68, name_en: 'Chinese Bhel', price: 143, base_price: 130, category_id: 8, is_veg: true, is_available: true, is_popular: true },

  // SALAD - CATEGORY 15
  { id: 69, name_en: 'Tomato Salad', price: 29, base_price: 25, category_id: 15, is_veg: true, is_available: true },
  { id: 70, name_en: 'Green Salad', price: 39, base_price: 35, category_id: 15, is_veg: true, is_available: true },

  // KATHIYAVADI - CATEGORY 9
  { id: 71, name_en: 'Sev Tameta', price: 88, base_price: 80, category_id: 9, is_veg: true, is_available: true, is_popular: true },
  { id: 72, name_en: 'Ringan Bharthu', price: 110, base_price: 100, category_id: 9, is_veg: true, is_available: true, is_special: true },
  { id: 73, name_en: 'Mung Masala', price: 99, base_price: 90, category_id: 9, is_veg: true, is_available: true },
  { id: 74, name_en: 'Bharela Ringan', price: 99, base_price: 90, category_id: 9, is_veg: true, is_available: true },
  { id: 75, name_en: 'Bharela Karela', price: 99, base_price: 90, category_id: 9, is_veg: true, is_available: true },
  { id: 76, name_en: 'Bharela Marcha', price: 99, base_price: 90, category_id: 9, is_veg: true, is_available: true },
  { id: 77, name_en: 'Bharela Bhinda', price: 88, base_price: 80, category_id: 9, is_veg: true, is_available: true },
  { id: 78, name_en: 'Sev Bhaji', price: 99, base_price: 90, category_id: 9, is_veg: true, is_available: true },
  { id: 79, name_en: 'Sev Lasaniya', price: 110, base_price: 100, category_id: 9, is_veg: true, is_available: true },
  { id: 80, name_en: 'Lasaniya Batata', price: 110, base_price: 100, category_id: 9, is_veg: true, is_available: true },
  { id: 81, name_en: 'Suki Bhaji', price: 88, base_price: 80, category_id: 9, is_veg: true, is_available: true },
  { id: 82, name_en: 'Suki Bhaji (Farali)', price: 99, base_price: 90, category_id: 9, is_veg: true, is_available: true },
  { id: 83, name_en: 'Bhindi Fry', price: 99, base_price: 90, category_id: 9, is_veg: true, is_available: true },
  { id: 84, name_en: 'Bhindi Masala', price: 110, base_price: 100, category_id: 9, is_veg: true, is_available: true },
  { id: 85, name_en: 'Tameta Bharta', price: 99, base_price: 90, category_id: 9, is_veg: true, is_available: true },
  { id: 86, name_en: 'Dahi Tikhari', price: 88, base_price: 80, category_id: 9, is_veg: true, is_available: true, is_special: true },

  // HOTEL SPECIAL - CATEGORY 1
  { id: 87, name_en: 'Special Darshan', price: 242, base_price: 220, category_id: 1, is_veg: true, is_available: true, is_special: true },

  // DAL - CATEGORY 13
  { id: 88, name_en: 'Dal Fry', price: 88, base_price: 80, category_id: 13, is_veg: true, is_available: true },
  { id: 89, name_en: 'Dal Fry Butter', price: 99, base_price: 90, category_id: 13, is_veg: true, is_available: true },
  { id: 90, name_en: 'Dal Tadka', price: 110, base_price: 100, category_id: 13, is_veg: true, is_available: true, is_popular: true },
  { id: 91, name_en: 'Dal Tadka Butter', price: 121, base_price: 110, category_id: 13, is_veg: true, is_available: true },

  // PUNJABI - CATEGORY 10
  { id: 96, name_en: 'Mix Veg.', price: 110, base_price: 100, category_id: 10, is_veg: true, is_available: true },
  { id: 97, name_en: 'Veg. Kolhapuri', price: 176, base_price: 160, category_id: 10, is_veg: true, is_available: true },

  // ROTI / ROTLA / PAROTHA - CATEGORY 11
  { id: 115, name_en: 'Plain Roti', price: 11, base_price: 10, category_id: 11, is_veg: true, is_available: true },
  { id: 116, name_en: 'Butter Roti', price: 17, base_price: 15, category_id: 11, is_veg: true, is_available: true },
  { id: 117, name_en: 'Bajri Rotlo Plain', price: 22, base_price: 20, category_id: 11, is_veg: true, is_available: true },
  { id: 118, name_en: 'Bajri Rotlo Butter', price: 28, base_price: 25, category_id: 11, is_veg: true, is_available: true, is_popular: true },
  { id: 119, name_en: 'Bajri Rotlo Lasaniya', price: 33, base_price: 30, category_id: 11, is_veg: true, is_available: true },
  { id: 120, name_en: 'Bajri Rotlo Lasaniya Butter', price: 39, base_price: 35, category_id: 11, is_veg: true, is_available: true, is_special: true },
  { id: 131, name_en: 'Tawa Paratha', price: 22, base_price: 20, category_id: 11, is_veg: true, is_available: true },
  { id: 132, name_en: 'Tawa Butter Paratha', price: 28, base_price: 25, category_id: 11, is_veg: true, is_available: true },
  { id: 135, name_en: 'Methi Thepla', price: 55, base_price: 50, category_id: 11, is_veg: true, is_available: true },
  { id: 136, name_en: 'Aloo Paratha', price: 55, base_price: 50, category_id: 11, is_veg: true, is_available: true },

  // HOTEL SPECIAL - CATEGORY 1
  { id: 137, name_en: 'Gujarati Thali', price: 110, base_price: 100, category_id: 1, is_veg: true, is_available: true },
  { id: 138, name_en: 'Punjabi Thali', price: 199, base_price: 180, category_id: 1, is_veg: true, is_available: true }

];

const fetchMenuData = async () => {
    try {
      const [catRes, itemRes] = await Promise.all([
        fetch(`${API_BASE}/menu/categories`),
        fetch(`${API_BASE}/menu/items`)
      ]);

      if (catRes.ok) {
        const backendCategories = await catRes.json();
        setCategories(backendCategories?.length ? backendCategories : hotelDarshanCategories);
      } else {
        setCategories(hotelDarshanCategories);
      }

      if (itemRes.ok) {
        const backendItems = await itemRes.json();

        // App.jsx is allowed to override the backend item when you have
        // changed that item here. All other database items stay unchanged.
        const localById = new Map(
          hotelDarshanMenuItems.map(item => [String(item.id), item])
        );

        const mergedItems = backendItems.map(item => {
          const localItem = localById.get(String(item.id));

          // resolveFoodImage() is the single source of truth and resolves in the
          // same order this page always used: name map -> id map -> stored url.
          const image = resolveFoodImage({
            ...item,
            name_en: item.name_en,
            id: item.id,
            image_url: localItem?.image || item.image_url,
            image: localItem?.image || item.image
          });

          if (!localItem) {
            return { ...item, image, image_url: image };
          }

          return {
            ...item,
            ...localItem,
            category_id: localItem.category_id ?? item.category_id,
            image,
            image_url: image
          };
        });

        const backendIds = new Set(backendItems.map(item => String(item.id)));
        const localOnlyItems = hotelDarshanMenuItems
          .filter(item => !backendIds.has(String(item.id)))
          .map(item => ({
            ...item,
            image_url: item.image
          }));

        const allItems = [...mergedItems, ...localOnlyItems];

        const categoryCounts = {};

        allItems.forEach((item) => {
          const ids = item.category_ids || [item.category_id];

          ids.forEach((id) => {
            categoryCounts[String(id)] =
              (categoryCounts[String(id)] || 0) + 1;
          });
        });

        categoryCounts['all'] = allItems.length;

        const updatedCategories = hotelDarshanCategories.map((cat) => ({
          ...cat,
          item_count: categoryCounts[String(cat.id)] || 0
        }));

        setCategories(updatedCategories);

        setMenuItems(allItems);
      } else {
        const categoryCounts = {};

        hotelDarshanMenuItems.forEach((item) => {
          const ids = item.category_ids || [item.category_id];

          ids.forEach((id) => {
            categoryCounts[String(id)] =
              (categoryCounts[String(id)] || 0) + 1;
          });
        });

        categoryCounts['all'] = hotelDarshanMenuItems.length;

        const updatedCategories = hotelDarshanCategories.map((cat) => ({
          ...cat,
          item_count: categoryCounts[String(cat.id)] || 0
        }));

        setCategories(updatedCategories);
        setMenuItems(hotelDarshanMenuItems);
      }
    } catch (e) {
      console.error('Backend not reached, loading local Hotel Darshan menu:', e);

      const categoryCounts = {};

      hotelDarshanMenuItems.forEach((item) => {
        const ids = item.category_ids || [item.category_id];

        ids.forEach((id) => {
          categoryCounts[String(id)] =
            (categoryCounts[String(id)] || 0) + 1;
        });
      });

      categoryCounts['all'] = hotelDarshanMenuItems.length;

      const updatedCategories = hotelDarshanCategories.map((cat) => ({
        ...cat,
        item_count: categoryCounts[String(cat.id)] || 0
      }));

      setCategories(updatedCategories);
      setMenuItems(hotelDarshanMenuItems);
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    fetchMenuData();
  }, []);

  // Load customer order history for transparent recommendations.
  const [myOrders, setMyOrders] = useState([]);
  useEffect(() => {
    const loadMyOrders = async () => {
      if (!token || user?.role !== 'customer') { setMyOrders([]); return; }
      try {
        const res = await fetch(`${API_BASE}/orders/my-orders`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setMyOrders(await res.json());
      } catch {
        setMyOrders([]);
      }
    };
    loadMyOrders();
  }, [token, user?.role]);

  // Listen for real-time menu availability changes
  useEffect(() => {
    if (!socket) return;

    const handleAvailabilityChange = (updatedItem) => {
      if (updatedItem?.deleted) {
        setMenuItems((prev) => prev.filter((item) => item.id !== updatedItem.id));
        return;
      }
      setMenuItems((prev) =>
        prev.map((item) =>
          item.id === updatedItem.id ? { ...item, ...updatedItem } : item
        )
      );
    };

    socket.on('menu:availability_changed', handleAvailabilityChange);

    return () => {
      socket.off('menu:availability_changed', handleAvailabilityChange);
    };
  }, [socket]);

  // Filter items logic
  const filteredItems = menuItems.filter((item) => {
    if (selectedCategory !== 'all') {
      const itemCategories = item.category_ids || [item.category_id];

      if (!itemCategories.map(String).includes(String(selectedCategory))) {
        return false;
      }
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchName =
        (item.name_en && item.name_en.toLowerCase().includes(q)) ||
        (item.name_hi && item.name_hi.toLowerCase().includes(q)) ||
        (item.name_gu && item.name_gu.toLowerCase().includes(q));
      const matchIng = item.ingredients_en && item.ingredients_en.toLowerCase().includes(q);
      const matchDesc = item.desc_en && item.desc_en.toLowerCase().includes(q);
      if (!matchName && !matchIng && !matchDesc) return false;
    }
    if (vegOnly && !item.is_veg) return false;
    if (availableOnly && (!item.is_available || item.available_qty <= 0)) return false;
    if (popularOnly && !item.is_popular) return false;
    if (specialOnly && !item.is_special) return false;
    return true;
  });

  // Featured sections
  // Today's Special is hotel-controlled. Recommendations use customer history
  // first, then popularity/rating/availability as the cold-start fallback.
  const todaysSpecials = menuItems.filter((it) => it.is_special && it.is_available && Number(it.available_qty ?? 1) > 0);

  const orderedCounts = {};
  const categoryCounts = {};
  myOrders.filter(o => o.status !== 'CANCELLED').forEach((order) => {
    (order.items || []).forEach((item) => {
      const id = String(item.id);
      const qty = Number(item.quantity || 1);
      orderedCounts[id] = (orderedCounts[id] || 0) + qty;
      const menuItem = menuItems.find(m => String(m.id) === id);
      if (menuItem) categoryCounts[String(menuItem.category_id)] = (categoryCounts[String(menuItem.category_id)] || 0) + qty;
    });
  });

  const recommendedItems = menuItems
    .filter(it => it.is_available && Number(it.available_qty ?? 1) > 0)
    .map(it => {
      const repeatScore = Math.min(40, (orderedCounts[String(it.id)] || 0) * 8);
      const categoryScore = Math.min(20, (categoryCounts[String(it.category_id)] || 0) * 4);
      const popularityScore = it.is_popular ? 20 : 0;
      const ratingScore = Math.min(15, Number(it.rating || 0) * 3);
      return { item: it, score: repeatScore + categoryScore + popularityScore + ratingScore + 5 };
    })
    .sort((a, b) => b.score - a.score || Number(b.item.rating || 0) - Number(a.item.rating || 0))
    .slice(0, 4)
    .map(x => x.item);

  const popularItems = menuItems
    .filter((it) => it.is_popular && it.is_available && Number(it.available_qty ?? 1) > 0);

  // "See All" on a featured section jumps to the full grid already on this page
  // rather than opening a second list — the same #menu-section the /menu route
  // scrolls to.
  const scrollToMenuGrid = useCallback(() => {
    const el = document.getElementById('menu-section');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleOrderConfirmed = (order) => {
    setConfirmedOrder(order);
    // The confirmation gets its own URL, carrying the order it is confirming, so
    // a reload of that page still knows which order it is about.
    const id = order?.id ?? order?.order_number;
    navigate(id ? `/order-success/${encodeURIComponent(id)}` : '/order-success');
  };

  /**
   * Put a past order back in the cart and go to the menu to buy it again.
   *
   * Shared by the orders list and the order detail page so the two cannot drift
   * on what a reorder actually adds.
   */
  const handleReorder = useCallback((order) => {
    (order.items || []).forEach((it) => {
      const menuItem = menuItems.find(m => String(m.id) === String(it.id));
      const foodImage = resolveFoodImage(menuItem) || resolveFoodImage(it);
      addToCart(
        {
          id: it.id,
          name_en: it.name_en || it.name,
          price: it.unit_price ?? it.price ?? 0,
          discount_price: it.discount_price ?? 0,
          is_available: true,
          available_qty: 99,
          image_url: foodImage,
          image: foodImage,
          is_veg: menuItem?.is_veg ?? it.is_veg ?? true
        },
        it.quantity || 1,
        it.customizations || [],
        ''
      );
    });
    navigate('/');
  }, [menuItems, addToCart, navigate]);

  // Which order the confirmation page is about. The URL wins, so a reload of
  // /order-success/41 still identifies order 41 even though the object the
  // checkout handed over is long gone.
  const successOrderId = route.orderId ?? confirmedOrder?.id ?? confirmedOrder?.order_number
    ?? activeOrder?.id ?? activeOrder?.order_number ?? null;
  const successOrder = confirmedOrder || activeOrder
    || (successOrderId ? { id: successOrderId, order_number: successOrderId } : null);

  const goToOrderTracking = useCallback((id) => {
    if (id) navigate(`/orders/${encodeURIComponent(id)}/tracking`);
  }, [navigate]);

  // Once a review is saved, stop asking for it every time the order status
  // re-renders or the tracker is reopened.
  const reviewedOrderIds = useRef(new Set());
  const markReviewed = useCallback((id) => {
    if (id) reviewedOrderIds.current.add(String(id));
    setIsFeedbackOpen(false);
  }, []);

  /**
   * Open the feedback prompt for an order, but only if the server agrees it is
   * finished and still unreviewed.
   *
   * The prompt belongs to one specific order, so it is tied to the order the
   * customer is actually following. Asking the server is what keeps it from
   * appearing over an order that is merely confirmed, and from appearing for a
   * meal that has already been rated.
   */
  const openFeedbackPrompt = useCallback(async (orderId) => {
    if (!orderId) {
      setIsFeedbackOpen(false);
      setFeedbackOrderId(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/review`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) return;
      const data = await res.json();
      const canAsk = data.canReview === true && !data.review;
      setFeedbackOrderId(canAsk ? String(data.orderId ?? orderId) : null);
      setIsFeedbackOpen(canAsk);
    } catch {
      // A failed check must not break the rest of the page.
    }
  }, [token]);

  useEffect(() => {
    const order = activeOrder || confirmedOrder;
    const id = order?.id || order?.order_number;
    if (!id) {
      setIsFeedbackOpen(false);
      setFeedbackOrderId(null);
      return;
    }
    if (reviewedOrderIds.current.has(String(id))) {
      setIsFeedbackOpen(false);
      setFeedbackOrderId(null);
      return;
    }
    // Never interrupt the confirmation screen: the customer has just paid and
    // is looking at their order number, not at a rating form.
    if (view === 'order_success') {
      setIsFeedbackOpen(false);
      setFeedbackOrderId(null);
      return;
    }
    if (order.status !== 'DELIVERED' && order.status !== 'COMPLETED') {
      setIsFeedbackOpen(false);
      setFeedbackOrderId(null);
      return;
    }
    openFeedbackPrompt(id);
  }, [activeOrder, confirmedOrder, view, openFeedbackPrompt]);

  // The menu body, as an element rather than inline JSX.
  //
  // Four addresses render it - /, /menu, /cart and /checkout - and they differ
  // only in which overlay the route opens, so it is built once and handed to
  // four <Route>s. React Router matches on one string path per route, so the
  // shared body cannot come from a path array; that is a runtime crash, not a
  // no-op.
  const menuElement = (
          <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-4 md:px-8 py-3 sm:py-6 pb-28 sm:pb-6">
            <HeroBanner
              onExploreMenu={() => navigate('/menu')}
              onTrackOrder={goToTracking}
            />

            <CategorySlider
              categories={categories}
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
            />

            {/*
              Filter toolbar. On mobile the boxed panel became a two-line block
              of 44px chips sitting between the categories and the food, so it is
              now a single horizontally scrollable strip of small chips. Every
              button still calls the same state setter, so the filtering itself is
              untouched; only the container around it changed.
            */}
            <div className="flex items-center gap-1.5 sm:gap-2 mb-4 sm:mb-8 px-3 sm:px-4 py-2 sm:py-4 rounded-xl sm:rounded-2xl bg-white border border-neutral-200 shadow-sm overflow-x-auto sm:overflow-visible sm:flex-wrap sm:justify-between">
              <div className="flex items-center gap-1.5 sm:gap-2 text-xs font-semibold text-neutral-500 min-w-max sm:min-w-0 sm:flex-1">
                <span className="flex items-center gap-1.5 sm:gap-2">
                  <Filter className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-neutral-400 shrink-0" />
                  <span className="hidden sm:inline">Filters:</span>
                </span>

                <button
                  onClick={() => setVegOnly(!vegOnly)}
                  className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl border transition cursor-pointer flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs font-medium whitespace-nowrap sm:min-h-[44px] ${
                    vegOnly
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                >
                  <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-600"></span>
                  <span>Pure Veg</span>
                </button>

                <button
                  onClick={() => setAvailableOnly(!availableOnly)}
                  className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl border transition cursor-pointer text-[11px] sm:text-xs font-medium whitespace-nowrap sm:min-h-[44px] ${
                    availableOnly
                      ? 'bg-neutral-900 text-white border-neutral-900 shadow-xs'
                      : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                >
                  In Stock
                </button>

                <button
                  onClick={() => setSpecialOnly(!specialOnly)}
                  className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl border transition cursor-pointer flex items-center gap-1 sm:gap-1 text-[11px] sm:text-xs font-medium whitespace-nowrap sm:min-h-[44px] ${
                    specialOnly
                      ? 'bg-[#e53939] text-white border-[#e53939] shadow-xs'
                      : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                >
                  <Sparkles className="w-3 h-3 sm:w-3 sm:h-3 text-amber-300" />
                  <span>Special</span>
                </button>

                <button
                  onClick={() => setPopularOnly(!popularOnly)}
                  className={`px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl border transition cursor-pointer flex items-center gap-1 sm:gap-1 text-[11px] sm:text-xs font-medium whitespace-nowrap sm:min-h-[44px] ${
                    popularOnly
                      ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                      : 'bg-neutral-50 hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                  }`}
                >
                  <Flame className="w-3 h-3 sm:w-3 sm:h-3 text-red-100" />
                  <span>Popular</span>
                </button>
              </div>

              {(vegOnly || availableOnly || popularOnly || specialOnly || selectedCategory !== 'all' || searchTerm) && (
                <button
                  onClick={() => {
                    setVegOnly(false);
                    setAvailableOnly(false);
                    setPopularOnly(false);
                    setSpecialOnly(false);
                    setSelectedCategory('all');
                    setSearchTerm('');
                  }}
                  className="text-[11px] sm:text-xs font-bold text-[#e53939] hover:text-red-700 hover:underline px-2.5 sm:px-3 py-1.5 sm:py-1.5 rounded-lg sm:rounded-xl border border-red-200 hover:bg-red-50 transition cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <span className="hidden sm:inline">Clear All Filters</span>
                  <span className="sm:hidden">Clear</span>
                </button>
              )}
            </div>

            {/*
              A featured row. The mobile variant is one 20px-tall title line with
              a small "See All" on the right; the subtitle that sat under the
              desktop heading is desktop-only, because two lines of heading per
              section is three sections' worth of scrolling before any food.
            */}
            {(() => {
              const sectionTitle = (icon, label, note) => (
                <div className="flex items-center justify-between gap-2 mb-2.5 sm:mb-4">
                  <h2 className="text-base sm:text-2xl font-black text-neutral-900 flex items-center gap-1.5 sm:gap-2 min-w-0">
                    {icon}
                    <span className="truncate">{label}</span>
                  </h2>
                  {note && (
                    <span className="hidden sm:inline text-xs font-bold text-[#e53935] uppercase tracking-wider">
                      {note}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={scrollToMenuGrid}
                    className="shrink-0 text-[11px] sm:text-xs font-bold text-[#e53935] hover:underline whitespace-nowrap"
                  >
                    See All
                  </button>
                </div>
              );

              return (
                <>
                  {/* SECTION: TODAY'S SPECIAL */}
                  {!searchTerm && selectedCategory === 'all' && !popularOnly && !specialOnly && todaysSpecials.length > 0 && (
                    <div className="mb-6 sm:mb-10">
                      {sectionTitle(
                        <Sparkles className="w-4 h-4 sm:w-6 sm:h-6 text-[#e53935] shrink-0" />,
                        t('todaysSpecial'),
                        "Chef Maharaj's Recommendation"
                      )}

                      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 md:gap-6">
                        {todaysSpecials.slice(0, 4).map((item) => (
                          <FoodCard
                            key={item.id}
                            item={item}
                            onOpenDetails={setSelectedFoodItem}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SECTION: RECOMMENDED FOR YOU */}
                  {!searchTerm && selectedCategory === 'all' && !popularOnly && !specialOnly && recommendedItems.length > 0 && (
                    <div className="mb-6 sm:mb-10 p-3 sm:p-6 rounded-2xl sm:rounded-3xl bg-gradient-to-r from-red-50/70 via-amber-50/50 to-red-50/70 border border-red-100 shadow-xs">
                      {sectionTitle(
                        <ThumbsUp className="w-4 h-4 sm:w-5 sm:h-5 text-[#e53935] shrink-0" />,
                        t('recommendedForYou'),
                        null
                      )}
                      <p className="hidden sm:block text-xs text-neutral-500 -mt-3 mb-4">
                        Frequently ordered together by Hotel Darshan patrons
                      </p>

                      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4">
                        {recommendedItems.map((item) => (
                          <FoodCard
                            key={item.id}
                            item={item}
                            onOpenDetails={setSelectedFoodItem}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SECTION: POPULAR */}
                  {!searchTerm && selectedCategory === 'all' && !popularOnly && !specialOnly && popularItems.length > 0 && (
                    <div className="mb-6 sm:mb-10">
                      {sectionTitle(
                        <Flame className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 shrink-0" />,
                        'Popular',
                        null
                      )}

                      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4">
                        {popularItems.slice(0, 4).map((item) => (
                          <FoodCard
                            key={item.id}
                            item={item}
                            onOpenDetails={setSelectedFoodItem}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* SECTION: MAIN MENU GRID */}
            <div id="menu-section" className="scroll-mt-24 space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base sm:text-2xl font-black text-neutral-900 flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <Utensils className="w-4 h-4 sm:w-6 sm:h-6 text-[#e53935] shrink-0" />
                  <span className="truncate">
                    {selectedCategory === 'all'
                      ? t('allCategories')
                      : categories.find((c) => String(c.id) === String(selectedCategory))?.name_en || t('allCategories')}
                  </span>
                </h2>
                <span className="text-[11px] sm:text-xs text-neutral-500 font-semibold shrink-0">
                  {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
                </span>
              </div>

              {loading ? (
                <div className="p-16 text-center text-xs text-neutral-400">Loading delicious food...</div>
              ) : filteredItems.length === 0 ? (
                <div className="p-16 text-center bg-white rounded-3xl border border-neutral-200">
                  <h3 className="font-bold text-base text-neutral-800 mb-1">No Dishes Match Your Filter</h3>
                  <p className="text-xs text-neutral-500 mb-4">Try clearing filters or searching for something else.</p>
                  <button
                    onClick={() => {
                      setSelectedCategory('all');
                      setSearchTerm('');
                      setVegOnly(false);
                      setAvailableOnly(false);
                    }}
                    className="px-5 py-2.5 bg-[#e53935] text-white font-bold text-xs rounded-xl cursor-pointer"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 md:gap-6">
                  {filteredItems.map((item) => (
                    <FoodCard
                      key={item.id}
                      item={item}
                      onOpenDetails={setSelectedFoodItem}
                    />
                  ))}
                </div>
              )}
            </div>
          </main>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#fafafa] text-neutral-800 pb-14 sm:pb-0">
      <NotificationToast />

      {/*
        The shared header, on every customer page except Account.

        Account brings its own title bar — back arrow, "My Account", the
        subtitle — and rendering the shared navbar above it put a second bar on
        screen carrying a back arrow, the logo and the town, both saying the
        same thing. Dropping the shared one here is the whole fix: nothing is
        replaced, because AccountSettings already had the title it needs.

        The bottom navigation below is outside <Routes> and is unaffected, so
        Home / Orders / Cart / Account are still reachable from this page.
      */}
      {view !== 'account' && (
        <Navbar
          // The navbar still thinks in view names. The menu family of URLs is one
          // view as far as it is concerned, which is what keeps the back button
          // and the search bar behaving exactly as they did before.
          currentView={view === 'menu' ? 'customer' : view}
          setCurrentView={goToView}
          setIsCartOpen={setCartOpen}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          setIsAuthModalOpen={setIsAuthModalOpen}
          onOpenAccount={() => {
            setIsAuthModalOpen(false);
            navigate('/account');
          }}
        />
      )}

      <Routes>
        {/* VIEW 1: CUSTOMER FOOD ORDERING EXPERIENCE */}
        {/*
          One element, four addresses. /menu is the grid rather than the top of
          the page, and /cart and /checkout are the cart drawer and the checkout
          modal over this same body, so they share it and differ only in which
          overlay the route opens.
        */}
        {/* The menu family: four addresses, one body. */}
        <Route path="/" element={menuElement} />
        <Route path="/menu" element={menuElement} />
        <Route path="/cart" element={menuElement} />
        <Route path="/checkout" element={menuElement} />

        {/* VIEW 2A: ORDER SUCCESS */}
        {(() => {
          // /order-success exists for the rare case where checkout confirms an
          // order without an id to put in the URL; the id form is the normal one.
          // Both render the same page, and they are two routes rather than one
          // route with two paths because React Router matches a single string.
          const successElement = (
            <OrderSuccess
              order={successOrder}
              onViewOrder={() => goToOrderTracking(successOrderId)}
              onContinueShopping={() => {
                setConfirmedOrder(null);
                navigate('/');
              }}
            />
          );
          return (
            <>
              <Route path="/order-success" element={successElement} />
              <Route path="/order-success/:orderId" element={successElement} />
            </>
          );
        })()}

        {/*
          VIEW 2: LIVE ORDER TRACKING

          The id comes from the URL and nowhere else. It used to be handed in
          from the active-order state, which a refresh empties - so reloading a
          tracking page made the tracker fall back to "whichever of my orders is
          newest and unfinished", which is a guess that silently showed the wrong
          meal. The URL already says which order this is; the tracker reads it
          and fetches it.
        */}
        <Route path="/orders/:orderId/tracking" element={(
          <OrderTrackingView
            orderIdOrNumber={route.orderId}
            onBackToMenu={() => navigate('/')}
            onOrderAgain={() => navigate('/')}
            onRequestReview={() => {
              // Same server check the automatic prompt uses, so the button can
              // never open the form for an order that is already rated.
              const o = activeOrder || confirmedOrder;
              openFeedbackPrompt(route.orderId || o?.id || o?.order_number);
            }}
          />
        )} />

        {/* VIEW 2B: CUSTOMER ACCOUNT */}
        <Route path="/account" element={(
          <AccountSettings
            onBack={() => navigate('/')}
            onOpenOrders={() => navigate('/orders')}
            menuItems={menuItems}
          />
        )} />

        {/* VIEW 3: MY ORDERS */}
        <Route path="/orders" element={(
          <MyOrdersView
            onBackToMenu={() => navigate('/')}
            onReorder={handleReorder}
            menuItems={menuItems}
          />
        )} />

        {/* VIEW 4: A SINGLE ORDER */}
        <Route path="/orders/:orderId" element={(
          <OrderDetailView
            orderId={route.orderId}
            onBackToOrders={() => navigate('/orders')}
            onTrackOrder={goToOrderTracking}
            onReorder={handleReorder}
            menuItems={menuItems}
          />
        )} />

        {/*
          An address that matches nothing. It stays on the bad URL rather than
          quietly redirecting, so a mistyped or stale link is visible as a
          mistake instead of looking like the app sent the customer somewhere.
        */}
        <Route path="*" element={(
          <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-16 text-center">
            <h2 className="text-2xl font-black text-neutral-900">Page not found</h2>
            <p className="text-sm text-neutral-500 mt-2">
              There is nothing at this address.
            </p>
            <button
              onClick={() => navigate('/')}
              className="mt-6 px-6 py-2.5 bg-[#e53935] hover:bg-[#c62828] text-white font-bold text-sm rounded-xl transition cursor-pointer"
            >
              Go to the menu
            </button>
          </main>
        )} />
      </Routes>

      {/*
        Bottom cart bar — mobile only, and only while the cart has something in
        it. It sits directly above the bottom nav rather than replacing it, so
        the four nav destinations stay reachable. "View Cart" opens the same
        cart drawer the header icon opens; checkout is still reached from inside
        the drawer, exactly as it was before this bar existed.
      */}
      {cart.length > 0 && view === 'menu' && (
        <div className="sm:hidden fixed bottom-[56px] left-0 right-0 z-40 bg-white border-t border-neutral-200 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <div className="w-full px-3 py-2 flex items-center gap-3">
            <div
              onClick={() => setCartOpen(true)}
              className="flex-1 min-w-0 cursor-pointer flex items-center gap-2"
            >
              <div className="relative w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-neutral-100 border border-neutral-200">
                <img
                  src={resolveFoodImage(cart[0])}
                  alt={cart[0].name_en || cart[0].name || 'Food'}
                  className="w-full h-full object-cover"
                />
                <span className="absolute -top-1 -right-1 bg-[#e53939] text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-white">
                  {cart.reduce((s, i) => s + i.quantity, 0) > 9
                    ? '9+'
                    : cart.reduce((s, i) => s + i.quantity, 0)}
                </span>
              </div>
              <div className="min-w-0">
                <p className="font-bold text-xs text-neutral-900 truncate leading-tight">
                  {cart.reduce((s, i) => s + i.quantity, 0)}{' '}
                  {cart.reduce((s, i) => s + i.quantity, 0) === 1 ? 'item' : 'items'}
                  <span className="text-neutral-300 mx-1">•</span>
                  <span className="text-[#e53939]">₹{totals.grandTotal || 0}</span>
                </p>
                <p className="text-[10px] text-neutral-500 truncate leading-tight">Hotel Darshan</p>
              </div>
            </div>

            <button
              onClick={() => setCartOpen(true)}
              className="shrink-0 px-4 py-2 bg-[#e53939] hover:bg-[#c62828] text-white font-black text-[11px] rounded-lg transition cursor-pointer"
            >
              View Cart
            </button>
          </div>
        </div>
      )}

      {/*
        Mobile bottom navigation. The app is already a single-page router with
        /, /orders, /cart and /account, so these are the existing destinations
        rather than a second navigation system: Home and Orders go through
        goToView, Cart opens the same cart drawer, and Account reuses the
        header's own onOpenAccount handler. Desktop keeps the header nav only.
      */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 h-14 bg-white border-t border-neutral-200 shadow-[0_-1px_6px_rgba(0,0,0,0.05)]">
        <div className="h-full grid grid-cols-4">
          <button
            type="button"
            onClick={() => goToView('customer')}
            className={`flex flex-col items-center justify-center gap-0.5 cursor-pointer transition ${
              view === 'menu' ? 'text-[#e53939]' : 'text-neutral-500'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-semibold leading-none">Home</span>
          </button>

          <button
            type="button"
            onClick={() => goToView('my_orders')}
            className={`flex flex-col items-center justify-center gap-0.5 cursor-pointer transition ${
              view === 'my_orders' ? 'text-[#e53939]' : 'text-neutral-500'
            }`}
          >
            <Package className="w-5 h-5" />
            <span className="text-[10px] font-semibold leading-none">Orders</span>
          </button>

          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="relative flex flex-col items-center justify-center gap-0.5 cursor-pointer transition text-neutral-500"
          >
            <ShoppingCart className="w-5 h-5" />
            <span className="text-[10px] font-semibold leading-none">Cart</span>
            {cartItemCount > 0 && (
              <span className="absolute top-1.5 right-[22%] bg-[#e53939] text-white text-[9px] font-black min-w-[15px] h-[15px] px-1 rounded-full flex items-center justify-center">
                {cartItemCount > 9 ? '9+' : cartItemCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setIsAuthModalOpen(false);
              navigate('/account');
            }}
            className={`flex flex-col items-center justify-center gap-0.5 cursor-pointer transition ${
              view === 'account' ? 'text-[#e53939]' : 'text-neutral-500'
            }`}
          >
            <User className="w-5 h-5" />
            <span className="text-[10px] font-semibold leading-none">Account</span>
          </button>
        </div>
      </nav>

      {/* Modals & Drawers */}
      <FoodDetailsModal
        item={selectedFoodItem}
        onClose={() => setSelectedFoodItem(null)}
      />

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setCartOpen(false)}
        onProceedToCheckout={() => navigate('/checkout')}
        menuItems={menuItems}
      />

      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => navigate(route.backTo || '/')}
        onOrderConfirmed={handleOrderConfirmed}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* The feedback form is only ever rendered for a real, identified order.
          Guarding here as well as in the effect means a cleared active order can
          never produce a request for `${API_BASE}/orders/undefined/review`. */}
      {isFeedbackOpen && feedbackOrderId && (
        <PostOrderFeedbackModal
          orderId={feedbackOrderId}
          onClose={() => setIsFeedbackOpen(false)}
          onReviewed={markReviewed}
        />
      )}

      {/* Footer — the two links are desktop-only now that the mobile bottom nav
          carries Home and Orders, and the block itself is half as tall on a
          phone. */}
      <footer className="mt-auto bg-neutral-900 text-neutral-400 text-xs border-t border-neutral-800 py-6 sm:py-10 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 sm:gap-6">
          <div className="text-center md:text-left space-y-1">
            <div className="flex items-center justify-center md:justify-start gap-2">
              <span className="font-black text-lg text-white">Hotel Darshan</span>
              <span className="px-1.5 py-0.2 rounded-md bg-emerald-900/60 text-emerald-400 text-[10px] font-bold uppercase">
                100% Pure Veg
              </span>
            </div>
            <p className="text-neutral-500">
              Char Rasta, Mosda Road, Dediapada, Gujarat - 393040
            </p>
            <p className="text-neutral-600">
              Helpline: +91 9054862428 • FSSAI Lic. No: 10726041000022
            </p>
          </div>

          <div className="hidden sm:flex flex-wrap items-center justify-center gap-4 text-neutral-400">
            <button
              onClick={() => navigate('/')}
              className="hover:text-white transition cursor-pointer"
            >
              {t('exploreMenu')}
            </button>
            <button
              onClick={() => navigate('/orders')}
              className="hover:text-white transition cursor-pointer"
            >
              {t('myOrders')}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  // Read the router's location rather than window.location directly. StaffPortal
  // swaps URLs with history.replaceState, and only a location the router knows
  // about re-renders the branch below when that happens.
  const { pathname } = useLocation();

  // Staff portals are separate URLs and are never rendered inside the customer UI.
  if (pathname.startsWith('/staff')) {
    return (
      <Suspense fallback={
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-neutral-100">
          <BrandLogo size="lg" />
          <p className="text-neutral-600 font-semibold">Loading staff portal…</p>
        </div>
      }>
        <StaffPortal />
      </Suspense>
    );
  }

  return <CustomerApp />;
}

/**
 * Shown while the stored session is being checked.
 *
 * This is deliberately not a redirect and deliberately not the sign-in page. A
 * reload on /orders/41/tracking has to survive the check that decides whether
 * that token is still good, and the only way to guarantee it is to not decide
 * anything yet: the URL is untouched, so whatever the answer is, the customer
 * finishes on the page they asked for.
 */
function SessionCheckSplash() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[#fafafa]">
      <BrandLogo size="lg" />
      <div className="w-10 h-10 rounded-full border-4 border-neutral-200 border-t-[#e53935] animate-spin" />
      <p className="text-sm font-semibold text-neutral-500">Checking your session…</p>
    </div>
  );
}

// Everything a signed-in or signing-in customer sees. The theme provider lives
// here rather than in main.jsx so the Admin / Kitchen portals keep their own
// appearance exactly as before.
function CustomerApp() {
  const { user, isAuthReady } = useAuth();
  const [locationReady, setLocationReady] = useState(() => {
    try {
      return Boolean(localStorage.getItem('hotelDarshanLocation'));
    } catch {
      localStorage.removeItem('hotelDarshanLocation');
      return false;
    }
  });
  const [showPermissionGate, setShowPermissionGate] = useState(false);

  return (
    <ThemeProvider>
      {/* Nothing below the session check may look at `user` to decide a route.
          Until the server has confirmed the token, `user` is only what was
          cached, and acting on it either bounces a valid customer to sign-in or
          shows a revoked session one frame of the wrong page. */}
      {!isAuthReady ? (
        <SessionCheckSplash />
      ) : !user || user.role !== 'customer' ? (
        <AuthPage onSuccess={() => setShowPermissionGate(true)} />
      ) : showPermissionGate ? (
        <PermissionScreen onAllow={() => setShowPermissionGate(false)} />
      ) : !locationReady ? (
        <LocationGate onReady={() => setLocationReady(true)} />
      ) : (
        <AppContent />
      )}
    </ThemeProvider>
  );
}
