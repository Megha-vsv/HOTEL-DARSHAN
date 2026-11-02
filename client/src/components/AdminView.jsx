import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hotelDarshanCategories } from '../data/categories';
import { foodImagesByName, resolveFoodImage } from '../data/foodImages';
import { parseDeliverySlabs, parseMaxDeliveryKm, DEFAULT_DELIVERY_SLABS, DEFAULT_MAX_DELIVERY_KM } from '../data/deliveryPricing';
import { useLanguage } from '../context/LanguageContext';
import { sanitizePhoneInput } from '../lib/phoneInput';
import {
  parseServerTimestamp,
  formatDate,
  formatDateTime,
  formatClockTime,
  formatDayDate,
  minutesBetween,
  timeAgo,
  istDayStartMs,
  istDaysAgoMs,
  istMonthStartMs,
} from '../lib/time.js';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { apiBase as API_BASE } from '../lib/apiBase';
import { useTheme, ADMIN_THEME_ATTRIBUTE } from '../context/ThemeContext';
import KitchenView from './KitchenView';
import AdminRiderFleet from './admin/AdminRiderFleet';
import FoodImage from './FoodImage';
import BrandLogo from './BrandLogo';
import {
  BarChart3,
  ShoppingBag,
  Utensils,
  Tag,
  Users,
  Star,
  Download,
  Settings as SettingsIcon,
  Plus,
   Edit2,
   Eye,
   Trash2,
  CheckCircle2,
  XCircle,
  TrendingUp,
  RefreshCw,
  DollarSign,
  UserCog,
  Search,
  Image as ImageIcon,
  FileText,
  Layers,
  X,
  AlertTriangle,
  Bell,
  Clock,
  Calendar,
  MapPin,
  Phone,
  ExternalLink,
  Filter,
  ChevronLeft,
  ChevronDown,
  Menu,
  LogOut,
  CreditCard,
  Package,
  Truck,
  Bike,
  Timer,
  Users as UsersIcon,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  MinusCircle,
  Palette
} from 'lucide-react';

// SVG-based chart components using existing analytics data
function RevenueChart({ data }) {
  if (!data?.length) return <div className="h-36 sm:h-40 xl:h-44 flex items-center justify-center rounded-xl bg-neutral-50 text-neutral-400 text-xs">No data available</div>;

  const maxRevenue = Math.max(...data.map(d => Number(d.daily_revenue)));
  if (!maxRevenue) return <div className="h-36 sm:h-40 xl:h-44 flex items-center justify-center rounded-xl bg-neutral-50 text-neutral-400 text-xs">No revenue data</div>;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1 || 1)) * 100;
    const y = 100 - (Number(d.daily_revenue) / (maxRevenue || 1)) * 85;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="relative h-36 sm:h-40 xl:h-44">
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" preserveAspectRatio="none" role="img" aria-label="Revenue trend">
        <path d="M0 25H100M0 50H100M0 75H100" stroke="#f5f5f4" strokeWidth="0.6" />
        <path d="M0 100H100" stroke="#e7e5e4" strokeWidth="0.8" />
        <defs>
          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`M${points} L100,100 L0,100 Z`}
          fill="url(#revenueGradient)"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#22c55e"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {data.map((d, i) => (
          <circle
            key={i}
            cx={(i / (data.length - 1 || 1)) * 100}
            cy={100 - (Number(d.daily_revenue) / (maxRevenue || 1)) * 85}
            r="2.5"
            fill="#fff"
            stroke="#22c55e"
            strokeWidth="2"
          />
        ))}
      </svg>
    </div>
  );
}

function OrdersChart({ data }) {
  if (!data?.length) return <div className="h-36 sm:h-40 xl:h-44 flex items-center justify-center rounded-xl bg-neutral-50 text-neutral-400 text-xs">No data available</div>;

  const maxOrders = Math.max(...data.map(d => Number(d.order_count)));
  if (!maxOrders) return <div className="h-36 sm:h-40 xl:h-44 flex items-center justify-center rounded-xl bg-neutral-50 text-neutral-400 text-xs">No orders data</div>;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1 || 1)) * 100;
    const y = 100 - (Number(d.order_count) / (maxOrders || 1)) * 85;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="relative h-36 sm:h-40 xl:h-44">
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" preserveAspectRatio="none" role="img" aria-label="Orders trend">
        <path d="M0 25H100M0 50H100M0 75H100" stroke="#f5f5f4" strokeWidth="0.6" />
        <path d="M0 100H100" stroke="#e7e5e4" strokeWidth="0.8" />
        <defs>
          <linearGradient id="ordersGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`M${points} L100,100 L0,100 Z`}
          fill="url(#ordersGradient)"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {data.map((d, i) => (
          <circle
            key={i}
            cx={(i / (data.length - 1 || 1)) * 100}
            cy={100 - (Number(d.order_count) / (maxOrders || 1)) * 85}
            r="2.5"
            fill="#fff"
            stroke="#3b82f6"
            strokeWidth="2"
          />
        ))}
      </svg>
    </div>
  );
}

function HourlyChart({ data }) {
  if (!data?.length) return <div className="h-36 sm:h-40 xl:h-44 flex items-center justify-center text-neutral-400 text-xs">No hourly data</div>;
  
  const maxCount = Math.max(...data.map(d => Number(d.count)));
  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
  const barWidth = 100 / 24 * 0.6;
  const gap = 100 / 24 * 0.4;

  return (
    <div className="h-36 sm:h-40 xl:h-44 flex items-end justify-around px-2 gap-0.5">
      {hours.map((hour, i) => {
        const hourData = data.find(d => d.hour === hour);
        const count = hourData ? Number(hourData.count) : 0;
        const height = maxCount > 0 ? (count / maxCount) * 80 : 0;
        return (
          <div key={hour} className="flex flex-col items-center" style={{ width: `${100/24}%` }}>
            <div
              className="rounded-t bg-[#e53935] transition-all hover:bg-[#d32f2f]"
              style={{ width: '100%', height: `${height}%`, minHeight: count > 0 ? '3px' : '0' }}
              title={`${hour}:00 - ${count} orders`}
            />
            <span className="text-[8px] text-neutral-400 mt-0.5">{hour}:00</span>
          </div>
        );
      })}
    </div>
  );
}

function StatusChart({ data }) {
  if (!data?.length) return <div className="h-36 sm:h-40 xl:h-44 flex items-center justify-center text-neutral-400 text-xs">No status data</div>;
  
  const total = data.reduce((sum, d) => sum + Number(d.count), 0);
  const statusColors = {
    'ORDER_PLACED': '#3b82f6',
    'ORDER_CONFIRMED': '#06b6d4',
    'PREPARING': '#f59e0b',
    'READY': '#84cc16',
    'READY_FOR_PICKUP': '#84cc16',
    'OUT_FOR_DELIVERY': '#f97316',
    'DELIVERED': '#22c55e',
    'COMPLETED': '#22c55e',
    'PICKED_UP': '#22c55e',
    'CANCELLED': '#ef4444',
  };
  const statusLabels = {
    'ORDER_PLACED': 'Placed',
    'ORDER_CONFIRMED': 'Confirmed',
    'PREPARING': 'Preparing',
    'READY': 'Ready',
    'READY_FOR_PICKUP': 'Ready Pickup',
    'OUT_FOR_DELIVERY': 'Out Delivery',
    'DELIVERED': 'Delivered',
    'COMPLETED': 'Completed',
    'PICKED_UP': 'Picked Up',
    'CANCELLED': 'Cancelled',
  };

  return (
    <div className="space-y-2.5">
      {data.slice(0, 8).map((d) => (
        <div key={d.status} className="flex items-center gap-2">
          <div className="w-20 text-[10px] font-medium text-neutral-600 truncate">
            {statusLabels[d.status] || d.status.replace(/_/g, ' ')}
          </div>
          <div className="flex-1 h-2.5 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(Number(d.count) / total) * 100}%`,
                backgroundColor: statusColors[d.status] || '#94a3b8'
              }}
            />
          </div>
          <span className="text-xs font-bold text-neutral-900 tabular-nums w-10 text-right">
            {Number(d.count)}
          </span>
        </div>
      ))}
    </div>
  );
}

function PopularItemsChart({ data }) {
  if (!data?.length) return <div className="h-36 sm:h-40 xl:h-44 flex items-center justify-center text-neutral-400 text-xs">No popular items</div>;
  
  const maxCount = Math.max(...data.map(d => Number(d.count)));
  
  return (
    <div className="space-y-2.5">
      {data.slice(0, 5).map((item, idx) => (
        <div key={item.name} className="flex items-center gap-2">
          <span className="w-5 text-center text-[10px] font-bold text-neutral-400">{idx + 1}</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-neutral-900 truncate">{item.name}</p>
            <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden mt-1">
              <div
                className="h-full bg-[#e53935] rounded-full"
                style={{ width: `${(Number(item.count) / maxCount) * 100}%` }}
              />
            </div>
          </div>
          <div className="text-right w-20">
            <p className="text-xs font-bold text-neutral-900">{Number(item.count)}</p>
            <p className="text-[10px] text-neutral-500">₹{Number(item.revenue).toLocaleString('en-IN')}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function DeliveryPickupChart({ orders }) {
  const delivery = orders.filter(o => o.order_type === 'delivery').length;
  const pickup = orders.filter(o => o.order_type === 'pickup').length;
  const total = delivery + pickup;
  
  if (!total) return <div className="h-36 sm:h-40 xl:h-44 flex items-center justify-center text-neutral-400 text-xs">No order type data</div>;
  
  const deliveryPct = (delivery / total) * 100;
  const pickupPct = (pickup / total) * 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-5">
        <div className="text-center">
          <div className="text-xl font-black text-[#e53935]">{deliveryPct.toFixed(1)}%</div>
          <div className="text-[11px] text-neutral-500">Delivery</div>
        </div>
        <div className="w-28 h-28 relative">
          <svg viewBox="0 0 100 100">
            <circle
              cx="50" cy="50" r="40"
              stroke="#e5e7eb" strokeWidth="8" fill="none"
            />
            <circle
              cx="50" cy="50" r="40"
              stroke="#e53935" strokeWidth="8" fill="none"
              strokeDasharray={`${deliveryPct * 2.51} 251`}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
            />
          </svg>
        </div>
        <div className="text-center">
          <div className="text-xl font-black text-blue-600">{pickupPct.toFixed(1)}%</div>
          <div className="text-[11px] text-neutral-500">Pickup</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="p-2.5 rounded-xl bg-red-50">
          <p className="text-base font-black text-red-600">{delivery}</p>
          <p className="text-[11px] text-neutral-500">Delivery orders</p>
        </div>
        <div className="p-2.5 rounded-xl bg-blue-50">
          <p className="text-base font-black text-blue-600">{pickup}</p>
          <p className="text-[11px] text-neutral-500">Pickup orders</p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const statusConfig = {
    'ORDER_PLACED': { label: 'Placed', bg: 'bg-blue-50', text: 'text-blue-700' },
    'ORDER_CONFIRMED': { label: 'Confirmed', bg: 'bg-cyan-50', text: 'text-cyan-700' },
    'PREPARING': { label: 'Preparing', bg: 'bg-amber-50', text: 'text-amber-700' },
    'READY': { label: 'Ready', bg: 'bg-lime-50', text: 'text-lime-700' },
    'READY_FOR_PICKUP': { label: 'Ready for Pickup', bg: 'bg-lime-50', text: 'text-lime-700' },
    'OUT_FOR_DELIVERY': { label: 'Out for Delivery', bg: 'bg-orange-50', text: 'text-orange-700' },
    'DELIVERED': { label: 'Delivered', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    'COMPLETED': { label: 'Completed', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    'PICKED_UP': { label: 'Picked Up', bg: 'bg-emerald-50', text: 'text-emerald-700' },
    'CANCELLED': { label: 'Cancelled', bg: 'bg-red-50', text: 'text-red-700' },
  };
  
  const config = statusConfig[status] || { label: status?.replace(/_/g, ' ') || 'Unknown', bg: 'bg-neutral-100', text: 'text-neutral-700' };
  
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

/**
 * The admin sections that have an address of their own, as /staff/admin/<id>.
 *
 * These are exactly the ids in `navItems` that render a section of the dashboard
 * rather than opening a different portal. 'rider' is deliberately absent: it
 * leaves for /staff/rider rather than being a section here, so treating it as one
 * would let a link to the rider portal resolve back into the admin dashboard.
 */
const ADMIN_SECTIONS = new Set([
  'dashboard', 'orders', 'kitchen', 'fleet', 'menu', 'coupons', 'customers', 'staff', 'reviews', 'reports', 'settings',
]);

export default function AdminView({ onNavigate, canOpen = () => true }) {
  const { language } = useLanguage();
  const { socket, addNotification } = useSocket();
  const { token, user, logout, updateUserProfile } = useAuth();
  // Admin appearance preference: light / dark / system, persisted per device.
  const { theme: adminTheme, resolvedTheme: adminResolvedTheme, setTheme: setAdminTheme } = useTheme() || {};

  const routerLocation = useLocation();
  const routerNavigate = useNavigate();

  // Which section is showing is the address, not component state.
  //
  // It was `useState('dashboard')`, and that is why every admin page had the same
  // URL (/staff/admin) and why refreshing Staff Management dropped the owner back
  // on Analytics: the state came back at its initial value, and nothing in the
  // address could say otherwise. Someone halfway through managing staff had to
  // find their way back by clicking again, and could not send a colleague a link
  // to the page they were looking at.
  //
  // The dashboard keeps the bare /staff/admin address, so the common case and any
  // link that already exists behave exactly as they did.
  const urlSection = routerLocation.pathname.split('/')[3];
  const activeTab = ADMIN_SECTIONS.has(urlSection) ? urlSection : 'dashboard';

  /**
   * Kept as a function rather than a state setter so every existing call site
   * keeps working: `setActiveTab('orders')` now means "go to /staff/admin/orders".
   * An unrecognised name lands on the dashboard instead of rendering a blank page,
   * which is what a stale link to a removed section should do.
   */
  const setActiveTab = (tab) => {
    const next = ADMIN_SECTIONS.has(tab) ? tab : 'dashboard';
    routerNavigate(next === 'dashboard' ? '/staff/admin' : `/staff/admin/${next}`);
  };

  const [menuSubTab, setMenuSubTab] = useState('items');
  const [dateFilter, setDateFilter] = useState('today');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [appearanceModalOpen, setAppearanceModalOpen] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('hotelDarshanAdminReadNotifications') || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  });
  const headerRef = useRef(null);

  // Order-specific filter + search + details modal
  const [orderFilter, setOrderFilter] = useState('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [viewingOrder, setViewingOrder] = useState(null);

  // Reviews filter + search + details modal
  const [reviews, setReviews] = useState([]);
  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewRatingFilter, setReviewRatingFilter] = useState('all');
  const [reviewDateFilter, setReviewDateFilter] = useState('all');
  const [viewingReview, setViewingReview] = useState(null);

  // Data states
  const [analytics, setAnalytics] = useState(null);
  const [orders, setOrders] = useState([]);
  // Totals straight from the database, so the sidebar badge is the real count
  // rather than however many rows happen to be loaded.
  const [orderStats, setOrderStats] = useState({ total: 0, byStatus: {} });
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [staff, setStaff] = useState([]);
  // Ids ticked in the staff table, for the bulk bar. Ids rather than a boolean per
  // row, so that a staff list refetched underneath cannot leave a row looking
  // selected when it is not: anything no longer in `staff` is simply not in here.
  const [selectedStaffIds, setSelectedStaffIds] = useState([]);
  const [bulkRole, setBulkRole] = useState('');
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [savingStaff, setSavingStaff] = useState(false);
  // A refusal from the server, shown inside the form rather than only as a
  // toast that disappears after five seconds.
  const [staffSaveError, setStaffSaveError] = useState('');
  const [reportPeriod, setReportPeriod] = useState('all');
  const [reportType, setReportType] = useState('revenue');
  const [reportFormat, setReportFormat] = useState('xlsx');
  const [reportLoading, setReportLoading] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagData, setDiagData] = useState(null);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isCouponModalOpen, setIsCouponModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingCoupon, setEditingCoupon] = useState(null);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const handleSaveSettings = async (updates) => {
    setSettingsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(updates)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to save settings');
      setSettings(data.settings || {});
      addNotification('Settings Saved', 'Hotel configuration updated successfully.', 'success');
    } catch (e) {
      addNotification('Settings Error', e.message || 'Unable to save settings.', 'error');
    } finally {
      setSettingsSaving(false);
    }
  };

  // Distance-based delivery pricing, edited as its own list because the slab
  // boundaries are what the customer is actually charged on.
  const [deliverySlabsInput, setDeliverySlabsInput] = useState(() =>
    parseDeliverySlabs(DEFAULT_DELIVERY_SLABS).map((s) => ({ ...s }))
  );
  const [maxDeliveryKmInput, setMaxDeliveryKmInput] = useState(String(DEFAULT_MAX_DELIVERY_KM));

  // Adopt whatever is already saved whenever settings finish loading.
  useEffect(() => {
    if (settings.delivery_slabs) {
      setDeliverySlabsInput(parseDeliverySlabs(settings.delivery_slabs).map((s) => ({ ...s })));
    }
    if (settings.max_delivery_km) {
      setMaxDeliveryKmInput(String(parseMaxDeliveryKm(settings.max_delivery_km)));
    }
  }, [settings.delivery_slabs, settings.max_delivery_km]);

  const updateDeliverySlab = (index, key, value) => {
    setDeliverySlabsInput((prev) => prev.map((slab, i) => (i === index ? { ...slab, [key]: value } : slab)));
  };

  const removeDeliverySlab = (index) => {
    setDeliverySlabsInput((prev) => prev.filter((_, i) => i !== index));
  };

  const addDeliverySlab = () => {
    setDeliverySlabsInput((prev) => {
      const last = prev[prev.length - 1];
      const start = Number(last?.maxKm) || 0;
      return [...prev, { maxKm: Number((start + 2).toFixed(1)), fee: 60 }];
    });
  };

  const saveDeliverySettings = () => {
    // Normalise before saving so the stored table is always ascending and valid.
    const slabs = parseDeliverySlabs(
      deliverySlabsInput.map((slab) => ({ maxKm: Number(slab.maxKm), fee: Number(slab.fee) }))
    );
    setDeliverySlabsInput(slabs.map((s) => ({ ...s })));

    return handleSaveSettings({
      ...settings,
      delivery_slabs: slabs,
      max_delivery_km: parseMaxDeliveryKm(maxDeliveryKmInput)
    });
  };

  // Computed dashboard stats from existing data
  const dashboardStats = useMemo(() => {
    const totalRevenue = orders.reduce((sum, o) => sum + (o.grand_total || o.total || 0), 0);
    const totalOrders = orders.length;
    const totalCustomers = customers.length;

    const pendingOrders = orders.filter(o =>
      ['ORDER_PLACED', 'ORDER_CONFIRMED'].includes(o.status)
    ).length;

    const activeOrders = orders.filter(o =>
      ['PREPARING', 'READY', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'].includes(o.status)
    ).length;

    const completedOrders = orders.filter(o => o.status === 'DELIVERED' || o.status === 'COMPLETED').length;
    const cancelledOrders = orders.filter(o => o.status === 'CANCELLED').length;

    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Average delivery time from completed orders with timestamps.
    // Both sides are parsed the same way, so even a partial parse cancels out
    // rather than one half being 5h30m out. `created_at` and `updated_at` are
    // both UTC strings from SQLite, so `minutesBetween` is the right tool: a
    // difference between two instants is the same number in every timezone.
    const deliveredOrders = orders.filter(o =>
      (o.status === 'DELIVERED' || o.status === 'COMPLETED') && o.created_at && o.updated_at
    );
    const deliveryDurations = deliveredOrders
      .map(o => minutesBetween(o.created_at, o.updated_at))
      .filter(m => m !== null && m >= 0);
    const avgDeliveryMinutes = deliveryDurations.length > 0
      ? Math.round(deliveryDurations.reduce((sum, m) => sum + m, 0) / deliveryDurations.length)
      : 0;

    // Real week-over-week trend computed from the weekly_sales analytics array.
    // Uses the last two days of recorded data (today vs yesterday) so the
    // badges reflect actual project data, never fabricated numbers.
    const weekly = analytics?.weekly_sales || [];
    const todayRow = weekly[weekly.length - 1];
    const yesterdayRow = weekly[weekly.length - 2];

    const trendFor = (current, previous) => {
      if (previous == null || previous === 0) return null;
      const pct = ((current - previous) / previous) * 100;
      if (!isFinite(pct)) return null;
      return { pct: Math.round(pct * 10) / 10, up: pct >= 0 };
    };

    const revenueTrend = trendFor(
      todayRow ? Number(todayRow.daily_revenue) : 0,
      yesterdayRow ? Number(yesterdayRow.daily_revenue) : 0
    );
    const ordersTrend = trendFor(
      todayRow ? Number(todayRow.order_count) : 0,
      yesterdayRow ? Number(yesterdayRow.order_count) : 0
    );

    return {
      totalRevenue,
      totalOrders,
      totalCustomers,
      pendingOrders,
      activeOrders,
      completedOrders,
      cancelledOrders,
      avgOrderValue,
      avgDeliveryMinutes,
      todayRevenue: analytics?.today_sales || 0,
      todayOrders: analytics?.today_orders || 0,
      revenueTrend,
      ordersTrend,
    };
  }, [orders, customers, analytics]);

  // Filtered recent orders for the dashboard table, driven by the global search box.
    const filteredRecentOrders = useMemo(() => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return orders.slice(0, 10);
      return orders
        .filter((o) => {
          const orderNo = String(o.order_number || o.id || '').toLowerCase();
          const customer = String(o.customer_name || '').toLowerCase();
          const phone = String(o.customer_phone || '').toLowerCase();
          const items = (o.items || []).map((it) => String(it.name_en || it.name || '').toLowerCase()).join(' ');
          const status = String(o.status || '').toLowerCase();
          return orderNo.includes(q) || customer.includes(q) || phone.includes(q) || items.includes(q) || status.includes(q);
        })
        .slice(0, 10);
    }, [orders, searchQuery]);

  // Filtered orders for the Orders tab, driven by status filter + order-specific search.
  const filteredOrders = useMemo(() => {
    // Order numbers are shown as `#HD-...` but stored without the `#`, and staff
    // type them in any case. Normalising the term makes every form match the
    // same order instead of quietly returning nothing.
    const q = orderSearch.trim().replace(/^#+/, '').toLowerCase();
    return orders.filter((o) => {
      // Status filter
      if (orderFilter !== 'all') {
        if (orderFilter === 'delivery' && o.order_type !== 'delivery') return false;
        if (orderFilter === 'pickup' && o.order_type !== 'pickup') return false;
        if (
          ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'].includes(orderFilter)
        ) {
          const statusKey = o.status || '';
          const matches =
            (orderFilter === 'new' && (statusKey === 'ORDER_PLACED' || statusKey === 'ORDER_CONFIRMED')) ||
            (orderFilter === 'confirmed' && statusKey === 'ORDER_CONFIRMED') ||
            (orderFilter === 'preparing' && statusKey === 'PREPARING') ||
            (orderFilter === 'ready' && (statusKey === 'READY' || statusKey === 'READY_FOR_PICKUP')) ||
            (orderFilter === 'out_for_delivery' && statusKey === 'OUT_FOR_DELIVERY') ||
            (orderFilter === 'delivered' && (statusKey === 'DELIVERED' || statusKey === 'COMPLETED')) ||
            (orderFilter === 'cancelled' && statusKey === 'CANCELLED');
          if (!matches) return false;
        }
      }
      // Order-specific search
      if (q) {
        const orderNo = String(o.order_number || o.id || '').toLowerCase();
        const customer = String(o.customer_name || '').toLowerCase();
        const phone = String(o.customer_phone || '').toLowerCase();
        const items = (o.items || []).map((it) => String(it.name_en || it.name || '').toLowerCase()).join(' ');
        if (!orderNo.includes(q) && !customer.includes(q) && !phone.includes(q) && !items.includes(q)) return false;
      }
      return true;
    });
  }, [orders, orderFilter, orderSearch]);

  // Filtered reviews driven by search + rating filter + date filter.
  const filteredReviews = useMemo(() => {
    const q = reviewSearch.trim().replace(/^#+/, '').toLowerCase();

    // "Today", "this week" and "this month" are the restaurant's days, not the
    // admin's. These were `new Date(y, m, d)` boundaries - local midnight -
    // compared against UTC timestamps, which put the first 5h30m of every
    // service in the wrong bucket and moved the day boundary for any admin not
    // on IST.
    const todayStart = istDayStartMs(Date.now());
    const weekStart = istDaysAgoMs(Date.now(), 7);
    const monthStart = istMonthStartMs(Date.now());

    return reviews.filter((r) => {
      // Rating filter
      if (reviewRatingFilter !== 'all') {
        const rating = Number(r.rating || 0);
        if (reviewRatingFilter === '5' && rating < 5) return false;
        if (reviewRatingFilter === '4' && (rating < 4 || rating >= 5)) return false;
        if (reviewRatingFilter === '3' && (rating < 3 || rating >= 4)) return false;
        if (reviewRatingFilter === '2' && (rating < 2 || rating >= 3)) return false;
        if (reviewRatingFilter === '1' && (rating < 1 || rating >= 2)) return false;
      }
      // Date filter
      if (reviewDateFilter !== 'all' && r.created_at) {
        const t = parseServerTimestamp(r.created_at);
        if (t === null) return true;
        if (reviewDateFilter === 'today' && todayStart !== null && t < todayStart) return false;
        if (reviewDateFilter === 'week' && weekStart !== null && t < weekStart) return false;
        if (reviewDateFilter === 'month' && monthStart !== null && t < monthStart) return false;
      }
      // Search
      if (q) {
        const customer = String(r.customer_name || '').toLowerCase();
        const comment = String(r.comment || '').toLowerCase();
        const orderNo = String(r.order_number || r.order_id || '').toLowerCase();
        if (!customer.includes(q) && !comment.includes(q) && !orderNo.includes(q)) return false;
      }
      return true;
    });
  }, [reviews, reviewSearch, reviewRatingFilter, reviewDateFilter]);

  // Modals state
  const [editingItem, setEditingItem] = useState(null);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);

  const fetchAnalytics = async (range = dateFilter) => {
    try {
      const res = await fetch(`${API_BASE}/analytics` + (range ? `?range=${range}` : ''), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setAnalytics(await res.json());
    } catch (e) {}
  };

  const fetchOrderStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/orders/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setOrderStats(await res.json());
    } catch (e) {}
  };

  const fetchOrders = async () => {
    try {
      // Every order is loaded, not just the newest page: the list is filtered
      // here, so a page cap would quietly make older orders unfindable and show
      // the page size as a total. The real totals come from /stats.
      const [res, statsRes] = await Promise.all([
        fetch(`${API_BASE}/orders?limit=5000`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/orders/stats`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (res.ok) setOrders(await res.json());
      if (statsRes.ok) setOrderStats(await statsRes.json());
    } catch (e) {}
  };

  const fetchMenu = async () => {
    try {
      const [catRes, itemRes] = await Promise.all([
        fetch(`${API_BASE}/menu/categories`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/menu/items`)
      ]);
      if (catRes.ok) setCategories(await catRes.json());
      if (itemRes.ok) setItems(await itemRes.json());
    } catch (e) {}
  };

  const fetchCoupons = async () => {
    try {
      const res = await fetch(`${API_BASE}/coupons/all`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setCoupons(await res.json());
    } catch (e) {}
  };

  const fetchCustomersAndReviews = async () => {
    try {
      const [custRes, revRes] = await Promise.all([
        fetch(`${API_BASE}/customers`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_BASE}/customers/reviews`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (custRes.ok) setCustomers(await custRes.json());
      if (revRes.ok) setReviews(await revRes.json());
    } catch (e) {}
  };

  const fetchStaff = async () => {
    try {
      const res = await fetch(`${API_BASE}/staff`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setStaff(await res.json());
      else {
        const err = await res.json().catch(() => ({}));
        addNotification('Staff Error', err.error || 'Failed to load staff', 'error');
      }
    } catch (e) {
      addNotification('Staff Error', e.message || 'Failed to load staff', 'error');
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (res.ok) setSettings(await res.json());
    } catch (e) {}
  };

  useEffect(() => {
    fetchAnalytics();
    fetchOrders();
    fetchMenu();
    fetchCoupons();
    fetchCustomersAndReviews();
    fetchStaff();
    fetchSettings();
  }, [token]);

  // Fallback for a missed socket event: re-read reviews whenever the Reviews tab
  // is opened, so the list is never stale on screen.
  useEffect(() => {
    if (activeTab === 'reviews' && token) fetchCustomersAndReviews();
  }, [activeTab, token]);

  // Real-time socket listeners
  useEffect(() => {
    if (!socket) return;

    // The admin room is re-joined on every connection, not once on mount. Room
    // membership lives on the socket, so a reconnect starts in no rooms and a
    // board that only asked once goes deaf to rider availability, assignments and
    // every new order after a single network blip. The server also derives this
    // room from the role now; doing it here as well means the client is explicit
    // about what it is listening to, and correct on its own.
    const joinAdmin = () => socket.emit('join_admin');
    joinAdmin();
    socket.on('connect', joinAdmin);

    // Upsert by id, so an order that arrives by socket and is also picked up by
    // the refresh below updates in place instead of appearing twice.
    const upsertOrder = (incoming) =>
      setOrders((prev) => [incoming, ...prev.filter((o) => o.id !== incoming.id)]);

    const handleNewOrder = (newOrder) => {
      upsertOrder(newOrder);
      fetchOrderStats();
      fetchAnalytics();
    };

    const handleStatusUpdate = (updatedOrder) => {
      setOrders((prev) =>
        prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o))
      );
      fetchOrderStats();
      fetchAnalytics();
    };

    const handleAvailabilityChange = (changedItem) => {
      setItems((prev) =>
        prev.map((it) => (it.id === changedItem.id ? { ...it, ...changedItem } : it))
      );
    };

    // A newly saved customer review is re-read from the database rather than
    // spliced in, so Admin Reviews shows exactly what was persisted.
    const handleReviewCreated = () => {
      fetchCustomersAndReviews();
    };

    socket.on('order:created', handleNewOrder);
    socket.on('order:status_updated', handleStatusUpdate);
    socket.on('menu:availability_changed', handleAvailabilityChange);
    socket.on('review:created', handleReviewCreated);

    return () => {
      socket.off('connect', joinAdmin);
      socket.off('order:created', handleNewOrder);
      socket.off('order:status_updated', handleStatusUpdate);
      socket.off('menu:availability_changed', handleAvailabilityChange);
      socket.off('review:created', handleReviewCreated);
    };
  }, [socket]);

  // Safety net for a missed or dropped socket event: re-read the orders from the
  // database periodically so the admin list is never quietly stale. The upsert
  // above is keyed on id, so this cannot duplicate an order.
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      fetchOrders();
    }, 30000);
    return () => clearInterval(timer);
  }, [token]);

  // 1-Tap Toggle Availability
  const handleToggleAvailability = async (item) => {
    const newStatus = item.is_available ? 0 : 1;
    try {
      const res = await fetch(`${API_BASE}/menu/items/${item.id}/availability`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ is_available: newStatus })
      });
      if (res.ok) {
        setItems((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, is_available: newStatus } : it))
        );
        addNotification('Menu Updated', `${item.name_en} is now ${newStatus ? 'AVAILABLE' : 'UNAVAILABLE'}`, 'info');
      }
    } catch (e) {}
  };

  // Update Stock Qty
  const handleUpdateStock = async (itemId, newQty) => {
    try {
      const res = await fetch(`${API_BASE}/menu/items/${itemId}/stock`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ available_qty: newQty })
      });
      if (res.ok) {
        const data = await res.json();
        setItems((prev) =>
          prev.map((it) =>
            it.id === itemId ? { ...it, available_qty: data.available_qty, is_available: data.is_available } : it
          )
        );
      }
    } catch (e) {}
  };

  // Update Order Status
  const handleOrderStatusChange = async (orderId, status) => {
    try {
      const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });
      const updated = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(updated.error || 'Unable to update order status.');
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      addNotification('Order Updated', `Order #${updated.order_number || updated.id} is now ${status}.`, 'success');
    } catch (error) {
      addNotification('Order Update Failed', error.message || 'Unable to update order status.', 'error');
    }
  };

  const handleSaveItem = async (form) => {
    try {
      const isEdit = Boolean(editingItem?.id);
      const res = await fetch(isEdit ? `${API_BASE}/menu/items/${editingItem.id}` : `${API_BASE}/menu/items`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to save food item');
      if (isEdit) setItems(prev => prev.map(item => item.id === data.id ? data : item));
      else setItems(prev => [data, ...prev]);
      await fetchMenu();
      setEditingItem(null);
      setIsItemModalOpen(false);
      addNotification('Menu Updated', `${data.name_en} has been ${isEdit ? 'updated' : 'added'}.`, 'success');
    } catch (e) {
      addNotification('Menu Error', e.message || 'Unable to save food item.', 'error');
    }
  };

  const handleDeleteItem = async (item) => {
    if (!window.confirm(`Remove ${item.name_en} from the menu?`)) return;
    try {
      const res = await fetch(`${API_BASE}/menu/items/${item.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to remove item');
      setItems(prev => prev.filter(i => i.id !== item.id));
      addNotification('Menu Updated', `${item.name_en} removed from menu.`, 'success');
    } catch (e) {
      addNotification('Menu Error', e.message || 'Unable to remove item.', 'error');
    }
  };

  const handleSaveCategory = async (form) => {
    try {
      const isEdit = Boolean(editingCategory?.id);
      const res = await fetch(isEdit ? `${API_BASE}/menu/categories/${editingCategory.id}` : `${API_BASE}/menu/categories`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to save category');
      if (isEdit) setCategories(prev => prev.map(c => c.id === data.id ? { ...c, ...data } : c));
      else setCategories(prev => [...prev, data]);
      setEditingCategory(null);
      setIsCategoryModalOpen(false);
      await fetchMenu();
      addNotification('Category Saved', `${data.name_en} has been ${isEdit ? 'updated' : 'added'}.`, 'success');
    } catch (e) {
      addNotification('Category Error', e.message || 'Unable to save category.', 'error');
    }
  };

  const handleDeleteCategory = async (category) => {
    if (!window.confirm(`Delete category "${category.name_en}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/menu/categories/${category.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to delete category');
      setCategories(prev => prev.filter(c => c.id !== category.id));
      await fetchMenu();
      addNotification('Category Deleted', `${category.name_en} deleted.`, 'success');
    } catch (e) {
      addNotification('Category Error', e.message || 'Unable to delete category.', 'error');
    }
  };

  const handleSaveCoupon = async (form) => {
    try {
      const isEdit = Boolean(editingCoupon?.id);
      const res = await fetch(isEdit ? `${API_BASE}/coupons/${editingCoupon.id}` : `${API_BASE}/coupons`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to save offer');
      if (isEdit) setCoupons(prev => prev.map(c => c.id === data.id ? data : c));
      else setCoupons(prev => [data, ...prev]);
      setEditingCoupon(null);
      setIsCouponModalOpen(false);
      addNotification('Offer Saved', `${data.code} has been ${isEdit ? 'updated' : 'created'}.`, 'success');
    } catch (e) {
      addNotification('Offer Error', e.message || 'Unable to save offer.', 'error');
    }
  };

  const handleDeleteCoupon = async (coupon) => {
    if (!window.confirm(`Delete offer ${coupon.code}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/coupons/${coupon.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to delete offer');
      setCoupons(prev => prev.filter(c => c.id !== coupon.id));
      addNotification('Offer Deleted', `${coupon.code} deleted.`, 'success');
    } catch (e) {
      addNotification('Offer Error', e.message || 'Unable to delete offer.', 'error');
    }
  };

  const handleToggleCouponActive = async (coupon) => {
    const newStatus = coupon.is_active ? 0 : 1;
    try {
      const res = await fetch(`${API_BASE}/coupons/${coupon.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...coupon, is_active: newStatus })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to update offer');
      setCoupons(prev => prev.map(c => c.id === coupon.id ? data : c));
      addNotification(
        'Offer Updated',
        `${coupon.code} is now ${newStatus ? 'active' : 'disabled'}.`,
        'success'
      );
    } catch (e) {
      addNotification('Offer Error', e.message || 'Unable to update offer.', 'error');
    }
  };

  const handleSaveStaff = async (form) => {
    setSavingStaff(true);
    try {
      const isEdit = Boolean(editingStaff?.id);
      const payload = { ...form };
      if (isEdit && !payload.password) delete payload.password;
      
      const url = isEdit ? `${API_BASE}/staff/${editingStaff.id}` : `${API_BASE}/staff`;
      const method = isEdit ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json().catch(() => ({}));
      
      if (!res.ok) {
        throw new Error(data.error || `Failed with status ${res.status}`);
      }
      
      if (isEdit) {
        setStaff(prev => prev.map(item => item.id === data.id ? data : item));
      } else {
        setStaff(prev => [...prev, data]);
      }

      setEditingStaff(null);
      setIsStaffModalOpen(false);
      addNotification('Staff Saved', `${data.name} has been ${isEdit ? 'updated' : 'added'}.`, 'success');
      return true;
    } catch (e) {
      console.error('Staff save error:', e);
      // Handed back to the form, which shows it next to the fields that caused
      // it. A toast alone is why a refused save looked like a dead button: the
      // notice was gone in five seconds, and the person filling the form in was
      // left staring at the same open dialog with nothing changed and no
      // explanation anywhere near the reason.
      setStaffSaveError(e.message || 'Unable to save staff account.');
      addNotification('Staff Error', e.message || 'Unable to save staff account.', 'error');
      return false;
    } finally {
      setSavingStaff(false);
    }
  };

  /**
   * Delete a staff account for good.
   *
   * This really removes the row. The confirmation says so in those words, because
   * the old version promised an undo and offered a Restore button, and an admin
   * who reads "cannot be undone" but is actually clicking something reversible
   * learns to distrust both. The server keeps past orders: they name the rider in
   * text as well as by id, so history still reads correctly afterwards.
   */
  const handleDeleteStaff = async (member) => {
    const ok = window.confirm(
      `Permanently delete "${member.name}"?\n\n` +
      'This cannot be undone. They are signed out at once and their mobile number\n' +
      'cannot sign in again. Their past deliveries are kept and still show who\n' +
      'delivered them.'
    );
    if (!ok) return;
    try {
      const res = await fetch(`${API_BASE}/staff/${member.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to delete staff');
      // Gone from the row, not greyed out. The server sends back the record it
      // removed so the name in the message is the one that was actually deleted.
      setStaff(prev => prev.filter(item => item.id !== member.id));
      setSelectedStaffIds(prev => prev.filter(id => id !== member.id));
      addNotification(
        'Staff Deleted',
        data.historyPreserved
          ? `${data.deleted?.name || member.name} has been deleted. ${data.historyPreserved} past order(s) kept.`
          : `${data.deleted?.name || member.name} has been permanently deleted.`,
        'success'
      );
    } catch (e) {
      // Whatever the server says is shown as sent rather than replaced with a
      // generic failure the admin would read as "the button is broken". The one
      // refusal left is deleting your own account, and its wording comes from
      // the backend so the button and the request can never disagree.
      addNotification('Staff Error', e.message || 'Unable to delete staff.', 'error');
    }
  };

  /**
   * Apply one role to every selected member.
   *
   * Role is the only field a bulk edit can honestly set: a shared name, number or
   * status across several people is not a thing anybody means. Changing a role can
   * move somebody between portals, so it goes through the same endpoint the single
   * editor uses and each account is validated on its own - one duplicate number
   * refuses that account and the rest still go through, with the refusal named.
   */
  const handleBulkRole = async (ids, role) => {
    if (!role || !ids.length) return;
    const targets = staff.filter((m) => ids.includes(m.id));
    let changed = 0;
    const failures = [];

    for (const member of targets) {
      if (member.role === role) continue;
      try {
        const res = await fetch(`${API_BASE}/staff/${member.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ role })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          failures.push(`${member.name}: ${data.error || 'could not be changed'}`);
          continue;
        }
        setStaff(prev => prev.map(item => (item.id === data.id ? data : item)));
        changed += 1;
      } catch {
        failures.push(`${member.name}: could not be changed`);
      }
    }

    if (changed) {
      addNotification('Staff Updated', `${changed} account${changed === 1 ? '' : 's'} set to ${role}.`, 'success');
    }
    if (failures.length) {
      addNotification('Staff Error', failures.join('; '), 'error');
    }
    if (!changed && !failures.length) {
      addNotification('Staff Updated', `Those accounts are already ${role}.`, 'info');
    }
  };

  /** Enable or disable every selected member in one request. */
  const handleBulkStatus = async (ids, isActive) => {
    try {
      const res = await fetch(`${API_BASE}/staff/bulk/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids, is_active: isActive })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to change staff status');
      setStaff(prev => prev.map(item => data.staff.find((s) => s.id === item.id) || item));
      setSelectedStaffIds([]);
      addNotification('Staff Status', data.message || 'Staff updated.', 'success');
    } catch (e) {
      // Covers the self-disable refusal, which comes back as one sentence naming
      // the account rather than as a generic failure.
      addNotification('Staff Error', e.message || 'Unable to change staff status.', 'error');
    }
  };

  /** Permanently delete every selected member, in one request. */
  const handleBulkDelete = async (ids) => {
    const targets = staff.filter((m) => ids.includes(m.id));
    const names = targets.map((m) => m.name);
    const shown = names.slice(0, 5).join(', ');
    const ok = window.confirm(
      `Permanently delete ${targets.length} staff account${targets.length === 1 ? '' : 's'}?\n\n` +
      `${shown}${names.length > 5 ? ` and ${names.length - 5} more` : ''}\n\n` +
      'This cannot be undone. They are signed out at once. Past deliveries are\n' +
      'kept and still show who delivered them.'
    );
    if (!ok) return;
    try {
      const res = await fetch(`${API_BASE}/staff/bulk/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to delete staff');
      const gone = new Set(data.deletedIds || ids);
      setStaff(prev => prev.filter(item => !gone.has(item.id)));
      setSelectedStaffIds([]);
      addNotification(
        'Staff Deleted',
        data.historyPreserved
          ? `${gone.size} account(s) deleted. ${data.historyPreserved} past order(s) kept.`
          : data.message || 'Staff deleted.',
        'success'
      );
    } catch (e) {
      // The server refuses the whole batch if any one of them is undeletable, and
      // names the blockers, so this message is the reason and not a failure.
      addNotification('Nothing Deleted', e.message || 'Unable to delete staff.', 'error');
    }
  };

  const handleToggleStaff = async (member) => {
    try {
      const res = await fetch(`${API_BASE}/staff/${member.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_active: !member.is_active })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to change staff status');
      setStaff(prev => prev.map(item => item.id === data.id ? data : item));
      addNotification('Staff Status', `${data.name} is now ${data.status === 'ACTIVE' ? 'active' : 'disabled'}.`, 'success');
    } catch (e) {
      addNotification('Staff Error', e.message || 'Unable to change staff status.', 'error');
    }
  };

  // Everyone the bulk bar is allowed to act on: every staff row except the admin
  // doing the acting. Select All is built from this, so ticking the header can
  // never quietly queue your own account for deletion.
  const selectableStaffIds = staff.filter((m) => m.id !== user?.id).map((m) => m.id);

  const navItems = [
    { id: 'dashboard', label: 'Analytics', icon: BarChart3, iconColor: 'text-[#e53935]' },    { id: 'orders', label: 'Orders', icon: ShoppingBag, iconColor: 'text-[#e53935]', count: orderStats.total },
    { id: 'kitchen', label: 'Kitchen', icon: Utensils, iconColor: 'text-[#e53935]' },
    // The fleet is a tab of its own because it answers a question none of the others
    // do: not "who is employed here" (Staff Management) but "who can I give the
    // next order to, and can I trust their phone". The Rider item opens the rider
    // portal itself, which is the rider's own screen, not the admin's view of them.
    { id: 'fleet', label: 'Rider Fleet', icon: Bike, iconColor: 'text-[#e53935]' },
    // Rider opens the existing /staff/rider portal (RiderView) rather than a tab
    // of its own, so the dashboard gains no duplicate rider screen.
    ...(canOpen('rider') ? [{ id: 'rider', label: 'Rider', icon: Truck, iconColor: 'text-[#e53935]' }] : []),
    { id: 'menu', label: 'Menu Management', icon: Utensils, iconColor: 'text-[#e53935]' },
    { id: 'coupons', label: 'Offers & Coupons', icon: Tag, iconColor: 'text-[#e53935]' },
    { id: 'customers', label: 'Customers', icon: Users, iconColor: 'text-[#e53935]' },
    { id: 'staff', label: 'Staff Management', icon: UserCog, iconColor: 'text-[#e53935]' },
    { id: 'reviews', label: 'Reviews', icon: Star, iconColor: 'text-amber-500' },
    { id: 'reports', label: 'Reports', icon: Download, iconColor: 'text-blue-500' },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, iconColor: 'text-neutral-500' },
  ];

  // ---------------------------------------------------------------------------
  // Header notifications
  //
  // There is no notifications endpoint in the backend and none is needed: the
  // admin screen already loads the real orders and customers, so every entry
  // below is derived from live application data rather than invented content.
  // Only the read/unread flag is client state, persisted per staff account.
  // ---------------------------------------------------------------------------
  // A day is a useful feed length: long enough to catch an unattended shift,
  // short enough that the badge stays meaningful instead of listing every order
  // ever placed.
  const NOTIFICATION_WINDOW_HOURS = 24;

  // A ticking clock keeps "x minutes ago" honest without calling Date.now()
  // during render, which would make the render impure.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  // These two were the only correct implementations in the file - each carried
  // its own inline copy of the "append Z to SQLite's UTC" fix, which is the
  // pattern the rest of the app got wrong. Both now call the shared helpers, so
  // there is one parse rather than five and nothing can drift.
  const relativeTime = useCallback(
    (value) => timeAgo(value, now),
    [now]
  );

  const toTimestamp = (value) => parseServerTimestamp(value) ?? 0;

  const adminNotifications = useMemo(() => {
    const items = [];
    const cutoff = now - NOTIFICATION_WINDOW_HOURS * 60 * 60 * 1000;

    (orders || []).forEach((order) => {
      const created = toTimestamp(order.created_at);
      if (!created || created < cutoff) return;
      const number = order.order_number || `#${order.id}`;
      const amount = Number(order.grand_total || order.total || 0);
      const label = `Order ${number}`;

      items.push({
        id: `order-${order.id}`,
        title: `New order received · ${label}`,
        message: `${order.customer_name || 'Customer'} placed an order for ₹${amount.toLocaleString('en-IN')}`,
        at: created,
        tab: 'orders',
        tone: 'brand'
      });

      if (order.status === 'ORDER_CONFIRMED' || order.status === 'PREPARING') {
        items.push({
          id: `kitchen-${order.id}`,
          title: `Kitchen · ${label} is ${order.status === 'ORDER_CONFIRMED' ? 'confirmed' : 'being prepared'}`,
          message: `${order.customer_name || 'Customer'} · ₹${amount.toLocaleString('en-IN')}`,
          at: created,
          tab: 'kitchen',
          tone: 'amber'
        });
      }

      if (order.status === 'READY' || order.status === 'READY_FOR_PICKUP') {
        items.push({
          id: `ready-${order.id}`,
          title: `Order ready · ${label}`,
          message: `${order.customer_name || 'Customer'} · awaiting ${order.order_type === 'pickup' ? 'pickup' : 'delivery'}`,
          at: created,
          tab: 'kitchen',
          tone: 'emerald'
        });
      }

      if (order.status === 'DELIVERED' || order.status === 'COMPLETED') {
        items.push({
          id: `done-${order.id}`,
          title: `Order completed · ${label}`,
          message: `${order.customer_name || 'Customer'} · ${order.order_type === 'pickup' ? 'self pickup' : 'delivered'}`,
          at: created,
          tab: 'orders',
          tone: 'emerald'
        });
      }

      if (order.payment_status === 'paid') {
        items.push({
          id: `paid-${order.id}`,
          title: `Payment received · ${label}`,
          message: `₹${amount.toLocaleString('en-IN')} received via ${order.payment_method || 'online'}`,
          at: created,
          tab: 'orders',
          tone: 'emerald'
        });
      }
    });

    (customers || []).forEach((customer) => {
      const created = toTimestamp(customer.created_at);
      if (!created || created < cutoff) return;
      items.push({
        id: `customer-${customer.id}`,
        title: `New customer registered · ${customer.name}`,
        message: customer.phone || customer.email || 'Customer account created',
        at: created,
        tab: 'customers',
        tone: 'neutral'
      });
    });

    return items.sort((a, b) => b.at - a.at).slice(0, 40);
  }, [orders, customers, now]);

  const unreadNotificationIds = useMemo(
    () => adminNotifications.filter((n) => !readNotificationIds.includes(n.id)).map((n) => n.id),
    [adminNotifications, readNotificationIds]
  );
  const unreadCount = unreadNotificationIds.length;

  const persistReadIds = (ids) => {
    setReadNotificationIds(ids);
    try {
      // Keep the stored list bounded so localStorage cannot grow forever.
      localStorage.setItem('hotelDarshanAdminReadNotifications', JSON.stringify(ids.slice(-400)));
    } catch (e) {}
  };

  const markNotificationRead = (id) => {
    if (readNotificationIds.includes(id)) return;
    persistReadIds([...readNotificationIds, id]);
  };

  const markAllNotificationsRead = () => {
    persistReadIds([...new Set([...readNotificationIds, ...adminNotifications.map((n) => n.id)])]);
  };

  const openNotification = (notification) => {
    markNotificationRead(notification.id);
    setNotificationsOpen(false);
    setActiveTab(notification.tab);
  };

  // Close either dropdown on outside click or Escape, and never leave both open.
  useEffect(() => {
    if (!notificationsOpen && !profileOpen) return;
    const onPointerDown = (event) => {
      if (headerRef.current && !headerRef.current.contains(event.target)) {
        setNotificationsOpen(false);
        setProfileOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setNotificationsOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [notificationsOpen, profileOpen]);

  const toggleNotifications = () => {
    setNotificationsOpen((open) => {
      if (!open) setProfileOpen(false);
      return !open;
    });
  };

  const toggleProfile = () => {
    setProfileOpen((open) => {
      if (!open) setNotificationsOpen(false);
      return !open;
    });
  };

  // Icon in the header title follows the active dashboard section.
  const SectionIcon = navItems.find((n) => n.id === activeTab)?.icon || BarChart3;

  // Uses the existing auth logout, then returns to the staff sign-in screen.
  // The URL moves through the router: writing it directly and dispatching a
  // synthetic popstate left the router's own location stale, which matters now
  // that the section being shown is read from that location.
  const handleSignOut = () => {
    setNotificationsOpen(false);
    setProfileOpen(false);
    logout();
    routerNavigate('/staff', { replace: true });
  };

  // Admin/Kitchen/Rider navigation lives in the left sidebar only, so the top
  // header carries just the account and notification controls. The header used
  // to repeat those three buttons, which was redundant.
  const goToPortal = (target) => {
    if (typeof onNavigate === 'function') onNavigate(target);
  };

  return (
    <div {...{ [ADMIN_THEME_ATTRIBUTE]: adminResolvedTheme || 'light' }} className="min-h-screen bg-neutral-100/70 flex">
      {/* Left Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 overflow-y-auto transition-all duration-300 bg-white border-r border-neutral-200 flex flex-col ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${sidebarOpen ? 'w-64' : 'w-20'} lg:relative`}
      >
        {/* Logo/Branding */}
        <div className="h-16 px-4 border-b border-neutral-100 flex items-center justify-between">
          {sidebarOpen && (
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <BrandLogo size="sm" />
              <div className="min-w-0">
                <h1 className="font-black text-neutral-900 text-sm leading-tight truncate">Hotel Darshan</h1>
                <p className="text-[10px] text-neutral-500 truncate">Restaurant Management</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-500 transition shrink-0"
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <ChevronLeft className={`w-5 h-5 transition-transform ${sidebarOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Restaurant Management Section Header */}
        {sidebarOpen && (
          <div className="px-4 py-2 border-b border-neutral-100">
            <p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Restaurant Management</p>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-2.5 space-y-1" aria-label="Admin navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => (item.id === 'rider' ? goToPortal('rider') : setActiveTab(item.id))}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-[#e53935] text-white shadow-md'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                } ${!sidebarOpen ? 'justify-center' : ''}`}
                title={sidebarOpen ? undefined : item.label}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-white' : item.iconColor}`} />
                {sidebarOpen && (
                  <span className="font-semibold text-xs truncate flex-1">{item.label}</span>
                )}
                {sidebarOpen && item.count !== undefined && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isActive ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-700'}`}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer - Hotel Info + Customer App */}
        <div className="border-t border-neutral-100">
          {sidebarOpen && (
            <div className="p-2.5">
              <p className="text-[10px] text-neutral-400 text-center leading-snug">
                Char Rasta, Mosda Road, Dediapada<br />
                Gujarat - 393040
              </p>
            </div>
          )}
          <button
             onClick={() => {
              routerNavigate('/');
            }}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 transition-all duration-200 cursor-pointer bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-t border-emerald-200 ${
              !sidebarOpen ? 'justify-center' : ''
            }`}
            title="Open Customer App"
          >
            <Utensils className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && (
              <span className="font-bold text-xs flex-1">Open Customer App</span>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content. The sidebar is `fixed` on small screens and `lg:relative`
          (in flex flow) on large ones, so this column must NOT also carry an
          `lg:ml-*` offset - doing so reserved the sidebar width twice and
          squeezed the header controls off-screen. */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header - the single Admin header (title + navigation + profile) */}
        <header ref={headerRef} className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-neutral-200">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
            {/* h-16 matches the sidebar branding row so both bottom borders align */}
            <div className="flex items-center justify-between h-16 gap-2 sm:gap-3">
              {/* Page Title - LEFT side of the admin header */}
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#e53935]/10 text-[#e53935] flex items-center justify-center shrink-0">
                  <SectionIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-black text-lg sm:text-xl text-neutral-900 truncate">
                      {navItems.find(n => n.id === activeTab)?.label || 'Dashboard'}
                    </h2>
                    {activeTab === 'dashboard' && (
                      <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        Live
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5 truncate">
                    {activeTab === 'dashboard' && 'Real-time analytics and performance overview'}
                    {activeTab === 'orders' && 'Manage and track all customer orders'}
                    {activeTab === 'kitchen' && 'Live kitchen display for order preparation'}
    {activeTab === 'fleet' && 'Live rider presence, workload and last known positions'}
                    {activeTab === 'menu' && 'Manage food items and categories'}
                    {activeTab === 'coupons' && 'Create and manage promotional offers'}
                    {activeTab === 'customers' && 'View registered customers and their history'}
                    {activeTab === 'staff' && 'Manage kitchen staff and delivery riders'}
                    {activeTab === 'reviews' && 'Read customer feedback and ratings'}
                    {activeTab === 'settings' && 'Configure hotel settings and preferences'}
                  </p>
                </div>
              </div>

              {/* Right Side - notifications and account controls only.
                  Admin/Kitchen/Rider navigation stays in the left sidebar. */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* Global Search */}
                <div className="relative hidden xl:block">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search orders, items, customers..."
                    className="w-52 2xl:w-60 pl-8 pr-9 py-1.5 text-xs bg-neutral-100 border border-transparent rounded-xl focus:bg-white focus:border-[#e53935] focus:outline-none transition"
                    aria-label="Global search"
                  />
                </div>

                {/* Notifications - built from real orders and customers */}
                <div className="relative">
                  <button
                    onClick={toggleNotifications}
                    className="relative p-2 rounded-xl hover:bg-neutral-100 text-neutral-600 transition cursor-pointer"
                    aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                    aria-expanded={notificationsOpen}
                  >
                    <Bell className="w-5 h-5" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-[#e53935] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </button>
                  {notificationsOpen && (
                    <div className="fixed inset-x-4 top-20 sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 w-[min(20rem,calc(100vw-2rem))] bg-white rounded-2xl border border-neutral-200 shadow-xl py-2 z-50">
                      <div className="px-4 py-2 border-b border-neutral-100 flex items-center justify-between gap-2">
                        <h3 className="font-bold text-sm text-neutral-900">Notifications</h3>
                        {unreadCount > 0 && (
                          <button
                            onClick={markAllNotificationsRead}
                            className="text-xs font-semibold text-[#e53935] hover:underline cursor-pointer whitespace-nowrap"
                          >
                            Mark all read
                          </button>
                        )}
                      </div>
                      <div className="max-h-80 overflow-y-auto overscroll-contain">
                        {adminNotifications.length === 0 ? (
                          <p className="px-4 py-8 text-center text-xs text-neutral-500">No new notifications</p>
                        ) : (
                          adminNotifications.map((notification) => {
                            const isUnread = !readNotificationIds.includes(notification.id);
                            const dot =
                              notification.tone === 'emerald' ? 'bg-emerald-500'
                                : notification.tone === 'amber' ? 'bg-amber-500'
                                : notification.tone === 'brand' ? 'bg-[#e53935]'
                                : 'bg-neutral-400';
                            return (
                              <button
                                key={notification.id}
                                onClick={() => openNotification(notification)}
                                className={`w-full text-left px-4 py-3 flex gap-2.5 transition cursor-pointer ${
                                  isUnread ? 'bg-[#e53935]/[0.04] hover:bg-neutral-50' : 'hover:bg-neutral-50 opacity-70'
                                }`}
                              >
                                <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${isUnread ? dot : 'bg-neutral-200'}`} />
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-2">
                                    <span className={`text-xs truncate ${isUnread ? 'font-bold text-neutral-900' : 'font-medium text-neutral-700'}`}>
                                      {notification.title}
                                    </span>
                                  </span>
                                  <span className="block text-[10px] text-neutral-500 mt-0.5 truncate">{notification.message}</span>
                                  <span className="block text-[10px] text-neutral-400 mt-1">{relativeTime(notification.at)}</span>
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Profile Dropdown */}
                <div className="relative">
                  <button
                    onClick={toggleProfile}
                    className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-neutral-100 transition cursor-pointer"
                    aria-label="User menu"
                    aria-expanded={profileOpen}
                  >
                    <div className="w-8 h-8 rounded-full bg-[#e53935] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {user?.name?.charAt(0) || 'V'}
                    </div>
                    <span className="hidden lg:block text-xs font-bold text-neutral-900 max-w-28 truncate">
                      {user?.name || 'Vasava Rameshbhai'}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform flex-shrink-0 ${profileOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {profileOpen && (
                    <div className="absolute right-0 mt-2 w-60 max-w-[calc(100vw-2rem)] bg-white rounded-2xl border border-neutral-200 shadow-xl py-2 z-50">
                      <div className="px-4 py-3 border-b border-neutral-100">
                        <p className="font-bold text-sm text-neutral-900 truncate">{user?.name || 'Vasava Rameshbhai'}</p>
                        <p className="text-xs text-neutral-500">Owner &amp; Administrator</p>
                      </div>
                      <button
                        onClick={() => { setProfileOpen(false); setProfileModalOpen(true); }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-neutral-700 hover:bg-neutral-50 flex items-center gap-2 cursor-pointer"
                      >
                        <UserCog className="w-4 h-4 flex-shrink-0" />
                        Profile Settings
                      </button>
                      <button
                        onClick={() => { setProfileOpen(false); setAppearanceModalOpen(true); }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-neutral-700 hover:bg-neutral-50 flex items-center gap-2 cursor-pointer"
                      >
                        <Palette className="w-4 h-4 flex-shrink-0" />
                        Appearance
                      </button>
                      <div className="border-t border-neutral-100 my-2"></div>
                      <button
                        onClick={handleSignOut}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer"
                      >
                        <LogOut className="w-4 h-4 flex-shrink-0" />
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>

                {/* Mobile Menu Toggle */}
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="lg:hidden p-2 rounded-xl hover:bg-neutral-100 text-neutral-600 transition cursor-pointer"
                  aria-label="Toggle menu"
                >
                  <Menu className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Body Content */}
        <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {/* TAB 1: ANALYTICS & DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="space-y-5">
            {/* Summary Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
              {/* Total Revenue */}
              <div className="relative overflow-hidden rounded-2xl bg-white border border-neutral-200 shadow-xs hover:shadow-md transition-all duration-200">
                <div className="flex items-start justify-between gap-2 p-3.5 sm:p-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Total Revenue</p>
                    <div className="mt-1.5 text-xl sm:text-2xl font-black text-neutral-900 tabular-nums">
                      ₹{dashboardStats.totalRevenue.toLocaleString('en-IN')}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-neutral-500">{dashboardStats.totalOrders} orders</p>
                      {dashboardStats.revenueTrend && (
                        <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${dashboardStats.revenueTrend.up ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          {dashboardStats.revenueTrend.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {dashboardStats.revenueTrend.pct}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
                    <DollarSign className="w-5 h-5" />
                  </div>
                </div>
              </div>

              {/* Total Orders */}
              <div className="relative overflow-hidden rounded-2xl bg-white border border-neutral-200 shadow-xs hover:shadow-md transition-all duration-200">
                <div className="flex items-start justify-between gap-2 p-3.5 sm:p-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Total Orders</p>
                    <div className="mt-1.5 text-xl sm:text-2xl font-black text-neutral-900 tabular-nums">
                      {dashboardStats.totalOrders.toLocaleString('en-IN')}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-neutral-500">{dashboardStats.completedOrders} done • {dashboardStats.cancelledOrders} cancelled</p>
                      {dashboardStats.ordersTrend && (
                        <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${dashboardStats.ordersTrend.up ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          {dashboardStats.ordersTrend.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                          {dashboardStats.ordersTrend.pct}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600 shrink-0">
                    <Package className="w-5 h-5" />
                  </div>
                </div>
              </div>

              {/* Total Customers */}
              <div className="relative overflow-hidden rounded-2xl bg-white border border-neutral-200 shadow-xs hover:shadow-md transition-all duration-200">
                <div className="flex items-start justify-between gap-2 p-3.5 sm:p-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Customers</p>
                    <div className="mt-1.5 text-xl sm:text-2xl font-black text-neutral-900 tabular-nums">
                      {dashboardStats.totalCustomers.toLocaleString('en-IN')}
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5">Registered</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600 shrink-0">
                    <UsersIcon className="w-5 h-5" />
                  </div>
                </div>
              </div>

              {/* Pending Orders */}
              <div className="relative overflow-hidden rounded-2xl bg-white border border-neutral-200 shadow-xs hover:shadow-md transition-all duration-200">
                <div className="flex items-start justify-between gap-2 p-3.5 sm:p-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Pending Orders</p>
                    <div className="mt-1.5 text-xl sm:text-2xl font-black text-neutral-900 tabular-nums">
                      {dashboardStats.pendingOrders}
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5">Awaiting confirmation</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 shrink-0">
                    <Timer className="w-5 h-5" />
                  </div>
                </div>
              </div>

              {/* Active Orders */}
              <div className="relative overflow-hidden rounded-2xl bg-white border border-neutral-200 shadow-xs hover:shadow-md transition-all duration-200">
                <div className="flex items-start justify-between gap-2 p-3.5 sm:p-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Active Orders</p>
                    <div className="mt-1.5 text-xl sm:text-2xl font-black text-neutral-900 tabular-nums">
                      {dashboardStats.activeOrders}
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5">In prep/delivery</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-orange-50 text-orange-600 shrink-0">
                    <Truck className="w-5 h-5" />
                  </div>
                </div>
              </div>

              {/* Avg Delivery Time */}
              <div className="relative overflow-hidden rounded-2xl bg-white border border-neutral-200 shadow-xs hover:shadow-md transition-all duration-200">
                <div className="flex items-start justify-between gap-2 p-3.5 sm:p-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Avg Delivery</p>
                    <div className="mt-1.5 text-xl sm:text-2xl font-black text-neutral-900 tabular-nums">
                      {dashboardStats.avgDeliveryMinutes > 0 ? `${dashboardStats.avgDeliveryMinutes} min` : '—'}
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5">{dashboardStats.avgDeliveryMinutes > 0 ? 'From completed' : 'No data yet'}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-red-50 text-red-600 shrink-0">
                    <Activity className="w-5 h-5" />
                  </div>
                </div>
              </div>
            </div>

            {/* Today's Snapshot Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-2xl bg-white border border-neutral-200 shadow-xs">
                <div className="flex items-center justify-between p-3.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Today's Revenue</span>
                  <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600"><ArrowUpRight className="w-4 h-4" /></div>
                </div>
                <div className="px-3.5 pb-3.5">
                  <div className="text-xl sm:text-2xl font-black text-neutral-900 tabular-nums">
                    ₹{dashboardStats.todayRevenue.toLocaleString('en-IN')}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-neutral-500">{dashboardStats.todayOrders} orders today</span>
                    {dashboardStats.revenueTrend && (
                      <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${dashboardStats.revenueTrend.up ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                        {dashboardStats.revenueTrend.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {dashboardStats.revenueTrend.pct}%
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-neutral-200 shadow-xs">
                <div className="flex items-center justify-between p-3.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Avg Order Value</span>
                  <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600"><CreditCard className="w-4 h-4" /></div>
                </div>
                <div className="px-3.5 pb-3.5">
                  <div className="text-xl sm:text-2xl font-black text-neutral-900 tabular-nums">
                    ₹{Math.round(dashboardStats.avgOrderValue).toLocaleString('en-IN')}
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">Per order (all time)</div>
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-neutral-200 shadow-xs">
                <div className="flex items-center justify-between p-3.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Completed Today</span>
                  <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600"><CheckCircle2 className="w-4 h-4" /></div>
                </div>
                <div className="px-3.5 pb-3.5">
                  <div className="text-xl sm:text-2xl font-black text-emerald-600 tabular-nums">
                    {analytics?.completed_orders || 0}
                  </div>
                  <div className="text-xs text-emerald-600 font-medium mt-0.5">Delivered successfully</div>
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-neutral-200 shadow-xs">
                <div className="flex items-center justify-between p-3.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Cancelled Today</span>
                  <div className="p-1.5 rounded-lg bg-red-50 text-red-600"><MinusCircle className="w-4 h-4" /></div>
                </div>
                <div className="px-3.5 pb-3.5">
                  <div className="text-xl sm:text-2xl font-black text-red-600 tabular-nums">
                    {analytics?.cancelled_orders || 0}
                  </div>
                  <div className="text-xs text-red-600 font-medium mt-0.5">Cancelled orders</div>
                </div>
              </div>
          </div>

            {/* Analytics Charts Section */}
            <div className="space-y-5">
              {/* Section Header */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-base font-black text-neutral-900">Analytics Overview</h2>
                <div className="inline-flex w-full max-w-xs rounded-xl border border-neutral-200 bg-neutral-100 p-1 shadow-sm sm:w-auto" role="group" aria-label="Analytics date range">
{[
                     { value: 'today', label: 'Today' },
                     { value: 'week', label: 'This Week' },
                     { value: 'month', label: 'This Month' },
                   ].map((option) => (
                     <button
                       key={option.value}
                       type="button"
                       onClick={() => { setDateFilter(option.value); fetchAnalytics(option.value); }}
                       className={[
                         'flex-1 rounded-lg px-3 py-1.5 text-xs font-bold text-neutral-500 transition hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-[#e53935] focus:ring-offset-1 sm:flex-none sm:px-4',
                         dateFilter === option.value ? 'bg-white text-neutral-900 shadow-sm' : '',
                       ].join(' ')}
                       aria-pressed={dateFilter === option.value}
                     >
                       {option.label}
                     </button>
                   ))}
                </div>
              </div>

              {/* Revenue & Orders Trend */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Revenue Overview */}
                <div className="rounded-2xl bg-white border border-neutral-200 shadow-sm">
                  <div className="flex items-center justify-between p-4">
                    <h3 className="font-bold text-sm text-neutral-900">Revenue Overview</h3>
                    <span className="text-xs font-semibold text-emerald-600">
                      +{analytics?.weekly_sales?.reduce((sum, d) => sum + Number(d.daily_revenue), 0).toLocaleString('en-IN') || 0}
                    </span>
                  </div>
                  <div className="px-4 pb-4">
                    <RevenueChart data={analytics?.weekly_sales || []} />
                  </div>
                </div>

                {/* Orders Overview */}
                <div className="rounded-2xl bg-white border border-neutral-200 shadow-sm">
                  <div className="flex items-center justify-between p-4">
                    <h3 className="font-bold text-sm text-neutral-900">Orders Overview</h3>
                    <span className="text-xs font-semibold text-blue-600">
                      {analytics?.weekly_sales?.reduce((sum, d) => sum + Number(d.order_count), 0) || 0} orders
                    </span>
                  </div>
                  <div className="px-4 pb-4">
                    <OrdersChart data={analytics?.weekly_sales || []} />
                  </div>
                </div>
              </div>

              {/* Orders by Hour & Order Status */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Orders by Hour */}
                <div className="rounded-2xl bg-white border border-neutral-200 shadow-sm">
                  <div className="p-4 pb-3">
                    <h3 className="font-bold text-sm text-neutral-900">Orders by Hour</h3>
                  </div>
                  <div className="px-4 pb-4">
                    <HourlyChart data={analytics?.hourly_orders || []} />
                  </div>
                </div>

                {/* Order Status Distribution */}
                <div className="rounded-2xl bg-white border border-neutral-200 shadow-sm">
                  <div className="p-4 pb-3">
                    <h3 className="font-bold text-sm text-neutral-900">Order Status</h3>
                  </div>
                  <div className="px-4 pb-4">
                    <StatusChart data={analytics?.status_summary || []} />
                  </div>
                </div>
              </div>

              {/* Popular Items & Delivery vs Pickup */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Popular Food Items */}
                <div className="rounded-2xl bg-white border border-neutral-200 shadow-sm">
                  <div className="p-4 pb-3">
                    <h3 className="font-bold text-sm text-neutral-900">Popular Food Items</h3>
                  </div>
                  <div className="px-4 pb-4">
                    <PopularItemsChart data={analytics?.popular_items || []} />
                  </div>
                </div>

                {/* Delivery vs Pickup */}
                <div className="rounded-2xl bg-white border border-neutral-200 shadow-sm">
                  <div className="p-4 pb-3">
                    <h3 className="font-bold text-sm text-neutral-900">Delivery vs Pickup</h3>
                  </div>
                  <div className="px-4 pb-4">
                    <DeliveryPickupChart orders={orders} />
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Orders Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-black text-neutral-900">Recent Orders</h2>
                <div className="flex items-center gap-2">
                  {searchQuery && (
                    <span className="text-[10px] text-neutral-400 font-medium">
                      {filteredRecentOrders.length} match{filteredRecentOrders.length === 1 ? '' : 'es'}
                    </span>
                  )}
                  <button
                    onClick={() => setActiveTab('orders')}
                    className="text-xs font-semibold text-[#e53935] hover:underline"
                  >
                    View All Orders →
                  </button>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-semibold uppercase tracking-wider text-xs">
                      <tr>
                        <th className="p-3 w-24">Order #</th>
                        <th className="p-3">Customer</th>
                        <th className="p-3">Items</th>
                        <th className="p-3 w-28">Type</th>
                        <th className="p-3 w-28 text-right">Amount</th>
                        <th className="p-3 w-32">Status</th>
                        <th className="p-3 w-32 text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {filteredRecentOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-neutral-50/50 transition-colors">
                          <td className="p-3 font-mono font-bold text-neutral-900 text-sm">
                            #{order.order_number || order.id}
                          </td>
                          <td className="p-3">
                            <div className="font-medium text-neutral-900">{order.customer_name || 'Walk-in Customer'}</div>
                            <div className="text-[11px] text-neutral-500">{order.customer_phone || 'No phone'}</div>
                          </td>
                          <td className="p-3 max-w-xs">
                            <div className="text-xs text-neutral-700 line-clamp-1 flex items-center gap-1.5">
                              {order.items?.slice(0, 2).map((item, idx) => (
                                <span key={idx} className="flex items-center gap-1">
                                  {idx > 0 && <span className="text-neutral-300">,</span>}
                                  <span className="font-medium">{item.quantity || 1}×</span>
                                  <span>{item.name_en || item.name}</span>
                                </span>
                              ))}
                              {order.items && order.items.length > 2 && (
                                <span className="text-neutral-400">+{order.items.length - 2} more</span>
                              )}
                            </div>
                          </td>
                          <td className="p-4">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold ${
                              order.order_type === 'pickup'
                                ? 'bg-purple-50 text-purple-700'
                                : 'bg-blue-50 text-blue-700'
                            }`}>
                              {order.order_type === 'pickup' ? (
                                <>
                                  <Package className="w-3 h-3" />
                                  Pickup
                                </>
                              ) : (
                                <>
                                  <Truck className="w-3 h-3" />
                                  Delivery
                                </>
                              )}
                            </span>
                          </td>
                           <td className="p-3 text-right font-black text-neutral-900 tabular-nums">
                            ₹{(order.grand_total || order.total || 0).toLocaleString('en-IN')}
                          </td>
                          <td className="p-3">
                            <StatusBadge status={order.status} />
                          </td>
                          <td className="p-3 text-right text-[11px] text-neutral-500 whitespace-nowrap">
                            {formatDateTime(order.created_at) || '—'}
                          </td>
                        </tr>
                      ))}
                      {orders.length === 0 && (
                        <tr>
                          <td colSpan={7} className="p-6 text-center text-neutral-400 text-sm font-medium">
                            No orders yet
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

{/* TAB 2: LIVE ORDERS TABLE */}
        {activeTab === 'orders' && (
          <div className="bg-white rounded-3xl border border-neutral-200 shadow-xs overflow-hidden">
            <div className="p-5 border-b border-neutral-100">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="font-black text-base text-neutral-900">Live Orders Queue</h2>
                  <p className="text-xs text-neutral-500">Updates dynamically via Socket.IO</p>
                </div>
                <button onClick={fetchOrders} className="p-2 rounded-xl border border-neutral-200 hover:bg-neutral-50 cursor-pointer">
                  <RefreshCw className="w-4 h-4 text-neutral-600" />
                </button>
              </div>

              {/* Status / Type Filters */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'new', label: 'New' },
                  { value: 'confirmed', label: 'Confirmed' },
                  { value: 'preparing', label: 'Preparing' },
                  { value: 'ready', label: 'Ready' },
                  { value: 'out_for_delivery', label: 'Out for Delivery' },
                  { value: 'delivered', label: 'Delivered' },
                  { value: 'cancelled', label: 'Cancelled' },
                  { value: 'delivery', label: 'Delivery' },
                  { value: 'pickup', label: 'Pickup' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setOrderFilter(opt.value)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition cursor-pointer ${
                      orderFilter === opt.value
                        ? 'bg-[#e53935] text-white'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Order-specific search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  placeholder="Search by Order ID, customer name, mobile number..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-neutral-200 focus:border-[#e53935] outline-hidden transition"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="p-4">Order No</th>
                    <th className="p-4">Customer & Phone</th>
                    <th className="p-4">Type</th>
                    <th className="p-4">Items</th>
                    <th className="p-4">Total</th>
                    <th className="p-4">Payment</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-neutral-50/80">
                      <td className="p-4 font-mono font-bold text-neutral-900">
                        #{o.order_number || o.id}
                        <div className="text-[10px] text-neutral-400 font-normal">
                          {formatClockTime(o.created_at) || 'Now'}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-neutral-900">{o.customer_name || 'Walk-in'}</div>
                        <div className="text-neutral-500 text-[11px]">{o.customer_phone || 'N/A'}</div>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-neutral-100 text-neutral-700">
                          {o.order_type || 'Delivery'}
                        </span>
                      </td>
                      <td className="p-4 max-w-xs">
                        <div className="line-clamp-2">
                          {o.items?.map(it => `${it.quantity}x ${it.name_en || it.name}`).join(', ')}
                        </div>
                      </td>
                      <td className="p-4 font-black text-neutral-900">₹{o.grand_total || o.total}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                          o.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {o.payment_method || 'COD'} ({o.payment_status || 'Pending'})
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-neutral-100 text-neutral-800">
                          {String(o.status || 'ORDER_PLACED').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setViewingOrder(o)}
                            className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-600 cursor-pointer transition"
                            title="View details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <select
                            value={o.status || 'ORDER_PLACED'}
                            onChange={(e) => handleOrderStatusChange(o.id, e.target.value)}
                            className="p-1.5 bg-neutral-100 rounded-lg text-xs font-semibold border border-neutral-200 outline-none cursor-pointer"
                          >
                            {o.order_type === 'pickup' ? (
                              <>
                                <option value="ORDER_PLACED">Order Placed</option>
                                <option value="PREPARING">Preparing</option>
                                <option value="READY_FOR_PICKUP">Ready for Pickup</option>
                                <option value="PICKED_UP">Picked Up</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="CANCELLED">Cancel Order</option>
                              </>
                            ) : (
                              <>
                                <option value="ORDER_PLACED">Order Placed</option>
                                <option value="ORDER_CONFIRMED">Order Confirmed</option>
                                <option value="PREPARING">Preparing</option>
                                <option value="READY">Food Ready</option>
                                <option value="OUT_FOR_DELIVERY">Out for Delivery</option>
                                <option value="DELIVERED">Delivered</option>
                                <option value="CANCELLED">Cancel Order</option>
                              </>
                            )}
                          </select>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-neutral-400 text-sm font-medium">
                        {orders.length === 0 ? 'No orders yet' : 'No orders match the current filter'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
{viewingOrder && <OrderDetailsModal order={viewingOrder} onClose={() => setViewingOrder(null)} onUpdateStatus={handleOrderStatusChange} />}

        {/* TAB 3: LIVE KITCHEN DISPLAY */}
        {activeTab === 'kitchen' && (
          <KitchenView />
        )}

        {/* TAB 4: MENU MANAGEMENT */}
        {activeTab === 'menu' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center bg-white p-1 rounded-2xl border border-neutral-200 shadow-xs text-xs font-bold">
                <button
                  onClick={() => setMenuSubTab('items')}
                  className={`px-4 py-2 rounded-xl transition cursor-pointer ${
                    menuSubTab === 'items' ? 'bg-[#e53935] text-white shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Food Items ({items.length})
                </button>
                <button
                  onClick={() => setMenuSubTab('categories')}
                  className={`px-4 py-2 rounded-xl transition cursor-pointer ${
                    menuSubTab === 'categories' ? 'bg-[#e53935] text-white shadow-xs' : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Categories ({categories.length})
                </button>
              </div>

              {menuSubTab === 'items' ? (
                <button
                  onClick={() => { setEditingItem(null); setIsItemModalOpen(true); }}
                  className="py-2.5 px-4 rounded-xl bg-[#e53935] hover:bg-[#d32f2f] text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> <span>Add New Dish</span>
                </button>
              ) : (
                <button
                  onClick={() => { setEditingCategory(null); setIsCategoryModalOpen(true); }}
                  className="py-2.5 px-4 rounded-xl bg-[#e53935] hover:bg-[#d32f2f] text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> <span>Add Category</span>
                </button>
              )}
            </div>

            {/* FOOD ITEMS LIST WITH 1-TAP AVAILABILITY TOGGLE */}
            {menuSubTab === 'items' && (
              <div className="bg-white rounded-3xl border border-neutral-200 shadow-xs overflow-hidden">
                {/* Toolbar with Search */}
                <div className="p-4 border-b border-neutral-100 flex items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="Search dishes..."
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden"
                    />
                  </div>
                  <span className="text-xs text-neutral-500 font-medium">
                    {items.filter(i => i.name_en?.toLowerCase().includes(itemSearch.toLowerCase()) || i.name_hi?.toLowerCase().includes(itemSearch.toLowerCase()) || i.name_gu?.toLowerCase().includes(itemSearch.toLowerCase())).length} of {items.length}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-bold uppercase tracking-wider">
                      <tr>
                        <th className="p-4">Dish</th>
                        <th className="p-4">Category</th>
                        <th className="p-4">Price</th>
                        <th className="p-4">Stock Qty</th>
                        <th className="p-4">1-Tap Availability</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {items
                        .filter(i =>
                          !itemSearch ||
                          i.name_en?.toLowerCase().includes(itemSearch.toLowerCase()) ||
                          i.name_hi?.toLowerCase().includes(itemSearch.toLowerCase()) ||
                          i.name_gu?.toLowerCase().includes(itemSearch.toLowerCase())
                        )
                        .map((item) => {
                          const isAvailable = item.is_available && (item.available_qty ?? 1) > 0;
                          const imageUrl = resolveFoodImage(item);
                          return (
                            <tr key={item.id} className="hover:bg-neutral-50/80 transition-colors">
                              <td className="p-4">
                                <div className="flex items-center gap-3">
                                  <div className="relative shrink-0">
                                    <FoodImage
                                      src={imageUrl}
                                      alt={item.name_en}
                                      className="w-12 h-12 rounded-xl object-cover border"
                                    />
                                    {item.is_veg !== undefined && (
                                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white flex items-center justify-center ${
                                        item.is_veg ? 'bg-emerald-600' : 'bg-red-600'
                                      }`}>
                                        <span className={`w-1 h-1 rounded-full ${item.is_veg ? 'bg-white' : 'bg-white'}`}></span>
                                      </span>
                                    )}
                                  </div>
                                  <div>
                                    <div className="font-bold text-neutral-900 text-sm flex items-center gap-2">
                                      {item.name_en || item.name}
                                      {item.is_special && (
                                        <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 text-[9px] font-bold">
                                          Special
                                        </span>
                                      )}
                                      {item.is_popular && (
                                        <span className="px-1.5 py-0.2 rounded-full bg-red-100 text-[#e53939] text-[9px] font-bold">
                                          Popular
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-neutral-400">
                                      {item.name_gu} • {item.name_hi}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="p-4 text-neutral-600 font-medium">
                                {item.category_name_en || 'General'}
                              </td>
                              <td className="p-4">
                                <div className="flex items-center gap-2">
                                  <span className="font-black text-neutral-900">₹{item.price}</span>
                                  {item.discount_price && item.discount_price > 0 && (
                                    <span className="text-neutral-400 line-through text-[10px]">₹{item.discount_price}</span>
                                  )}
                                </div>
                              </td>
                              <td className="p-4">
                                <input
                                  type="number"
                                  min="0"
                                  value={item.available_qty || 0}
                                  onChange={(e) => handleUpdateStock(item.id, e.target.value)}
                                  className="w-16 p-1 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-bold text-center focus:border-[#e53939] outline-hidden"
                                />
                              </td>
                              <td className="p-4">
                                <button
                                  onClick={() => handleToggleAvailability(item)}
                                  className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs ${
                                    isAvailable
                                      ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800'
                                      : 'bg-red-100 hover:bg-red-200 text-red-800'
                                  }`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${isAvailable ? 'bg-emerald-600' : 'bg-red-600'}`}></span>
                                  <span>{isAvailable ? 'Available' : 'Unavailable'}</span>
                                </button>
                              </td>
                              <td className="p-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => { setEditingItem(item); setIsItemModalOpen(true); }}
                                    className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-600 cursor-pointer transition"
                                    title="Edit"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteItem(item)}
                                    className="p-1.5 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer transition"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                {/* Empty state */}
                {items.length === 0 && (
                  <div className="p-12 text-center">
                    <Utensils className="w-12 h-12 text-neutral-200 mx-auto mb-3" />
                    <p className="text-neutral-500 font-medium">No food items found.</p>
                  </div>
                )}
              </div>
            )}

            {/* CATEGORIES LIST */}
            {menuSubTab === 'categories' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {categories.map((cat) => (
                  <div key={cat.id} className="p-4 rounded-3xl bg-white border border-neutral-200 shadow-xs flex items-center justify-between gap-3 hover:shadow-md transition-shadow">
                    <div className="flex items-center gap-3 min-w-0">
                      {cat.image_url ? (
                        <FoodImage
                          src={cat.image_url}
                          alt={cat.name_en}
                          className="w-12 h-12 rounded-2xl object-cover border"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-2xl bg-neutral-100 flex items-center justify-center border">
                          <Layers className="w-5 h-5 text-neutral-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <h4 className="font-bold text-sm text-neutral-900 truncate">{cat.name_en}</h4>
                        <p className="text-xs text-neutral-500 truncate">{cat.name_gu} • {cat.name_hi}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => { setEditingCategory(cat); setIsCategoryModalOpen(true); }}
                        className="p-2 rounded-lg hover:bg-neutral-100 text-neutral-600 cursor-pointer transition"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteCategory(cat)}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-600 cursor-pointer transition"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: OFFERS & COUPONS */}
        {activeTab === 'coupons' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-black text-base text-neutral-900">Promotions & Coupons</h2>
                <p className="text-xs text-neutral-500">Manage discounts and checkout codes.</p>
              </div>
              <button onClick={() => { setEditingCoupon(null); setIsCouponModalOpen(true); }} className="py-2.5 px-4 rounded-xl bg-[#e53935] hover:bg-[#d32f2f] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"><Plus className="w-4 h-4" /> Add Offer</button>
            </div>
              {!token && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              Admin token not found. Coupon management is unavailable.
            </div>
          )}

          {token && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {coupons.length === 0 ? (
              <div className="col-span-full py-12 text-center text-neutral-400 text-xs">
                No offers created yet. Click "Add Offer" to get started.
              </div>
            ) : (
              coupons.map((cpn) => {
                // Compared as parsed instants. `new Date(valid_to) < new Date()`
                // read the stored UTC as local, so a coupon could be shown live
                // for up to 5h30m past its real expiry.
                const validToMs = parseServerTimestamp(cpn.valid_to);
                const isExpired = validToMs !== null && validToMs < Date.now();
                const isExhausted = cpn.usage_limit && cpn.used_count >= cpn.usage_limit;
                const statusColor = cpn.is_active && !isExpired && !isExhausted
                  ? 'bg-emerald-100 text-emerald-800'
                  : isExpired
                    ? 'bg-red-100 text-red-800'
                    : isExhausted
                      ? 'bg-orange-100 text-orange-800'
                      : 'bg-neutral-100 text-neutral-500';

                return (
                  <div key={cpn.id} className="p-5 rounded-3xl bg-white border border-neutral-200 shadow-xs space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-black text-sm px-2.5 py-1 rounded-lg bg-neutral-900 text-white">
                        {cpn.code}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${statusColor}`}>
                        {cpn.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="space-y-2 text-xs text-neutral-700">
                      <div>
                        <span className="font-bold">Discount:</span>{' '}
                        {cpn.discount_type === 'percentage'
                          ? `${cpn.discount_value}% OFF`
                          : `Flat ₹${cpn.discount_value} OFF`}
                        {cpn.max_discount && cpn.discount_type === 'percentage' && (
                          <span className="text-neutral-500"> (max ₹{cpn.max_discount})</span>
                        )}
                      </div>

                      {cpn.min_order_value > 0 && (
                        <div>
                          <span className="font-bold">Min Order:</span> ₹{cpn.min_order_value}
                        </div>
                      )}

                      <div>
                        <span className="font-bold">Expires:</span>{' '}
                        {cpn.valid_to ? formatDate(cpn.valid_to) : 'Never'}
                      </div>

                      {cpn.usage_limit && (
                        <div>
                          <span className="font-bold">Usage:</span>{' '}
                          <span className={cpn.used_count >= cpn.usage_limit ? 'text-red-600' : ''}>
                            {cpn.used_count || 0}/{cpn.usage_limit}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleToggleCouponActive(cpn)}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition ${
                          cpn.is_active
                            ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                            : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700'
                        } cursor-pointer`}
                        title={cpn.is_active ? 'Disable this offer' : 'Enable this offer'}
                      >
                        {cpn.is_active ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {cpn.is_active ? 'On' : 'Off'}
                      </button>
                      <button
                        onClick={() => { setEditingCoupon(cpn); setIsCouponModalOpen(true); }}
                        className="flex-1 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => handleDeleteCoupon(cpn)}
                        className="py-2 px-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold cursor-pointer"
                        title="Delete this offer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
            )}
          </div>
        )}

        {/* TAB 6: CUSTOMERS */}
        {activeTab === 'customers' && (
          <div className="space-y-4">
            <div className="bg-white rounded-3xl border border-neutral-200 shadow-xs overflow-hidden">
              <div className="p-5 border-b border-neutral-100 flex items-center justify-between">
                <div>
                  <h2 className="font-black text-base text-neutral-900">Registered Customers</h2>
                  <p className="text-xs text-neutral-500">View all customer accounts and their order history</p>
                </div>
                <button onClick={fetchCustomersAndReviews} className="p-2 rounded-xl border border-neutral-200 hover:bg-neutral-50 cursor-pointer">
                  <RefreshCw className="w-4 h-4 text-neutral-600" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="p-4">Customer Name</th>
                      <th className="p-4">Phone</th>
                      <th className="p-4">Email</th>
                      <th className="p-4">Total Orders</th>
                      <th className="p-4">Total Spent</th>
                      <th className="p-4">Last Order</th>
                      <th className="p-4">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {customers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-neutral-400 text-xs font-semibold">
                          No registered customers found.
                        </td>
                      </tr>
                    ) : (
                      customers.map((customer) => (
                        <tr key={customer.id} className="hover:bg-neutral-50/80">
                          <td className="p-4 font-bold text-neutral-900">{customer.name}</td>
                          <td className="p-4 text-neutral-700">{customer.phone || 'N/A'}</td>
                          <td className="p-4 text-neutral-700">{customer.email || 'N/A'}</td>
                          <td className="p-4">
                            <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 font-bold">{customer.order_count || 0}</span>
                          </td>
                          <td className="p-4 font-black text-neutral-900">₹{(customer.total_spent || 0).toFixed(2)}</td>
                          <td className="p-4 text-neutral-600">
                            {formatDayDate(customer.last_order_date) || 'Never'}
                          </td>
                          <td className="p-4 text-neutral-500">
                            {formatDate(customer.created_at) || 'N/A'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 7: STAFF MANAGEMENT */}
        {activeTab === 'staff' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl border border-neutral-200 shadow-xs overflow-hidden">
              <div className="p-5 border-b border-neutral-100 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-black text-base text-neutral-900">Staff Management</h2>
                  <p className="text-xs text-neutral-500">Kitchen & Delivery Rider Access Control</p>
                </div>
                <button onClick={() => { setEditingStaff(null); setStaffSaveError(''); setIsStaffModalOpen(true); }} className="py-2.5 px-4 rounded-xl bg-[#e53935] text-white font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer">
                  <Plus className="w-4 h-4" /> Add Staff
                </button>
              </div>

              {/*
                Bulk bar. Appears only while something is ticked, so the table
                looks exactly as it did before selection existed.

                Your own account is never tickable. That is the safer half of the
                guard - it makes the accident impossible rather than refusing it -
                and the server refuses it independently, so Select All followed by
                Delete still cannot delete the admin who is doing it.
              */}
              {selectedStaffIds.length > 0 && (
                <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50 flex flex-wrap items-center gap-3">
                  <span className="text-xs font-black text-neutral-700">
                    {selectedStaffIds.length} selected
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      value={bulkRole}
                      onChange={(e) => setBulkRole(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl border border-neutral-200 bg-white text-xs font-bold text-neutral-700 outline-none"
                    >
                      <option value="">Set role…</option>
                      <option value="admin">Admin</option>
                      <option value="chef">Chef</option>
                      <option value="rider">Rider</option>
                    </select>
                    <button
                      onClick={() => handleBulkRole(selectedStaffIds, bulkRole)}
                      disabled={!bulkRole}
                      className="px-3 py-1.5 rounded-xl bg-neutral-100 font-bold text-xs disabled:opacity-40 cursor-pointer"
                    >
                      Edit
                    </button>
                  </div>
                  <button
                    onClick={() => handleBulkStatus(selectedStaffIds, false)}
                    className="px-3 py-1.5 rounded-xl bg-amber-50 text-amber-700 font-bold text-xs cursor-pointer"
                  >
                    Disable
                  </button>
                  <button
                    onClick={() => handleBulkDelete(selectedStaffIds)}
                    title="Permanently delete the selected staff"
                    className="px-3 py-1.5 rounded-xl bg-red-100 text-red-700 font-bold text-xs cursor-pointer"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => { setSelectedStaffIds([]); setBulkRole(''); }}
                    className="ml-auto px-3 py-1.5 rounded-xl text-xs font-bold text-neutral-500 hover:text-neutral-900 cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="p-4 w-10">
                        <input
                          type="checkbox"
                          checked={selectableStaffIds.length > 0 && selectableStaffIds.every(id => selectedStaffIds.includes(id))}
                          onChange={(e) => setSelectedStaffIds(e.target.checked ? selectableStaffIds : [])}
                          disabled={selectableStaffIds.length === 0}
                          title={selectableStaffIds.length === 0 ? 'Nobody to select' : 'Select all staff'}
                          aria-label="Select all staff"
                          className="w-4 h-4 accent-[#e53935] cursor-pointer disabled:opacity-40"
                        />
                      </th>
                      <th className="p-4">Name</th><th className="p-4">Mobile</th><th className="p-4">Email</th><th className="p-4">Role</th><th className="p-4">Status</th><th className="p-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {staff.map(member => {
                      const isSelf = member.id === user?.id;
                      const isSelected = selectedStaffIds.includes(member.id);
                      return (
                        <tr key={member.id} className={`hover:bg-neutral-50/80 ${isSelected ? 'bg-red-50/40' : ''}`}>
                          <td className="p-4">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={isSelf}
                              onChange={(e) => setSelectedStaffIds(prev => (
                                e.target.checked ? [...prev, member.id] : prev.filter(id => id !== member.id)
                              ))}
                              title={isSelf ? 'This is the account you are signed in with' : `Select ${member.name}`}
                              aria-label={`Select ${member.name}`}
                              className="w-4 h-4 accent-[#e53935] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            />
                          </td>
                          <td className="p-4 font-bold text-neutral-900">
                            {member.name}
                            {isSelf && <span className="ml-2 text-[10px] font-bold uppercase text-neutral-400">You</span>}
                          </td>
                          {/* Mobile is the column that matters: it is how this person signs in. */}
                          <td className="p-4 text-neutral-700">
                            {member.hasMobile ? `+91 ${member.mobile}` : <span className="text-red-600 font-semibold">No number on file</span>}
                          </td>
                          <td className="p-4 text-neutral-700">{member.email || '—'}</td>
                          <td className="p-4"><span className="px-2.5 py-1 rounded-full bg-neutral-100 font-bold uppercase text-[10px]">{member.role}</span></td>
                          <td className="p-4">
                            <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] uppercase ${
                              member.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                            }`}>{member.status === 'ACTIVE' ? 'Active' : 'Disabled'}</span>
                          </td>
                          <td className="p-4">
                            <div className="flex gap-2">
                              <button onClick={() => { setEditingStaff(member); setStaffSaveError(''); setIsStaffModalOpen(true); }} className="px-3 py-1.5 rounded-xl bg-neutral-100 font-bold cursor-pointer">Edit</button>
                              <button onClick={() => handleToggleStaff(member)} className="px-3 py-1.5 rounded-xl bg-red-50 text-red-700 font-bold cursor-pointer">{member.is_active ? 'Disable' : 'Enable'}</button>
                              <button
                                onClick={() => handleDeleteStaff(member)}
                                disabled={isSelf}
                                title={isSelf
                                  ? 'You cannot delete the account you are signed in with'
                                  : `Permanently delete ${member.name}`}
                                className="px-3 py-1.5 rounded-xl bg-red-100 text-red-700 font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'fleet' && <AdminRiderFleet />}

        {/* TAB 8: REVIEWS */}
        {activeTab === 'reviews' && (
          <div className="space-y-4">
            <div className="bg-white rounded-3xl border border-neutral-200 shadow-xs overflow-hidden">
              <div className="p-5 border-b border-neutral-100">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-black text-base text-neutral-900">Customer Reviews</h2>
                    <p className="text-xs text-neutral-500">Read feedback left by customers on completed orders</p>
                  </div>
                  <button onClick={fetchCustomersAndReviews} className="p-2 rounded-xl border border-neutral-200 hover:bg-neutral-50 cursor-pointer">
                    <RefreshCw className="w-4 h-4 text-neutral-600" />
                  </button>
                </div>

                {/* Rating + Date filters */}
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mr-1">Rating:</span>
                  {[
                    { value: 'all', label: 'All' },
                    { value: '5', label: '5 Stars' },
                    { value: '4', label: '4 Stars' },
                    { value: '3', label: '3 Stars' },
                    { value: '2', label: '2 Stars' },
                    { value: '1', label: '1 Star' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setReviewRatingFilter(opt.value)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                        reviewRatingFilter === opt.value
                          ? 'bg-[#e53935] text-white'
                          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mr-1">Date:</span>
                  {[
                    { value: 'all', label: 'All Time' },
                    { value: 'today', label: 'Today' },
                    { value: 'week', label: 'This Week' },
                    { value: 'month', label: 'This Month' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setReviewDateFilter(opt.value)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                        reviewDateFilter === opt.value
                          ? 'bg-[#e53935] text-white'
                          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={reviewSearch}
                    onChange={(e) => setReviewSearch(e.target.value)}
                    placeholder="Search by customer name, comment, or order ID..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-neutral-200 focus:border-[#e53935] outline-hidden transition"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-bold uppercase tracking-wider">
                    <tr>
<th className="p-4">Order</th>
                       <th className="p-4">Customer</th>
                       <th className="p-4">Rating</th>
                       <th className="p-4">Items</th>
                       <th className="p-4">Comment</th>
                       <th className="p-4">Date</th>
                       <th className="p-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filteredReviews.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-neutral-400 text-xs font-semibold">
                          {reviews.length === 0 ? 'No reviews found yet.' : 'No reviews match the current filter'}
                        </td>
                      </tr>
                    ) : (
                      filteredReviews.map((review) => (
                        <tr key={review.id} className="hover:bg-neutral-50/80">
                          <td className="p-4 font-mono font-bold text-neutral-900">#{review.order_number || review.order_id}</td>
                          <td className="p-4 text-neutral-700">{review.customer_name}</td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded-md font-bold ${
                              (review.rating || 0) >= 4 ? 'bg-emerald-100 text-emerald-800' :
                              (review.rating || 0) >= 3 ? 'bg-amber-100 text-amber-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {review.rating || 0}★
                            </span>
                          </td>
                          <td className="p-4 text-neutral-600 max-w-xs">
                             {(() => {
                               try {
                                 const items = JSON.parse(review.items_json || '[]');
                                 return items.map((i) => i.name_en || i.name || i.id).join(', ') || 'N/A';
                               } catch { return 'N/A'; }
                             })()}
                           </td>
                           <td className="p-4 text-neutral-600 max-w-xs truncate">{review.comment || 'No comment'}</td>
                          <td className="p-4 text-neutral-500">
                            {formatDate(review.created_at) || 'N/A'}
                          </td>
                          <td className="p-4 text-right">
                            <button
                              onClick={() => setViewingReview(review)}
                              className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-600 cursor-pointer transition"
                              title="View details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

{/* TAB: REPORTS */}
        {activeTab === 'reports' && (
          <div className="bg-white rounded-3xl border border-neutral-200 shadow-xs p-6 space-y-6">
            <h2 className="font-black text-lg text-neutral-900">Reports & Downloads</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold">Period</label>
                <select value={reportPeriod} onChange={e=>setReportPeriod(e.target.value)} className="w-full border rounded p-2">
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                  <option value="12m">Last 12 Months</option>
                  <option value="all">All Records</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold">Type</label>
                <select value={reportType} onChange={e=>setReportType(e.target.value)} className="w-full border rounded p-2">
                  <option value="revenue">Revenue Report</option>
                  <option value="orders">Order Report</option>
                  <option value="customers">Customer Report</option>
                  <option value="reviews">Review Report</option>
                  <option value="all">All Reports</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold">Format</label>
                <select value={reportFormat} onChange={e=>setReportFormat(e.target.value)} className="w-full border rounded p-2">
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="csv">CSV (.csv)</option>
                  <option value="pdf">PDF (.pdf)</option>
                </select>
              </div>
            </div>
            <button
              disabled={reportLoading}
              onClick={async () => {
                setReportLoading(true);
                try {
                  const res = await fetch(`${API_BASE}/reports/download?period=${reportPeriod}&type=${reportType}&format=${reportFormat === 'xlsx' ? 'excel' : reportFormat}`, { headers: { Authorization: `Bearer ${token}` } });
                  if (!res.ok) throw new Error('Failed');
                  const arrayBuffer = await res.arrayBuffer();
                  const blob = new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `hotel-darshan-report.${reportFormat === 'xlsx' ? 'xlsx' : reportFormat}`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) { alert(e.message); }
                finally { setReportLoading(false); }
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded"
            >
              {reportLoading ? 'Generating...' : 'Download Report'}
            </button>
            <button
              disabled={diagLoading}
              onClick={async () => {
                setDiagLoading(true);
                try {
                  const res = await fetch(`${API_BASE}/admin/diagnostics/payment-status`, { headers: { Authorization: `Bearer ${token}` } });
                  if (!res.ok) throw new Error('Failed');
                  setDiagData(await res.json());
                } catch (e) { alert(e.message); }
                finally { setDiagLoading(false); }
              }}
              className="px-4 py-2 bg-gray-700 text-white rounded"
            >
              {diagLoading ? 'Checking...' : 'Check Payment Diagnostics'}
            </button>
            {diagData && (
              <div className="mt-4 text-sm">
                <p>DB Path: {diagData.dbPath}</p>
                <p>HOTEL_DARSHAN_DB configured: {String(diagData.hotelDarshanDbConfigured)}</p>
                <p>Total Orders: {diagData.totalOrders}</p>
                <p>Payment Status Counts: {JSON.stringify(diagData.paymentStatusCounts)}</p>
                <table className="w-full mt-2 border">
                  <thead><tr><th>Order</th><th>Status</th><th>Method</th><th>Payment</th><th>Total</th></tr></thead>
                  <tbody>
                    {diagData.orders.map((o, i) => (
                      <tr key={i}><td>{o.order_number}</td><td>{o.status}</td><td>{o.payment_method}</td><td>{o.payment_status}</td><td>{o.grand_total}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 9: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl bg-white rounded-3xl border border-neutral-200 shadow-xs p-6 space-y-6">
            <h2 className="font-black text-lg text-neutral-900">Hotel Darshan Settings</h2>
            <div className="space-y-5 text-xs">

              {/* Delivery radius */}
              <div>
                <label className="font-bold text-neutral-700 block mb-1">Maximum Delivery Distance (km)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    value={maxDeliveryKmInput}
                    onChange={(e) => setMaxDeliveryKmInput(e.target.value)}
                    className="w-32 p-2.5 rounded-xl border border-neutral-200 font-bold outline-none focus:border-[#e53935]"
                  />
                  <span className="font-bold text-neutral-500">km</span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-1.5 leading-snug">
                  Home Delivery is allowed only within this radius of Hotel Darshan. Self Pickup is never restricted by distance.
                </p>
              </div>

              {/* Distance slabs */}
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="font-bold text-neutral-700">Delivery Charges</label>
                  <button
                    onClick={addDeliverySlab}
                    className="px-2.5 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-[11px] font-bold text-neutral-700 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Slab
                  </button>
                </div>

                <div className="rounded-2xl border border-neutral-200 overflow-hidden">
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-neutral-50 border-b border-neutral-200 text-[10px] font-black uppercase tracking-wider text-neutral-500">
                    <div className="col-span-5">Distance Range</div>
                    <div className="col-span-4">Delivery Charge (₹)</div>
                    <div className="col-span-3 text-right">Action</div>
                  </div>

                  {deliverySlabsInput.length === 0 && (
                    <p className="px-3 py-4 text-[11px] text-neutral-500">No slabs yet. Add one to start charging by distance.</p>
                  )}

                  {deliverySlabsInput.map((slab, index) => {
                    const previousMax = index === 0 ? 0 : Number(deliverySlabsInput[index - 1]?.maxKm) || 0;
                    return (
                      <div key={index} className="grid grid-cols-12 gap-2 px-3 py-2.5 border-b border-neutral-100 last:border-0 items-center">
                        <div className="col-span-5 flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={slab.maxKm}
                            onChange={(e) => updateDeliverySlab(index, 'maxKm', e.target.value)}
                            className="w-16 p-2 rounded-lg border border-neutral-200 font-bold text-center outline-none focus:border-[#e53935]"
                          />
                          <span className="text-[10px] font-bold text-neutral-500 whitespace-nowrap">km</span>
                        </div>
                        <div className="col-span-4 flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-neutral-400">₹</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={slab.fee}
                            onChange={(e) => updateDeliverySlab(index, 'fee', e.target.value)}
                            className="w-20 p-2 rounded-lg border border-neutral-200 font-bold text-center outline-none focus:border-[#e53935]"
                          />
                        </div>
                        <div className="col-span-3 flex justify-end">
                          <button
                            onClick={() => removeDeliverySlab(index)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-neutral-400 hover:text-red-600 cursor-pointer"
                            aria-label={`Remove slab ${index + 1}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="col-span-12 -mt-0.5">
                          <p className="text-[10px] text-neutral-500">
                            {previousMax}–{slab.maxKm} km → ₹{slab.fee}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-neutral-500 mt-1.5 leading-snug">
                  Slabs are applied in ascending order. A distance beyond the last slab is charged that last slab's fee, up to the maximum distance above.
                </p>
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Free Delivery Threshold (₹)</label>
                <input type="number" value={settings.free_delivery_above || '499'} onChange={(e) => setSettings({ ...settings, free_delivery_above: e.target.value })} className="w-full p-2.5 rounded-xl border border-neutral-200 font-bold outline-none focus:border-[#e53935]" />
                <p className="text-[10px] text-neutral-500 mt-1.5 leading-snug">
                  Orders at or above this amount are not charged a delivery fee. Set to 0 to always charge.
                </p>
              </div>

              <button disabled={settingsSaving} onClick={saveDeliverySettings} className="w-full py-3 rounded-2xl bg-[#e53935] text-white font-bold text-xs shadow-md cursor-pointer">
                {settingsSaving ? 'Saving Settings…' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}
      </main>

      {isCategoryModalOpen && <CategoryEditorModal category={editingCategory} onClose={() => { setIsCategoryModalOpen(false); setEditingCategory(null); }} onSave={handleSaveCategory} />}
      {isCouponModalOpen && <CouponEditorModal coupon={editingCoupon} onClose={() => { setIsCouponModalOpen(false); setEditingCoupon(null); }} onSave={handleSaveCoupon} />}
      {isStaffModalOpen && <StaffEditorModal staff={editingStaff} serverError={staffSaveError} onClose={() => { setIsStaffModalOpen(false); setEditingStaff(null); setStaffSaveError(''); }} onSave={handleSaveStaff} isSaving={savingStaff} />}
      {isItemModalOpen && <ItemEditorModal item={editingItem} categories={categories} onClose={() => { setIsItemModalOpen(false); setEditingItem(null); }} onSave={handleSaveItem} />}
      {profileModalOpen && <AdminProfileModal user={user} onClose={() => setProfileModalOpen(false)} onSave={updateUserProfile} />}
      {appearanceModalOpen && (
        <AppearanceModal
          theme={adminTheme || 'light'}
          onSelect={(next) => setAdminTheme && setAdminTheme(next)}
          onClose={() => setAppearanceModalOpen(false)}
        />
      )}
    </div>
  </div>
);
}

// Modal Component Implementations

// Admin account details. Reuses the existing PUT /api/auth/profile route through
// AuthContext.updateUserProfile, so there is no second user system: the same
// validation, uniqueness checks and persistence the customer profile uses apply.
function AdminProfileModal({ user, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    name: user?.name || '',
    // Stored phones may carry a +91 prefix; the field shows the local 10 digits
    // under its own +91 badge and the server normalises it on save.
    phone: String(user?.phone || '').replace(/\D/g, '').slice(-10),
    email: user?.email || ''
  }));
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError('');
    setSuccess('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.name.trim()) {
      setError('Please enter your name');
      return;
    }
    // Same rule the server enforces, checked here for immediate feedback.
    if (form.phone && !/^([6789])\d{9}$/.test(form.phone.replace(/\D/g, '').slice(-10))) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }

    setSaving(true);
    try {
      const saved = await onSave({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim()
      });
      if (saved) {
        setSuccess('Profile updated successfully');
        setTimeout(onClose, 700);
      }
    } catch (err) {
      setError(err.message || 'Unable to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-neutral-900/50 flex items-center justify-center p-4 z-[100]">
      <form onSubmit={submit} className="w-full max-w-md bg-white rounded-3xl border border-neutral-200 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-black text-neutral-900">Profile Settings</h3>
            <p className="text-[11px] text-neutral-500 truncate">Your account information</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-neutral-100 text-neutral-500 cursor-pointer shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{error}</div>}
          {success && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">{success}</div>}
          <label className="block text-xs font-bold text-neutral-700">
            Full Name
            <input value={form.name} onChange={(e) => update('name', e.target.value)} className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm font-medium outline-none focus:border-[#e53935]" placeholder="Your name" required />
          </label>
          <label className="block text-xs font-bold text-neutral-700">
            Mobile Number
            <div className="flex items-center mt-1.5">
              <span className="px-3 py-2.5 rounded-l-xl border border-r-0 border-neutral-200 bg-neutral-50 text-xs font-bold text-neutral-600">+91</span>
              <input value={form.phone} onChange={(e) => update('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" className="flex-1 px-4 py-2.5 rounded-r-xl border border-neutral-200 text-sm font-medium outline-none focus:border-[#e53935]" placeholder="10-digit mobile number" />
            </div>
          </label>
          <label className="block text-xs font-bold text-neutral-700">
            Email Address
            <input value={form.email} onChange={(e) => update('email', e.target.value)} type="email" className="mt-1.5 w-full px-4 py-2.5 rounded-xl border border-neutral-200 text-sm font-medium outline-none focus:border-[#e53935]" placeholder="you@example.com" />
          </label>
          <p className="text-[10px] text-neutral-400 leading-snug">
            Used for staff sign-in and order updates. Changing these details does not affect your role or permissions.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-neutral-100 flex gap-3 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-xs font-bold text-neutral-600 hover:bg-neutral-100 cursor-pointer">Cancel</button>
          <button disabled={saving} className="px-5 py-2.5 rounded-xl bg-[#e53935] hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold cursor-pointer">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

// Light / Dark / System. Writes the shared admin theme preference, which is
// persisted per device, so the choice survives a refresh.
function AppearanceModal({ theme, onSelect, onClose }) {
  const options = [
    { id: 'light', label: 'Light', hint: 'Always use the light appearance', preview: 'bg-white border-neutral-200' },
    { id: 'dark', label: 'Dark', hint: 'Always use the dark appearance', preview: 'bg-neutral-900 border-neutral-700' },
    { id: 'system', label: 'System / Default', hint: 'Follow this device setting', preview: 'bg-gradient-to-r from-white to-neutral-900' }
  ];

  return (
    <div className="fixed inset-0 bg-neutral-900/50 flex items-center justify-center p-4 z-[100]">
      <div className="w-full max-w-md bg-white rounded-3xl border border-neutral-200 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-black text-neutral-900">Appearance</h3>
            <p className="text-[11px] text-neutral-500 truncate">Choose how the Admin dashboard looks</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-neutral-100 text-neutral-500 cursor-pointer shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-2.5" role="radiogroup" aria-label="Admin appearance">
          {options.map((option) => {
            const selected = theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelect(option.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition cursor-pointer ${
                  selected ? 'border-[#e53935] bg-[#e53935]/[0.06]' : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                <span className={`w-10 h-10 rounded-xl border-2 shrink-0 ${option.preview}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs font-bold ${selected ? 'text-[#e53935]' : 'text-neutral-900'}`}>{option.label}</span>
                  <span className="block text-[10px] text-neutral-500 truncate">{option.hint}</span>
                </span>
                {selected && <CheckCircle2 className="w-5 h-5 text-[#e53935] shrink-0" />}
              </button>
            );
          })}
        </div>
        <div className="px-6 py-4 border-t border-neutral-100 flex justify-end">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-[#e53935] hover:bg-red-700 text-white text-xs font-bold cursor-pointer">Done</button>
        </div>
      </div>
    </div>
  );
}

function StaffEditorModal({ staff, serverError = '', onClose, onSave, isSaving }) {
  const [form, setForm] = useState(() => ({
    name: staff?.name || '',
    // The normalised 10 digits, not the raw column: the server stores one form and
    // the +91 prefix would be re-added on save if it were left in the field.
    mobile: String(staff?.mobile || '').replace(/\D/g, '').slice(-10),
    email: staff?.email || '',
    role: staff?.role || 'chef',
    // Only the owner account has a password. Everyone else signs in with a code
    // sent to their number, so asking an admin to invent one for a chef would be
    // collecting a secret that is never checked.
    password: '',
    is_active: staff ? Boolean(staff.is_active) : true
  }));
  const [error, setError] = useState('');
  const update = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setError('');
  };
  const submit = (e) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) {
      setError('Please enter the staff name');
      return;
    }
    if (!form.mobile.trim()) {
      setError('Please enter the mobile number they sign in with');
      return;
    }
    // The same rule the server enforces, checked here so the person filling this
    // in is told straight away rather than after a round trip.
    if (!/^[6-9]\d{9}$/.test(form.mobile.trim())) {
      setError('Please enter a valid 10-digit Indian mobile number');
      return;
    }
    if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setError('Please enter a valid email address');
      return;
    }
    if (form.password && form.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    onSave({
      ...form,
      name: form.name.trim(),
      mobile: form.mobile.trim(),
      email: form.email.trim().toLowerCase()
    });
  };  const isOwner = form.role === 'admin';
  return (
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-lg bg-white rounded-3xl p-6 space-y-6 shadow-2xl">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-black text-neutral-900">{staff ? 'Edit Staff Account' : 'Add Staff Account'}</h2>
            <p className="text-xs text-neutral-500 mt-1">
              {staff ? 'Update staff details and role' : 'Create a new staff account for the team'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-2xl text-neutral-400 hover:text-neutral-600">×</button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-start gap-2">
            <span className="text-red-500 font-bold shrink-0">!</span>
            <span>{error}</span>
          </div>
        )}

        {/* A refusal from the server, kept in the dialog rather than only in a
            toast. A duplicate number, a taken email or a validation failure
            arrives with the form still open, so the reason has to be on screen
            with the fields that caused it. */}
        {serverError && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-start gap-2">
            <span className="text-red-500 font-bold shrink-0">!</span>
            <span>{serverError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs font-bold text-neutral-700">
            Full Name *
            <input
              required
              value={form.name}
              onChange={e => update('name', e.target.value)}
              className="mt-1 w-full p-2.5 rounded-xl border border-neutral-200 outline-none focus:border-[#e53935]"
              placeholder="Staff name"
            />
          </label>
          <label className="text-xs font-bold text-neutral-700">
            Mobile Number *
            <div className="flex items-center mt-1">
              <span className="px-2.5 py-2.5 rounded-l-xl border border-r-0 border-neutral-200 bg-neutral-50 text-[11px] font-bold text-neutral-600">+91</span>
              <input
                required
                value={form.mobile}
                onChange={(e) => {
                  const next = sanitizePhoneInput(e.target.value);
                  if (e.target.value !== next) e.target.value = next;
                  update('mobile', next);
                }}
                inputMode="numeric"
                className="w-full p-2.5 rounded-r-xl border border-neutral-200 outline-none focus:border-[#e53935]"
                placeholder="98765 43210"
              />
            </div>
          </label>
        </div>

        <label className="text-xs font-bold text-neutral-700 block">
          Email Address
          <input
            type="email"
            value={form.email}
            onChange={e => update('email', e.target.value)}
            className="mt-1 w-full p-2.5 rounded-xl border border-neutral-200 outline-none focus:border-[#e53935]"
            placeholder="Optional"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs font-bold text-neutral-700">
            Role *
            <select
              value={form.role}
              onChange={e => update('role', e.target.value)}
              className="mt-1 w-full p-2.5 rounded-xl border border-neutral-200 outline-none focus:border-[#e53935] bg-white cursor-pointer"
            >
              <option value="chef">Chef (Kitchen)</option>
              <option value="rider">Delivery Rider</option>
              <option value="admin">Admin (Owner)</option>
            </select>
          </label>
        {isOwner && (
          <label className="text-xs font-bold text-neutral-700">
            {staff ? 'New Password (leave blank to keep current)' : 'Password'}
            <input
              type="password"
              value={form.password}
              onChange={e => update('password', e.target.value)}
              className="mt-1 w-full p-2.5 rounded-xl border border-neutral-200 outline-none focus:border-[#e53935]"
              placeholder="Min 6 characters"
            />
          </label>
        )}
        {!isOwner && (
          <label className="text-xs font-bold text-neutral-700">
            Status *
            <select
              value={form.is_active ? 'active' : 'disabled'}
              onChange={e => update('is_active', e.target.value === 'active')}
              className="mt-1 w-full p-2.5 rounded-xl border border-neutral-200 outline-none focus:border-[#e53935] bg-white cursor-pointer"
            >
              <option value="active">Active - can sign in</option>
              <option value="disabled">Disabled - cannot sign in</option>
            </select>
          </label>
        )}
        </div>

        <p className="text-[11px] text-neutral-500 leading-relaxed">
          {isOwner
            ? 'The owner can sign in with this password as well as a code. The number above is still how the account is identified.'
            : 'This person signs in with a one-time code sent to their mobile number. There is no password to set or share.'}
        </p>

        {staff && (
          <label className="flex items-center gap-2 text-xs font-bold text-neutral-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => update('is_active', e.target.checked)}
              className="w-4 h-4 rounded border-neutral-300 text-[#e53935] focus:ring-[#e53935]"
            />
            Account is Active
          </label>
        )}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={isSaving} className="flex-1 py-3 rounded-xl bg-neutral-100 hover:bg-neutral-200 font-bold text-sm text-neutral-700 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="flex-1 py-3 rounded-xl bg-[#e53935] hover:bg-red-700 text-white font-black text-sm transition cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
            {isSaving ? (staff ? 'Saving Changes...' : 'Saving Staff...') : (staff ? 'Save Changes' : 'Save Staff')}
          </button>
        </div>
      </form>
    </div>
  );
}

function CategoryEditorModal({ category, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ name_en: category?.name_en || '', name_hi: category?.name_hi || '', name_gu: category?.name_gu || '', image_url: category?.image_url || '', sort_order: category?.sort_order || 0, is_active: category ? Boolean(category.is_active) : true }));
  const update=(k,v)=>setForm(p=>({...p,[k]:v}));
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
      <form onSubmit={e=>{e.preventDefault(); onSave({...form,sort_order:Number(form.sort_order)})}} className="w-full max-w-lg bg-white rounded-3xl p-6 space-y-4 shadow-2xl">
        <div className="flex justify-between"><div><h2 className="text-xl font-black">{category?'Edit Category':'Add Category'}</h2></div><button type="button" onClick={onClose} className="text-2xl">×</button></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs font-bold">English<input required value={form.name_en} onChange={e=>update('name_en',e.target.value)} className="mt-1 w-full p-2.5 rounded-xl border" /></label>
        </div>
        <div className="flex gap-2"><button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl bg-neutral-100 font-bold">Cancel</button><button className="flex-1 py-3 rounded-xl bg-[#e53935] text-white font-black">Save Category</button></div>
      </form>
    </div>
  );
}

function CouponEditorModal({ coupon, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    code: coupon?.code || '',
    discount_type: coupon?.discount_type || 'percentage',
    discount_value: coupon?.discount_value ?? '',
    min_order_value: coupon?.min_order_value ?? 0,
    max_discount: coupon?.max_discount ?? '',
    valid_to: coupon?.valid_to ? coupon.valid_to.slice(0, 10) : '2027-12-31',
    usage_limit: coupon?.usage_limit ?? 500,
    is_active: coupon ? Boolean(coupon.is_active) : true
  }));

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.code.trim() || form.discount_value === '') return;
    onSave({
      ...form,
      code: form.code.trim().toUpperCase(),
      discount_value: Number(form.discount_value),
      min_order_value: Number(form.min_order_value) || 0,
      max_discount: form.max_discount ? Number(form.max_discount) : null,
      usage_limit: Number(form.usage_limit) || 500,
      is_active: form.is_active ? 1 : 0
    });
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-2xl bg-white rounded-3xl p-6 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black text-neutral-900">
            {coupon ? 'Edit Offer' : 'Add New Offer'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-neutral-100 text-neutral-500 hover:text-neutral-700 flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Offer Code */}
        <div>
          <label className="block text-xs font-bold text-neutral-700 mb-1">
            Offer Code *
          </label>
          <input
            required
            value={form.code}
            onChange={(e) => update('code', e.target.value)}
            className="w-full p-3 rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden text-sm font-mono uppercase"
            placeholder="e.g. FREESHIP"
          />
        </div>

        {/* Discount Type + Value */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Discount Type *
            </label>
            <div className="grid grid-cols-2 gap-1 p-1 bg-neutral-100 rounded-xl">
              <button
                type="button"
                onClick={() => update('discount_type', 'percentage')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition ${
                  form.discount_type === 'percentage'
                    ? 'bg-[#e53939] text-white shadow'
                    : 'text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                Percentage
              </button>
              <button
                type="button"
                onClick={() => update('discount_type', 'flat')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition ${
                  form.discount_type === 'flat'
                    ? 'bg-[#e53939] text-white shadow'
                    : 'text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                Flat Amount
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Discount Value *
            </label>
            <input
              required
              type="number"
              min="0"
              value={form.discount_value}
              onChange={(e) => update('discount_value', e.target.value)}
              className="w-full p-3 rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden text-sm"
              placeholder="e.g. 50"
            />
            <p className="text-[10px] text-neutral-500 mt-0.5">
              {form.discount_type === 'percentage' ? 'Enter % discount' : 'Enter ₹ amount'}
            </p>
          </div>
        </div>

        {/* Min Order + Max Discount */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Minimum Order (₹)
            </label>
            <input
              type="number"
              min="0"
              value={form.min_order_value}
              onChange={(e) => update('min_order_value', e.target.value)}
              className="w-full p-3 rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden text-sm"
              placeholder="0"
            />
            <p className="text-[10px] text-neutral-500 mt-0.5">Leave 0 for no minimum</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Max Discount (₹) {form.discount_type === 'flat' && '(N/A)'}
            </label>
            <input
              type="number"
              min="0"
              value={form.max_discount}
              onChange={(e) => update('max_discount', e.target.value)}
              className="w-full p-3 rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden text-sm"
              placeholder="e.g. 100"
              disabled={form.discount_type === 'flat'}
            />
            <p className="text-[10px] text-neutral-500 mt-0.5">
              {form.discount_type === 'flat' ? 'Not applicable for flat rate' : 'Cap for percentage discount'}
            </p>
          </div>
        </div>

        {/* Expiry + Usage Limit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Expiry Date *
            </label>
            <input
              required
              type="date"
              value={form.valid_to}
              onChange={(e) => update('valid_to', e.target.value)}
              className="w-full p-3 rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Usage Limit
            </label>
            <input
              type="number"
              min="0"
              value={form.usage_limit}
              onChange={(e) => update('usage_limit', e.target.value)}
              className="w-full p-3 rounded-xl border border-neutral-200 focus:border-[#e53939] outline-hidden text-sm"
              placeholder="e.g. 500"
            />
            <p className="text-[10px] text-neutral-500 mt-0.5">
              {coupon && `Used: ${coupon.used_count || 0}/${coupon.usage_limit || 500}`}
            </p>
          </div>
        </div>

        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-neutral-50 border border-neutral-200">
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-0.5">
              Coupon Status
            </label>
            <p className="text-xs text-neutral-500">
              {form.is_active ? 'Active — customers can use this offer' : 'Disabled — hidden from customer view'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => update('is_active', !form.is_active)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
              form.is_active ? 'bg-emerald-500' : 'bg-neutral-400'
            }`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
              form.is_active ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        {/* Footer */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-sm transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 py-3 px-4 rounded-xl bg-[#e53939] hover:bg-[#d32f2f] text-white font-black text-sm transition cursor-pointer"
          >
            {coupon ? 'Update Offer' : 'Save Offer'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ItemEditorModal({ item, categories, onClose, onSave }) {
  const availableImages = Object.entries(foodImagesByName)
    .map(([name, path]) => ({ name, path }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const [form, setForm] = useState(() => ({
    category_id: item?.category_id || categories[0]?.id || 1,
    name_en: item?.name_en || '',
    name_hi: item?.name_hi || item?.name_en || '',
    name_gu: item?.name_gu || item?.name_en || '',
    desc_en: item?.desc_en || '',
    desc_hi: item?.desc_hi || '',
    desc_gu: item?.desc_gu || '',
    price: item?.price ?? '',
    discount_price: item?.discount_price ?? '',
    is_veg: item?.is_veg !== undefined ? Boolean(item.is_veg) : true,
    prep_time_mins: item?.prep_time_mins ?? 15,
    image_url: resolveFoodImage(item),
    is_available: item ? Boolean(item.is_available) : true,
    available_qty: item?.available_qty ?? 50,
    is_popular: Boolean(item?.is_popular),
    is_special: Boolean(item?.is_special)
  }));
  const [imagePreview, setImagePreview] = useState(resolveFoodImage(item));
  const [error, setError] = useState('');

  const update = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleImageChange = (e) => {
    const val = e.target.value;
    update('image_url', val);
    setImagePreview(val);
  };

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (!form.name_en.trim() || !form.price) {
      setError('Please enter a food name and price.');
      return;
    }
    onSave({
      ...form,
      price: Number(form.price),
      category_id: Number(form.category_id),
      discount_price: form.discount_price ? Number(form.discount_price) : null,
      is_veg: form.is_veg,
      is_available: form.is_available,
      is_popular: form.is_popular,
      is_special: form.is_special,
      available_qty: Number(form.available_qty),
      prep_time_mins: Number(form.prep_time_mins)
    });
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-50 text-[#e53939]">
              {item ? <Edit2 className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-xl font-black text-neutral-900">
                {item ? 'Edit Food Item' : 'Add New Food Item'}
              </h2>
              <p className="text-xs text-neutral-500">
                {item ? 'Update this item\'s details across all fields' : 'Create a new dish for your menu'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-neutral-200 text-neutral-500 hover:text-neutral-700 flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body - scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* SECTION 1: Basic Info */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 flex items-center gap-2">
              <Layers className="w-3.5 h-3.5" />
              <span>Basic Information</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Category */}
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-neutral-700 block mb-1">
                  Category *
                </label>
                <div className="relative">
                  <Layers className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <select
                    value={form.category_id}
                    onChange={(e) => update('category_id', e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden cursor-pointer"
                    required
                  >
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name_en} {cat.name_hi ? `(${cat.name_hi})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Food Name EN */}
              <div>
                <label className="text-xs font-bold text-neutral-700 block mb-1">
                  Food Name (English) *
                </label>
                <input
                  type="text"
                  value={form.name_en}
                  onChange={(e) => update('name_en', e.target.value)}
                  className="w-full p-2.5 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden"
                  placeholder="e.g. Paneer Butter Masala"
                  required
                />
              </div>

              {/* Food Name HI */}
              <div>
                <label className="text-xs font-bold text-neutral-700 block mb-1">
                  Food Name (Hindi)
                </label>
                <input
                  type="text"
                  value={form.name_hi}
                  onChange={(e) => update('name_hi', e.target.value)}
                  className="w-full p-2.5 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden"
                  placeholder="पनीर बटर मसाला"
                />
              </div>

              {/* Food Name GU */}
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-neutral-700 block mb-1">
                  Food Name (Gujarati)
                </label>
                <input
                  type="text"
                  value={form.name_gu}
                  onChange={(e) => update('name_gu', e.target.value)}
                  className="w-full p-2.5 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden"
                  placeholder="પનીર બટર મસાલા"
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: Description */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" />
              <span>Description</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-neutral-700 block mb-1">
                  Description (English)
                </label>
                <textarea
                  value={form.desc_en}
                  onChange={(e) => update('desc_en', e.target.value)}
                  className="w-full p-2.5 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden"
                  placeholder="Write a short, enticing description..."
                  rows="3"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-neutral-700 block mb-1">
                  Description (Hindi)
                </label>
                <textarea
                  value={form.desc_hi}
                  onChange={(e) => update('desc_hi', e.target.value)}
                  className="w-full p-2.5 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden"
                  placeholder="एक आकर्षक विवरण लिखें..."
                  rows="3"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-neutral-700 block mb-1">
                  Description (Gujarati)
                </label>
                <textarea
                  value={form.desc_gu}
                  onChange={(e) => update('desc_gu', e.target.value)}
                  className="w-full p-2.5 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden"
                  placeholder="એક આકર્ષક વર્ણન લખો..."
                  rows="2"
                />
              </div>
            </div>
          </div>

          {/* SECTION 3: Pricing & Type */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5" />
              <span>Pricing & Type</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-bold text-neutral-700 block mb-1">
                  Price (₹) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.price}
                  onChange={(e) => update('price', e.target.value)}
                  className="w-full p-2.5 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden font-bold"
                  placeholder="0"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold text-neutral-700 block mb-1">
                  Discount Price (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.discount_price}
                  onChange={(e) => update('discount_price', e.target.value)}
                  className="w-full p-2.5 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden"
                  placeholder="0 (optional)"
                />
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_veg}
                    onChange={(e) => update('is_veg', e.target.checked)}
                    className="w-4 h-4 rounded border-neutral-300 text-[#e53939] focus:ring-[#e53939]"
                  />
                  <span className="text-xs font-bold text-neutral-700">
                    Pure Vegetarian
                  </span>
                </label>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Prep Time (minutes)
              </label>
              <input
                type="number"
                min="1"
                max="120"
                value={form.prep_time_mins}
                onChange={(e) => update('prep_time_mins', e.target.value)}
                className="w-20 p-2 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden font-bold"
              />
            </div>
          </div>

          {/* SECTION 4: Food Image */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 flex items-center gap-2">
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Food Image</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Image Preview */}
              <div className="flex items-center justify-center">
                {imagePreview ? (
                  <div className="relative w-40 h-40">
                    <FoodImage
                      src={imagePreview}
                      alt={form.name_en || 'Food item preview'}
                      className="w-40 h-40 rounded-2xl object-cover border-2 border-neutral-200 shadow-sm"
                    />
                    {form.is_veg !== undefined && (
                      <span className={`absolute bottom-2 right-2 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center shadow ${
                        form.is_veg ? 'bg-emerald-600' : 'bg-red-600'
                      }`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-white"></span>
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="w-40 h-40 rounded-2xl border-2 border-dashed border-neutral-200 flex items-center justify-center text-neutral-400">
                    <ImageIcon className="w-8 h-8" />
                  </div>
                )}
              </div>

              {/* Image Selector */}
              <div>
                <label className="text-xs font-bold text-neutral-700 block mb-1">
                  Select from existing images
                </label>
                <div className="relative">
                  <select
                    value={form.image_url}
                    onChange={handleImageChange}
                    className="w-full p-2.5 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden cursor-pointer"
                  >
                    <option value="">— Select an image —</option>
                    {availableImages.map(img => (
                      <option key={img.path} value={img.path}>
                        {img.name}
                      </option>
                    ))}
                  </select>
                </div>

                {form.image_url && (
                  <p className="text-[10px] text-neutral-500 mt-1 break-all">
                    Path: {form.image_url}
                  </p>
                )}

                {!form.image_url && (
                  <p className="text-[10px] text-neutral-400 mt-1">
                    Images are sourced from existing FoodImages folder.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* SECTION 5: Availability */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Availability & Visibility</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_available}
                    onChange={(e) => update('is_available', e.target.checked)}
                    className="w-4 h-4 rounded border-neutral-300 text-[#e53939] focus:ring-[#e53939]"
                  />
                  <span>Item is available</span>
                </label>
              </div>

              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_special}
                    onChange={(e) => update('is_special', e.target.checked)}
                    className="w-4 h-4 rounded border-neutral-300 text-[#e53939] focus:ring-[#e53939]"
                  />
                  <span>Mark as Special</span>
                </label>
              </div>

              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-neutral-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_popular}
                    onChange={(e) => update('is_popular', e.target.checked)}
                    className="w-4 h-4 rounded border-neutral-300 text-[#e53939] focus:ring-[#e53939]"
                  />
                    <span>Mark as Popular</span>
                </label>
              </div>

              <div>
                <label className="text-xs font-bold text-neutral-700 block mb-1">
                  Stock Quantity
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.available_qty}
                  onChange={(e) => update('available_qty', e.target.value)}
                  className="w-full p-2.5 bg-neutral-50 text-xs rounded-xl border border-neutral-200 focus:bg-white focus:border-[#e53939] outline-hidden font-bold text-center"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Action Buttons */}
        <div className="px-6 py-4 border-t border-neutral-200 bg-neutral-50/80 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-neutral-100 hover:bg-neutral-200 font-bold text-sm text-neutral-700 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 py-3 rounded-xl bg-[#e53939] hover:bg-[#d32f2f] text-white font-black text-sm transition shadow-md cursor-pointer active:scale-98"
          >
            {item ? 'Update Food Item' : 'Save Food Item'}
          </button>
        </div>
      </form>
    </div>
  );
}

function OrderDetailsModal({ order, onClose, onUpdateStatus }) {
  if (!order) return null;
  const address = order.address || {};
  const items = order.items || [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-neutral-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-neutral-900">Order Details</h2>
            <p className="text-xs text-neutral-500">#{order.order_number || order.id}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-neutral-100 cursor-pointer">
            <X className="w-5 h-5 text-neutral-500" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 mb-2">Customer</h3>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#e53935]/10 text-[#e53935] flex items-center justify-center font-bold">
                {(order.customer_name || 'W').charAt(0)}
              </div>
              <div>
                <p className="font-bold text-neutral-900">{order.customer_name || 'Walk-in Customer'}</p>
                <p className="text-xs text-neutral-500">{order.customer_phone || 'No phone'}</p>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Delivery Address
            </h3>
            <p className="text-sm text-neutral-700">
              {address.street || address.address || 'Char Rasta, Mosda Road, Dediapada, Gujarat - 393040'}
              {address.landmark && <><br /><span className="text-neutral-500">Landmark: {address.landmark}</span></>}
              {address.city && <><br /><span className="text-neutral-500">{address.city}</span></>}
              {order.special_instructions && <><br /><span className="text-neutral-500">Instructions: {order.special_instructions}</span></>}
            </p>
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" /> Payment
            </h3>
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-700 capitalize">{order.payment_method || 'COD'}</span>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${order.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {order.payment_status || 'Pending'}
              </span>
            </div>
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-neutral-400 mb-2">Items</h3>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-neutral-700">{it.quantity || 1}x {it.name_en || it.name}</span>
                  <span className="font-bold text-neutral-900">Rs.{(it.item_total_price ?? (it.unit_price * (it.quantity || 1)))}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-neutral-200 pt-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-neutral-600"><span>Item Total</span><span>Rs.{order.item_total || 0}</span></div>
            {order.discount_amount > 0 && <div className="flex justify-between text-emerald-700"><span>Discount</span><span>-Rs.{order.discount_amount}</span></div>}
            {order.delivery_distance_km != null && <div className="flex justify-between text-neutral-600"><span>Delivery Distance</span><span>{Number(order.delivery_distance_km).toFixed(2)} km</span></div>}
    {order.delivery_fee > 0 && <div className="flex justify-between text-neutral-600"><span>Delivery Fee</span><span>Rs.{order.delivery_fee}</span></div>}
            <div className="flex justify-between text-neutral-600"><span>Tax</span><span>Rs.{order.tax_amount || 0}</span></div>
            <div className="flex justify-between font-black text-base text-neutral-900 pt-2 border-t"><span>Grand Total</span><span className="text-[#e53939]">Rs.{order.grand_total || 0}</span></div>
          </div>
          <div className="border-t border-neutral-200 pt-4 grid grid-cols-2 gap-3 text-xs">
            <div><span className="text-neutral-400">Type:</span> <span className="font-bold text-neutral-700 capitalize">{order.order_type}</span></div>
            <div><span className="text-neutral-400">Tip:</span> <span className="font-bold text-neutral-700">Rs.{order.tip_amount || 0}</span></div>
            <div><span className="text-neutral-400">Created:</span> <span className="font-bold text-neutral-700">{formatDateTime(order.created_at) || '—'} IST</span></div>
            <div><span className="text-neutral-400">Updated:</span> <span className="font-bold text-neutral-700">{formatDateTime(order.updated_at) || '—'} IST</span></div>
          </div>
          <div className="border-t border-neutral-200 pt-4 flex gap-3">
            <select
              value={order.status || 'ORDER_PLACED'}
              onChange={(e) => onUpdateStatus(order.id, e.target.value)}
              className="flex-1 p-2.5 bg-neutral-100 rounded-lg text-xs font-semibold border border-neutral-200 outline-none cursor-pointer"
            >
              {order.order_type === 'pickup' ? (
                <>
                  <option value="ORDER_PLACED">Order Placed</option>
                  <option value="PREPARING">Preparing</option>
                  <option value="READY_FOR_PICKUP">Ready for Pickup</option>
                  <option value="PICKED_UP">Picked Up</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancel Order</option>
                </>
              ) : (
                <>
                  <option value="ORDER_PLACED">Order Placed</option>
                  <option value="ORDER_CONFIRMED">Order Confirmed</option>
                  <option value="PREPARING">Preparing</option>
                  <option value="READY">Food Ready</option>
                  <option value="OUT_FOR_DELIVERY">Out for Delivery</option>
                  <option value="DELIVERED">Delivered</option>
                  <option value="CANCELLED">Cancel Order</option>
                </>
              )}
            </select>
            <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 font-bold text-xs cursor-pointer">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}