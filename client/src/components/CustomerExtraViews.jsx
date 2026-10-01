import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import { useLanguage } from '../context/LanguageContext';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { resolveFoodImage } from '../data/foodImages';
import { isFinished } from '../lib/orderStatus';
import { formatDateTime, formatEstimatedArrival, timeAgo } from '../lib/time.js';
import {
  MapPin,
  PhoneCall,
  ShieldCheck,
  Package,
  RefreshCw,
  ArrowLeft,
  Star,
  Plus,
  Minus
} from 'lucide-react';
import FoodImage from './FoodImage';
import { apiBase as API_BASE } from '../lib/apiBase';

function StatusBadge({ status }) {
  const s = String(status || 'ORDER_PLACED').replace(/_/g, ' ');
  const lower = s.toLowerCase();
  let cls = 'bg-amber-100 text-amber-900';
  if (lower.includes('confirmed') || lower.includes('preparing')) cls = 'bg-blue-100 text-blue-900';
  if (lower.includes('ready') || lower.includes('out for delivery')) cls = 'bg-purple-100 text-purple-900';
  if (lower.includes('delivered') || lower.includes('picked up') || lower.includes('completed')) cls = 'bg-emerald-100 text-emerald-900';
  if (lower.includes('cancelled')) cls = 'bg-red-100 text-red-900';
  return <span className={`px-3 py-1 rounded-full text-[11px] font-black uppercase ${cls}`}>{s}</span>;
}

function PreviouslyOrderedFoodCard({ item, onAddToCart }) {
  const imageUrl = resolveFoodImage(item);
  const foodName = item.name_en || item.name || 'Food Item';
  const price = item.discount_price && item.discount_price > 0
    ? item.discount_price
    : item.unit_price ?? item.price ?? 0;
  const isAvailable = item.is_available !== false && (item.available_qty ?? 1) > 0;

  const handleAddToCart = (e) => {
    e.stopPropagation();
    onAddToCart({
      ...item,
      price: item.unit_price ?? item.price ?? 0,
      discount_price: item.discount_price ?? 0,
      is_available: isAvailable,
      available_qty: item.available_qty ?? 99,
      image_url: imageUrl,
      image: imageUrl
    });
  };

  return (
    <div className="p-3.5 rounded-2xl bg-neutral-50/70 border border-neutral-200/80 flex gap-3 relative">
      <FoodImage
        src={imageUrl}
        alt={foodName}
        className="w-16 h-16 rounded-xl object-cover shrink-0 border border-neutral-200"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-bold text-sm text-neutral-900 line-clamp-1">
            {foodName}
          </h4>
          {item.is_veg !== false && (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded border border-emerald-500 shrink-0 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            </span>
          )}
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="font-black text-sm text-[#e53935]">₹{price}</span>
          <button
            onClick={handleAddToCart}
            disabled={!isAvailable}
            className={`px-3 py-1.5 text-white font-bold text-xs rounded-xl transition cursor-pointer ${
              isAvailable ? 'bg-[#e53935] hover:bg-red-700' : 'bg-neutral-300 cursor-not-allowed'
            }`}
          >
            {isAvailable ? 'Add to Cart' : 'Unavailable'}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderHistoryCard({ order, onReorder }) {
  const navigate = useNavigate();
  const total = order.grand_total || order.total_amount || order.total || 0;
  // `toLocaleString()` with no arguments was the worst of the two: it used the
  // device locale, the device timezone, and re-read the server's UTC string as
  // local. Now it is the shared IST formatter.
  const date = order.created_at ? formatDateTime(order.created_at) : 'Recent Order';
  const isCompleted = isFinished(order.status);
  // Which order this is, in the form the routes use. Every destination below is
  // built from the row the server returned rather than from a stored id, so a
  // link can only ever point at an order on this page.
  const orderId = order.id ?? order.order_number;
  const idParam = encodeURIComponent(orderId);

  return (
    <div className="p-5 rounded-3xl bg-white border border-neutral-200 shadow-xs space-y-3">
      <div className="flex justify-between items-center pb-3 border-b border-neutral-100">
        <div>
          <span className="font-mono font-black text-sm text-neutral-900">#{order.order_number || order.id}</span>
          <span className="text-xs text-neutral-400 block mt-0.5">
            {date}
            {/* Both readings on one line: the exact IST clock, and how long ago
                that was, recomputed from the same parsed instant. */}
            {timeAgo(order.created_at) && (
              <span className="text-neutral-300"> · {timeAgo(order.created_at)}</span>
            )}
          </span>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="text-xs text-neutral-700 font-medium space-y-1">
        {(order.items || []).map((it, idx) => (
          <div key={`${it.id || 'item'}-${idx}`} className="flex justify-between">
            <span>{it.quantity || 1}x {it.name_en || it.name || `Item ${it.id || ''}`}</span>
            <span className="font-bold">
              ₹{(it.item_total_price ?? it.total_price ?? (it.unit_price ?? it.price ?? 0) * (it.quantity || it.qty || 1))}
            </span>
          </div>
        ))}
        {(order.items || []).length === 0 && (
          <p className="text-neutral-400">No items listed</p>
        )}
      </div>
      <div className="flex justify-between items-center pt-2 border-t border-neutral-100 text-xs">
        <span className="font-bold text-neutral-900">Total: ₹{total}</span>
        <div className="flex items-center gap-2">
          {/*
            Live orders go straight to the tracker; finished ones have nothing
            left to track, so they go to the order's own page. Both are ordinary
            addresses, which is what makes the back button and a reload work.
          */}
          {isCompleted ? (
            <button
              onClick={() => navigate(`/orders/${idParam}`)}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 text-neutral-700 font-bold hover:bg-neutral-50 cursor-pointer"
            >
              View details
            </button>
          ) : (
            <button
              onClick={() => navigate(`/orders/${idParam}/tracking`)}
              className="px-3 py-1.5 rounded-lg border border-red-200 text-[#e53939] font-bold hover:bg-red-50 cursor-pointer"
            >
              Track live
            </button>
          )}
          {isCompleted && (
            <button
              onClick={() => onReorder && onReorder(order)}
              className="px-3 py-1.5 rounded-lg bg-[#e53935] text-white font-bold hover:bg-red-700 cursor-pointer"
            >
              Reorder
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function MyOrdersView({ onBackToMenu, onReorder, menuItems = [] }) {
  const { t } = useLanguage();
  const { token } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  // Set only when the request itself failed, as opposed to succeeding with
  // nothing in it. Those are different: an empty history is a fact, a failed
  // read is a problem, and only the second one should offer a retry.
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState('previously'); // 'previously' or 'history'

  const loadOrders = async () => {
    setLoading(true);
    setLoadError('');
    let loaded = [];
    if (token) {
      try {
        const res = await fetch(`${API_BASE}/orders/my-orders`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('Your order history could not be loaded.');
        const data = await res.json();
        if (Array.isArray(data)) loaded = data;
      } catch (err) {
        // A failed read must not look like an empty history, and it must not move
        // the customer anywhere: the page they opened is still the page they are
        // on. All that changes is that a retry becomes available.
        setOrders([]);
        setLoadError(err.message || 'Your order history could not be loaded.');
        setLoading(false);
        return;
      }
    }
    // There is no local fallback any more, and there must not be. This list is
    // the customer's orders, and an order has exactly one record: the row on the
    // server. A browser-side copy could only ever disagree with it - it went stale
    // the moment the rider moved, and it survived a phone that had been offline
    // for the whole delivery, showing a meal as "on the way" that was already
    // handed over. If the request fails the list is empty, which is honest.
    setOrders(loaded);
    setLoading(false);
  };

  useEffect(() => { loadOrders(); }, [token]);

  // Active and history are the two halves of the delivery flow, and the split is
  // the server's to make: FINISHED_STATUSES is DELIVERED, COMPLETED, CANCELLED
  // and REJECTED. This list used to be maintained here as
  // ['DELIVERED','PICKED_UP','COMPLETED','CANCELLED'], which put an order that
  // was still on the road into history (and gave it a Reorder button) and let a
  // rejected order appear in neither tab.
  const completedOrders = orders.filter(o => isFinished(o.status));

  const uniquePreviouslyOrderedItems = useMemo(() => {
    const itemMap = new Map();
    completedOrders.forEach((order) => {
      (order.items || []).forEach((it) => {
        const id = it.id;
        if (!id) return;
        if (!itemMap.has(id)) {
          const menuItem = menuItems.find(m => String(m.id) === String(id));
          itemMap.set(id, {
            ...it,
            image_url: resolveFoodImage(menuItem) || resolveFoodImage(it),
            is_veg: it.is_veg !== undefined ? it.is_veg : (menuItem && menuItem.is_veg) ?? true,
            is_available: it.is_available !== undefined ? it.is_available : (menuItem && menuItem.is_available) ?? true,
            available_qty: it.available_qty ?? (menuItem && menuItem.available_qty) ?? 50,
            price: it.unit_price ?? it.price ?? (menuItem && menuItem.price) ?? 0,
            discount_price: it.discount_price ?? (menuItem && menuItem.discount_price) ?? 0,
            name_en: it.name_en || it.name || (menuItem && menuItem.name_en) || 'Food Item',
            name_hi: it.name_hi || (menuItem && menuItem.name_hi) || '',
            name_gu: it.name_gu || (menuItem && menuItem.name_gu) || '',
            category_name_en: menuItem && menuItem.category_name_en || '',
          });
        }
      });
    });
    return Array.from(itemMap.values());
  }, [completedOrders, menuItems]);

  const handleAddToCartFromPreviously = (item) => {
    if (item.is_available === false || item.available_qty <= 0) {
      return;
    }
    onReorder({
      items: [{
        id: item.id,
        name_en: item.name_en,
        unit_price: item.unit_price ?? item.price ?? 0,
        discount_price: item.discount_price ?? 0,
        quantity: 1,
        customizations: [],
        image_url: resolveFoodImage(item)
      }]
    });
  };

  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col">
      <div className="bg-white border-b border-neutral-200 sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBackToMenu} className="p-2 rounded-xl hover:bg-neutral-100 transition">
              <ArrowLeft className="w-5 h-5 text-neutral-700" />
            </button>
            <div>
              <h1 className="text-xl font-black text-neutral-900">{t('myOrders')}</h1>
              <p className="text-xs text-neutral-500">Your dining history with Hotel Darshan</p>
            </div>
          </div>
          <button onClick={loadOrders} disabled={loading} className="p-2 rounded-xl border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 text-neutral-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 sm:px-8 py-6 w-full flex-1">
        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-2xl border border-neutral-200 text-xs font-bold mb-6">
          <button
            onClick={() => setActiveTab('previously')}
            className={`flex-1 px-4 py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 ${
              activeTab === 'previously'
                ? 'bg-white text-neutral-900 shadow-xs'
                : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <Star className="w-3.5 h-3.5 text-[#e53935]" />
            Previously Ordered
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 px-4 py-2.5 rounded-xl transition flex items-center justify-center gap-1.5 ${
              activeTab === 'history'
                ? 'bg-white text-neutral-900 shadow-xs'
                : 'text-neutral-500 hover:text-neutral-800'
            }`}
          >
            <Package className="w-3.5 h-3.5 text-[#e53935]" />
            Order History
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-8 h-8 text-[#e53935] animate-spin mx-auto mb-2" />
            <p className="text-sm font-bold text-neutral-600">Fetching order history...</p>
          </div>
        ) : loadError ? (
          // The read failed, so this is not an empty history. Say which, and
          // offer the one action that helps: re-run this same request. Note there
          // is no link home here on purpose - the customer asked for their
          // orders, and leaving the page is not a way to fix a failed request.
          <div className="bg-white border border-red-200 rounded-3xl p-10 text-center shadow-xs">
            <div className="w-14 h-14 bg-red-50 text-[#e53935] rounded-full flex items-center justify-center mx-auto mb-4">
              <RefreshCw className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-black text-neutral-900">Could not load your orders</h2>
            <p className="text-xs text-neutral-500 mt-1 mb-6">{loadError}</p>
            <button
              onClick={loadOrders}
              className="px-6 py-3 rounded-2xl bg-[#e53935] text-white font-bold text-xs hover:bg-red-700 shadow-md cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white border border-neutral-200 rounded-3xl p-10 text-center shadow-xs">
            <div className="w-14 h-14 bg-red-50 text-[#e53935] rounded-full flex items-center justify-center mx-auto mb-4">
              <Package className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-black text-neutral-900">No Orders Yet</h2>
            <p className="text-xs text-neutral-500 mt-1 mb-6">
              Order your first hot delicious meal from Hotel Darshan today.
            </p>
            <button
              onClick={onBackToMenu}
              className="px-6 py-3 rounded-2xl bg-[#e53935] text-white font-bold text-xs hover:bg-red-700 shadow-md cursor-pointer"
            >
              Explore Menu
            </button>
          </div>
        ) : (
          <>
            {/* PREVIOUSLY ORDERED TAB */}
            {activeTab === 'previously' && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <Star className="w-4 h-4 text-neutral-400" />
                  <h2 className="text-lg font-black text-neutral-900">Previously Ordered</h2>
                  <span className="text-[11px] font-bold text-neutral-400">
                    {uniquePreviouslyOrderedItems.length} {uniquePreviouslyOrderedItems.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                {uniquePreviouslyOrderedItems.length === 0 ? (
                  <div className="bg-white border border-neutral-200 rounded-3xl p-8 text-center">
                    <p className="text-sm text-neutral-500">No previously ordered items yet.</p>
                  </div>
                ) : (
                  <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-3 scroll-smooth">
                    {uniquePreviouslyOrderedItems.map((item) => (
                      <PreviouslyOrderedFoodCard
                        key={item.id}
                        item={item}
                        onAddToCart={handleAddToCartFromPreviously}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ORDER HISTORY TAB */}
            {activeTab === 'history' && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <Package className="w-4 h-4 text-neutral-400" />
                  <h2 className="text-lg font-black text-neutral-900">Order History</h2>
                  <span className="text-[11px] font-bold text-neutral-400">Delivered / Takeaway / Cancelled</span>
                </div>
                {completedOrders.length === 0 ? (
                  <div className="bg-white border border-neutral-200 rounded-3xl p-8 text-center">
                    <p className="text-sm text-neutral-500">No order history available.</p>
                  </div>
                ) : (
                  <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-4 scroll-smooth">
                    {completedOrders.map((o) => (
                      <OrderHistoryCard
                        key={o.id || o.order_number}
                        order={o}
                        onReorder={onReorder}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/**
 * One order, at /orders/:orderId.
 *
 * The id arrives in the URL and is the only thing consulted to decide what to
 * show, so this page is the same after a reload, a shared link, or a back button
 * as it is the first time it is opened. The request is the track endpoint: it is
 * the one order read that already applies the ownership check, and it answers
 * from the database alone, so there is no second way for this page to end up
 * showing an order it should not.
 */
export function OrderDetailView({ orderId, onBackToOrders, onTrackOrder, onReorder }) {
  const { token } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOrder = async () => {
    if (!orderId) {
      setLoading(false);
      setError('This link has no order in it.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/track`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'This order could not be loaded.');
      setOrder(data?.order || data);
    } catch (err) {
      setError(err.message || 'This order could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOrder(); }, [orderId, token]);

  if (loading) {
    return (
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-12 text-center">
        <RefreshCw className="w-8 h-8 text-[#e53935] animate-spin mx-auto mb-2" />
        <p className="text-sm font-bold text-neutral-600">Loading this order...</p>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-12 text-center">
        <div className="bg-white border border-red-200 rounded-3xl p-10 shadow-xs">
          <div className="w-14 h-14 bg-red-50 text-[#e53935] rounded-full flex items-center justify-center mx-auto mb-4">
            <Package className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-black text-neutral-900">Could not load this order</h2>
          <p className="text-xs text-neutral-500 mt-1 mb-6">{error}</p>
          <div className="flex justify-center gap-3">
            {/* Retry re-runs this one request and stays on this URL. */}
            <button
              onClick={loadOrder}
              className="px-6 py-3 rounded-2xl bg-[#e53935] text-white font-bold text-xs hover:bg-red-700 shadow-md cursor-pointer"
            >
              Retry
            </button>
            <button
              onClick={onBackToOrders}
              className="px-6 py-3 rounded-2xl bg-neutral-100 text-neutral-700 font-bold text-xs hover:bg-neutral-200 cursor-pointer"
            >
              All my orders
            </button>
          </div>
        </div>
      </main>
    );
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const address = typeof order.address === 'object' ? order.address : { address: order.address };
  const finished = isFinished(order.status);
  const total = order.grand_total ?? order.total_amount ?? order.total ?? 0;

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 sm:py-8 space-y-4">
      <button
        onClick={onBackToOrders}
        className="inline-flex items-center gap-2 text-sm font-bold text-neutral-600 hover:text-[#e53935] cursor-pointer min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" /> All my orders
      </button>

      <section className="bg-white border border-neutral-200 rounded-3xl shadow-xs p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-neutral-100">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-neutral-400">Order</p>
            <h1 className="font-mono text-xl font-black text-neutral-900 mt-0.5">
              #{order.order_number || order.id}
            </h1>
            {order.created_at && (
              <p className="text-xs text-neutral-500 mt-1">
                Placed {formatDateTime(order.created_at)} (IST)
              </p>
            )}
          </div>
          <StatusBadge status={order.status} />
        </div>

        <div className="text-sm text-neutral-700 space-y-2">
          {(items || []).map((it, idx) => (
            <div key={`${it.id || 'item'}-${idx}`} className="flex justify-between gap-3">
              <span className="text-xs font-medium">
                {it.quantity || 1}x {it.name_en || it.name || `Item ${it.id || ''}`}
              </span>
              <span className="text-xs font-bold shrink-0">
                ₹{(it.item_total_price ?? it.total_price ?? (it.unit_price ?? it.price ?? 0) * (it.quantity || it.qty || 1))}
              </span>
            </div>
          ))}
          {items.length === 0 && <p className="text-xs text-neutral-400">No items listed</p>}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-neutral-100">
          <span className="text-sm font-black text-neutral-900">Total</span>
          <span className="text-base font-black text-[#e53939]">₹{Number(total).toFixed(2)}</span>
        </div>

        {(address?.address || address?.label) && (
          <div className="flex items-start gap-2 pt-3 border-t border-neutral-100 text-xs text-neutral-600">
            <MapPin className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
            <span>{address.address || address.label}</span>
          </div>
        )}

        {/*
          The order's real expected arrival: `created_at` plus the estimate
          recorded on the row, rendered in IST. Only meaningful while the order is
          still moving - a delivered order is in the past, not 30 minutes away.
        */}
        {!finished && formatEstimatedArrival(order) && (
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-neutral-100 text-xs">
            <span className="text-neutral-500">Expected arrival</span>
            <span className="font-bold text-neutral-900">
              {formatEstimatedArrival(order)} IST
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-3 border-t border-neutral-100">
          {/*
            A finished order has nothing left to watch, so it offers a reorder
            instead of a tracker. An order still moving goes to its own tracking
            URL, which is a different address on purpose - it is the same order
            in a different state, and both survive a reload.
          */}
          {finished ? (
            <button
              onClick={() => onReorder(order)}
              className="px-5 py-2.5 rounded-xl bg-[#e53935] text-white font-bold text-xs hover:bg-red-700 cursor-pointer"
            >
              Reorder
            </button>
          ) : (
            <button
              onClick={() => onTrackOrder(order.id ?? order.order_number)}
              className="px-5 py-2.5 rounded-xl bg-[#e53935] text-white font-bold text-xs hover:bg-red-700 cursor-pointer"
            >
              Track this order
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

export default function CustomerView({
  onSelectDish,
  onViewCategory,
  onSelectOrder,
  searchTerm
}) {
  const { t } = useLanguage();
  const { cart, addToCart, activeOrder } = useCart();
  const { token } = useAuth();

  const [activeTab, setActiveTab] = useState('menu'); // 'menu' or 'orders'
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customerOrders, setCustomerOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // Fetch Menu Categories & Items
  useEffect(() => {
    const fetchMenuData = async () => {
      try {
        setLoading(true);
        const [catRes, itemRes] = await Promise.all([
          fetch(`${API_BASE}/menu/categories`),
          fetch(`${API_BASE}/menu/items`)
        ]);
        if (catRes.ok) setCategories(await catRes.json());
        if (itemRes.ok) setItems(await itemRes.json());
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchMenuData();
  }, []);

  // Fetch Customer Orders (from API + localStorage fallback)
  const fetchCustomerOrders = async () => {
    setOrdersLoading(true);
    let loadedOrders = [];

    if (token) {
      try {
        const res = await fetch(`${API_BASE}/orders/my-orders`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) loadedOrders = data;
        }
      } catch (e) {}
    }

    // No localStorage fallback, for the same reason as in MyOrdersView above: the
    // server holds the only copy of an order, and a browser-side copy of the same
    // one can only ever disagree with it.
    setCustomerOrders(loadedOrders);
    setOrdersLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'orders') {
      fetchCustomerOrders();
    }
  }, [activeTab, token, activeOrder?.id]);

  // Filter items by search query
  const filteredItems = items.filter((item) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      item.name_en?.toLowerCase().includes(term) ||
      item.name_hi?.toLowerCase().includes(term) ||
      item.name_gu?.toLowerCase().includes(term) ||
      item.category_name_en?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col justify-between">
      {/* Sub Header Navigation Tabs */}
      <div className="bg-white border-b border-neutral-200 sticky top-14 z-20 px-4 sm:px-8 py-2.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 bg-neutral-100 p-1 rounded-2xl border border-neutral-200 text-xs font-bold">
            <button
              onClick={() => setActiveTab('menu')}
              className={`px-4 py-2 rounded-xl transition ${
                activeTab === 'menu'
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              Menu & Dishes
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 ${
                activeTab === 'orders'
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <Package className="w-3.5 h-3.5 text-[#e53935]" />
              <span>My Orders</span>
              {customerOrders.length > 0 && (
                <span className="bg-[#e53935] text-white text-[10px] px-1.5 py-0.2 rounded-full font-black">
                  {customerOrders.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 w-full flex-1">
        {/* TAB 1: MENU VIEW */}
        {activeTab === 'menu' && (
          <div className="space-y-8">
            {/* Hero / Banner */}
            <div className="relative rounded-3xl overflow-hidden bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900 text-white p-6 sm:p-10 shadow-lg">
              <div className="max-w-xl space-y-3 relative z-10">
                <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold uppercase tracking-wider">
                  100% Pure Vegetarian
                </span>
                <h1 className="text-2xl sm:text-4xl font-black leading-tight">
                  Hot & Fresh Kathiyawadi, Gujarati & Punjabi Specialities
                </h1>
                <p className="text-xs sm:text-sm text-neutral-300">
                  Delivered straight from Hotel Darshan kitchen in Dediapada. Order online for instant pickup or delivery.
                </p>
              </div>
            </div>

            {/* Menu Items Grid */}
            {loading ? (
              <div className="py-12 text-center">
                <RefreshCw className="w-8 h-8 text-[#e53935] animate-spin mx-auto mb-2" />
                <p className="text-sm font-bold text-neutral-600">Loading food menu...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredItems.map((item) => {
                  const cartEntry = cart.find((c) => c.id === item.id);
                  const qty = cartEntry ? cartEntry.quantity : 0;

                  return (
                    <div
                      key={item.id}
                      className="bg-white rounded-3xl border border-neutral-200/80 shadow-xs hover:shadow-md transition overflow-hidden flex flex-col justify-between"
                    >
                      <div>
                        {resolveFoodImage(item) && (
                          <div
                            onClick={() => onSelectDish && onSelectDish(item)}
                            className="h-44 w-full bg-neutral-100 overflow-hidden cursor-pointer relative"
                          >
                            <img
                              src={resolveFoodImage(item)}
                              alt={item.name_en}
                              className="w-full h-full object-cover hover:scale-105 transition duration-300"
                            />
                            <span className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-emerald-600 text-white font-bold text-[10px] uppercase">
                              Pure Veg
                            </span>
                          </div>
                        )}

                        <div className="p-4 space-y-1">
                          <div
                            onClick={() => onSelectDish && onSelectDish(item)}
                            className="font-bold text-sm text-neutral-900 hover:text-[#e53935] cursor-pointer transition line-clamp-1"
                          >
                            {item.name_en || item.name}
                          </div>
                          <div className="text-xs text-neutral-400 font-medium line-clamp-1">
                            {item.name_gu} • {item.name_hi}
                          </div>
                          <p className="text-xs text-neutral-500 line-clamp-2 pt-1">
                            {item.description_en || 'Authentic regional recipe prepared fresh.'}
                          </p>
                        </div>
                      </div>

                      <div className="p-4 pt-0 flex items-center justify-between border-t border-neutral-100 mt-2">
                        <div className="font-black text-base text-neutral-900">
                          ₹{item.price}
                        </div>

                        {item.is_available && (item.available_qty ?? 1) > 0 ? (
                          qty > 0 ? (
                            <div className="flex items-center gap-2 bg-[#e53935] text-white rounded-xl px-2 py-1 shadow-xs">
                              <button
                                onClick={() => addToCart(item, -1)}
                                className="p-1 hover:bg-black/10 rounded-lg cursor-pointer"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="font-bold text-xs">{qty}</span>
                              <button
                                onClick={() => addToCart(item, 1)}
                                className="p-1 hover:bg-black/10 rounded-lg cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => addToCart(item, 1)}
                              className="px-3.5 py-1.5 rounded-xl bg-neutral-900 hover:bg-[#e53935] text-white font-bold text-xs transition cursor-pointer shadow-xs"
                            >
                              Add +
                            </button>
                          )
                        ) : (
                          <span className="text-[11px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-lg">
                            Sold Out
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: MY ORDERS VIEW */}
        {activeTab === 'orders' && (
          <MyOrdersView
            onBackToMenu={() => setActiveTab('menu')}
            onReorder={(order) => {
              (order.items || []).forEach((it) => {
                const menuItem = items.find(m => String(m.id) === String(it.id));
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
              setActiveTab('menu');
            }}
          />
        )}
      </main>

      {/* Corrected Footer */}
      <footer className="bg-neutral-900 text-neutral-300 pt-12 pb-8 border-t border-neutral-800 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Brand & Correct Location */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <BrandLogo size="xs" />
              <span className="text-lg font-black text-white">Hotel Darshan</span>
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-900/60 text-emerald-400 border border-emerald-700/50 rounded">
                100% Pure Veg
              </span>
            </div>
            <div className="flex items-start gap-2 text-xs text-neutral-400">
              <MapPin className="w-4 h-4 text-[#e53935] shrink-0 mt-0.5" />
              <p>Char Rasta, Mosda Road, Dediapada, Gujarat - 393040</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <PhoneCall className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Helpline: +91 9054862428</span>
            </div>
          </div>

          {/* FSSAI Registration */}
          <div className="space-y-2">
            <h4 className="text-white font-bold text-sm">Regulatory Licensing</h4>
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
              <span>FSSAI Lic. No: 10726041000022</span>
            </div>
            <p className="[11px] text-neutral-500">
              Registered pure vegetarian dining entity serving Dediapada and surrounding regions.
            </p>
          </div>

          {/* Navigation Links */}
          <div className="space-y-2">
            <h4 className="text-white font-bold text-sm">Quick Links</h4>
            <div className="flex flex-col text-xs space-y-1.5">
              <button
                onClick={() => setActiveTab('menu')}
                className="text-left text-neutral-400 hover:text-white transition cursor-pointer"
              >
                Explore Menu
              </button>
              <button
                onClick={() => setActiveTab('orders')}
                className="text-left text-neutral-400 hover:text-white transition cursor-pointer"
              >
                My Orders
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-8 pt-4 border-t border-neutral-800 text-center text-xs text-neutral-500">
          © Hotel Darshan • Owned by Vasava Rameshbhai. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
