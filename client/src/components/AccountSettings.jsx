import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Bell, ChevronRight, CreditCard, Edit3, FileText, Globe2,
  Heart, HelpCircle, Home, LogOut, MapPin, Monitor, Moon, Package, Phone,
  Plus, Save, ShieldCheck, Sun, Trash2, Truck, X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { resolveFoodImage } from '../data/foodImages';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';

const STORAGE_KEYS = {
  notifications: 'hotel_darshan_notification_preferences',
  delivery: 'hotel_darshan_delivery_preferences'
};

const defaultNotifications = { orderUpdates: true, deliveryUpdates: true, offers: false };
const defaultDelivery = { instructions: '', preferredType: 'standard' };

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.[0] || 'U').toUpperCase();
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white rounded-3xl shadow-2xl border border-neutral-200" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-white border-b border-neutral-100 px-5 py-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-neutral-900">{title}</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-neutral-100"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-6">
      <h2 className="px-1 mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-neutral-400">{title}</h2>
      <div className="overflow-hidden bg-white border border-neutral-200 rounded-2xl shadow-sm">{children}</div>
    </section>
  );
}

function Row({ icon: Icon, title, subtitle, onClick, right, danger = false }) {
  return (
    <button type="button" onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-4 text-left border-b last:border-b-0 border-neutral-100 hover:bg-neutral-50 transition ${danger ? 'text-red-600' : 'text-neutral-900'}`}>
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-red-50' : 'bg-neutral-100'}`}>
        <Icon className={`w-5 h-5 ${danger ? 'text-red-600' : 'text-neutral-700'}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{title}</span>
        {subtitle && <span className="block text-xs text-neutral-500 mt-0.5 truncate">{subtitle}</span>}
      </span>
      {right || <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" />}
    </button>
  );
}

function ThemeOption({ selected, onSelect, label, hint, badge, preview, Icon }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border p-3 sm:p-4 transition flex items-start sm:items-center gap-3 min-h-[56px] ${
        selected
          ? 'border-[#e53939] bg-red-50 ring-1 ring-[#e53939]/40'
          : 'border-neutral-200 hover:bg-neutral-50'
      }`}
    >
      <span
        className={`w-5 h-5 rounded-full border-2 shrink-0 mt-0.5 sm:mt-0 flex items-center justify-center ${
          selected ? 'border-[#e53939]' : 'border-neutral-300'
        }`}
        aria-hidden="true"
      >
        {selected && <span className="w-2.5 h-2.5 rounded-full bg-[#e53939]" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <Icon className="w-4 h-4 text-neutral-600 shrink-0" />
          <b className="text-sm text-neutral-900">{label}</b>
          {badge && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-neutral-200 text-neutral-700">
              {badge}
            </span>
          )}
        </span>
        <span className="block text-xs text-neutral-500 mt-1">{hint}</span>
      </span>

      {preview}
    </button>
  );
}

function ThemePreview({ variant }) {
  const isDark = variant === 'dark';
  return (
    <span
      aria-hidden="true"
      className="hidden sm:flex shrink-0 w-14 h-12 rounded-lg overflow-hidden border border-neutral-300"
    >
      <span className={`w-4 h-full ${isDark ? 'bg-[#1b1b20]' : 'bg-[#e53939]'}`} />
      <span className="flex-1 flex flex-col gap-1 p-1.5">
        <span className={`h-1.5 rounded-full ${isDark ? 'bg-[#2e2e36]' : 'bg-[#e5e7eb]'}`} />
        <span className={`h-1.5 w-3/4 rounded-full ${isDark ? 'bg-[#2e2e36]' : 'bg-[#e5e7eb]'}`} />
        <span className={`h-1.5 w-1/2 rounded-full ${isDark ? 'bg-[#3b3b45]' : 'bg-[#d1d5db]'}`} />
      </span>
    </span>
  );
}

export default function AccountSettings({ onBack, onOpenOrders, menuItems = [] }) {
  const { user, token, updateUserProfile, logout } = useAuth();
  const { favorites, toggleFavorite } = useCart();
  const { language, setLanguage, t } = useLanguage();
  const { theme, resolvedTheme, systemTheme, setTheme } = useTheme();
  const [editing, setEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: user?.name || '', email: user?.email || '' });
  const [addresses, setAddresses] = useState(Array.isArray(user?.addresses) ? user.addresses : []);
  const [addressForm, setAddressForm] = useState(null);
  const [addressDraft, setAddressDraft] = useState({ id: '', title: '', street: '', landmark: '', city: '' });
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [notifications, setNotifications] = useState(() => readStored(STORAGE_KEYS.notifications, defaultNotifications));
  const [deliveryPrefs, setDeliveryPrefs] = useState(() => readStored(STORAGE_KEYS.delivery, defaultDelivery));

  useEffect(() => {
    setProfileForm({ name: user?.name || '', email: user?.email || '' });
    setAddresses(Array.isArray(user?.addresses) ? user.addresses : []);
  }, [user]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setOrdersLoading(true);
    fetch('/api/orders/my-orders', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { if (!cancelled) setOrders(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setOrders([]); })
      .finally(() => { if (!cancelled) setOrdersLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const favoriteItems = useMemo(() => {
    const ids = new Set((favorites || []).map((id) => String(id)));
    return menuItems.filter((item) => ids.has(String(item.id)));
  }, [favorites, menuItems]);

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!profileForm.name.trim()) return;
    try {
      await updateUserProfile({
        name: profileForm.name.trim(),
        phone: user?.phone || '',
        email: profileForm.email.trim()
      });
      setEditing(false);
      setModal({ type: 'message', title: t('profileSaved'), body: t('profileSavedMessage') });
    } catch (error) {
      setModal({ type: 'message', title: t('profileUpdateFailed'), body: error.message || t('profileUpdateFailed') });
    }
  };

  const saveAddresses = async (nextAddresses) => {
    try {
      await updateUserProfile({ addresses: nextAddresses });
      setAddresses(nextAddresses);
      setAddressForm(null);
    } catch (error) {
      setModal({ type: 'message', title: t('addressUpdateFailed'), body: error.message || t('addressUpdateFailed') });
    }
  };

  const saveAddress = (e) => {
    e.preventDefault();
    if (!addressDraft.street.trim() || !addressDraft.city.trim()) return;
    const next = addressForm === 'new'
      ? [...addresses, { ...addressDraft, id: addressDraft.id || `addr_${Date.now()}`, title: addressDraft.title.trim() || t('home') }]
      : addresses.map((a) => a.id === addressDraft.id ? { ...addressDraft, id: a.id, title: addressDraft.title.trim() || t('home') } : a);
    saveAddresses(next);
  };

  const deleteAddress = (id) => saveAddresses(addresses.filter((a) => a.id !== id));
  const setDefaultAddress = (id) => saveAddresses(addresses.map((a) => ({ ...a, is_default: a.id === id })));

  const updateNotifications = (key, value) => {
    const next = { ...notifications, [key]: value };
    setNotifications(next);
    localStorage.setItem(STORAGE_KEYS.notifications, JSON.stringify(next));
  };

  const updateDelivery = (key, value) => {
    const next = { ...deliveryPrefs, [key]: value };
    setDeliveryPrefs(next);
    localStorage.setItem(STORAGE_KEYS.delivery, JSON.stringify(next));
  };

  const openAddressEditor = (address) => {
    setAddressForm(address ? 'edit' : 'new');
    setAddressDraft(address || { id: '', title: '', street: '', landmark: '', city: '' });
  };

  const signOut = () => {
    logout();
    onBack();
  };

  return (
    <div className="min-h-screen bg-[#fafafa] flex flex-col">
      <div className="sticky top-0 z-30 bg-white border-b border-neutral-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-3 flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl hover:bg-neutral-100" aria-label={t('back')}><ArrowLeft className="w-5 h-5" /></button>
          <div><h1 className="text-xl font-black text-neutral-900">{t('accountSettings')}</h1><p className="text-xs text-neutral-500">{t('manageAccount')}</p></div>
        </div>
      </div>

      <main className="max-w-3xl mx-auto w-full px-4 sm:px-8 py-6">
        <section className="bg-white border border-neutral-200 rounded-3xl p-5 sm:p-6 shadow-sm mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#e53939] to-[#c62828] text-white flex items-center justify-center text-xl font-black shadow-md">{initials(user?.name)}</div>
            <div className="min-w-0 flex-1"><h2 className="text-lg font-black text-neutral-900 truncate">{user?.name || t('customerRole')}</h2><p className="text-sm text-neutral-500">{user?.phone || '—'}</p><p className="text-xs text-neutral-400 truncate">{user?.email || t('noEmailAdded')}</p></div>
            <button onClick={() => setEditing(true)} className="px-3 py-2 rounded-xl bg-red-50 text-[#e53939] font-bold text-xs flex items-center gap-1.5"><Edit3 className="w-4 h-4" />{t('editProfile')}</button>
          </div>
        </section>

        <Section title={t('account')}>
          <Row icon={Edit3} title={t('editProfile')} subtitle={t('editProfileSubtitle')} onClick={() => setEditing(true)} />
          <Row icon={Package} title={t('myOrders')} subtitle={`${orders.length} ${t('ordersCount')}`} onClick={onOpenOrders} />
          <Row icon={MapPin} title={t('savedAddresses')} subtitle={addresses.length ? `${addresses.length} ${t('savedAddressesCount')}` : t('noSavedAddresses')} onClick={() => setModal({ type: 'addresses' })} />
          <Row icon={CreditCard} title={t('paymentMethods')} subtitle={t('supportedPaymentMethods')} onClick={() => setModal({ type: 'payments' })} />
        </Section>

        <Section title={t('preferences')}>
          <Row icon={Bell} title={t('notifications')} subtitle={t('notificationSubtitle')} onClick={() => setModal({ type: 'notifications' })} />
          <Row icon={Globe2} title={t('language')} subtitle={language === 'en' ? 'English' : language === 'hi' ? 'हिन्दी' : 'ગુજરાતી'} onClick={() => setModal({ type: 'language' })} />
          <Row icon={Moon} title={t('appearance')} subtitle={t(`theme${theme.charAt(0).toUpperCase()}${theme.slice(1)}`)} onClick={() => setModal({ type: 'appearance' })} />
        </Section>

        <Section title={t('foodDelivery')}>
          <Row icon={Package} title={t('myOrders')} subtitle={t('orderHistorySubtitle')} onClick={onOpenOrders} />
          <Row icon={Heart} title={t('favoriteFoods')} subtitle={`${favoriteItems.length} ${t('savedFoodsCount')}`} onClick={() => setModal({ type: 'favorites' })} />
          <Row icon={Truck} title={t('deliveryPreferences')} subtitle={deliveryPrefs.preferredType === 'express' ? t('express') : deliveryPrefs.preferredType === 'eco' ? t('ecoSaver') : t('standard')} onClick={() => setModal({ type: 'delivery' })} />
        </Section>

        <Section title={t('support')}>
          <Row icon={HelpCircle} title={t('helpSupport')} subtitle={t('helpSupportSubtitle')} onClick={() => setModal({ type: 'help' })} />
          <Row icon={Phone} title={t('contactHotel')} subtitle={t('hotelPhone')} onClick={() => { window.location.href = 'tel:+919054862428'; }} />
          <Row icon={FileText} title={t('termsConditions')} onClick={() => setModal({ type: 'terms' })} />
          <Row icon={ShieldCheck} title={t('privacyPolicy')} onClick={() => setModal({ type: 'privacy' })} />
        </Section>

        <button onClick={signOut} className="w-full bg-white border border-red-200 text-red-600 rounded-2xl px-4 py-4 flex items-center justify-center gap-2 font-black text-sm hover:bg-red-50 transition"><LogOut className="w-5 h-5" />{t('logout')}</button>
      </main>

      {editing && (
        <Modal title={t('editProfile')} onClose={() => setEditing(false)}>
          <form onSubmit={saveProfile} className="space-y-4">
            <label className="block"><span className="text-xs font-bold text-neutral-700">{t('customerName')}</span><input value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} className="mt-1 w-full px-3 py-3 border border-neutral-200 rounded-xl outline-none focus:border-[#e53939]" required /></label>
            <label className="block"><span className="text-xs font-bold text-neutral-700">{t('mobileNumber')}</span><input value={user?.phone || ''} disabled className="mt-1 w-full px-3 py-3 border border-neutral-200 rounded-xl bg-neutral-50 text-neutral-500" /></label>
            <label className="block"><span className="text-xs font-bold text-neutral-700">{t('email')}</span><input value={profileForm.email} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })} placeholder={t('emailPlaceholder')} className="mt-1 w-full px-3 py-3 border border-neutral-200 rounded-xl outline-none focus:border-[#e53939]" /></label>
            <div className="flex gap-2 pt-2"><button type="button" onClick={() => setEditing(false)} className="flex-1 py-3 rounded-xl bg-neutral-100 font-bold text-sm">{t('cancel')}</button><button type="submit" className="flex-1 py-3 rounded-xl bg-[#e53939] text-white font-bold text-sm flex items-center justify-center gap-2"><Save className="w-4 h-4" />{t('save')}</button></div>
          </form>
        </Modal>
      )}

      {addressForm && (
        <Modal title={addressForm === 'new' ? t('addNewAddress') : t('editAddress')} onClose={() => setAddressForm(null)}>
          <form onSubmit={saveAddress} className="space-y-3">
            <input value={addressDraft.title} onChange={(e) => setAddressDraft({ ...addressDraft, title: e.target.value })} placeholder={t('addressTitle')} className="w-full px-3 py-3 border border-neutral-200 rounded-xl" />
            <input value={addressDraft.street} onChange={(e) => setAddressDraft({ ...addressDraft, street: e.target.value })} placeholder={t('streetAddress')} className="w-full px-3 py-3 border border-neutral-200 rounded-xl" required />
            <input value={addressDraft.landmark} onChange={(e) => setAddressDraft({ ...addressDraft, landmark: e.target.value })} placeholder={t('landmark')} className="w-full px-3 py-3 border border-neutral-200 rounded-xl" />
            <input value={addressDraft.city} onChange={(e) => setAddressDraft({ ...addressDraft, city: e.target.value })} placeholder={t('city')} className="w-full px-3 py-3 border border-neutral-200 rounded-xl" required />
            <button className="w-full py-3 rounded-xl bg-[#e53939] text-white font-bold flex items-center justify-center gap-2"><Save className="w-4 h-4" />{t('saveAddress')}</button>
          </form>
        </Modal>
      )}

      {modal?.type === 'message' && <Modal title={modal.title} onClose={() => setModal(null)}><p className="text-sm text-neutral-600">{modal.body}</p></Modal>}
      {modal?.type === 'addresses' && <Modal title={t('savedAddresses')} onClose={() => setModal(null)}><div className="space-y-3">{addresses.length === 0 ? <div className="text-center py-8 text-sm text-neutral-500">{t('noSavedAddresses')}</div> : addresses.map((a) => <div key={a.id} className="p-4 border border-neutral-200 rounded-2xl"><div className="flex items-start gap-3"><Home className="w-5 h-5 text-[#e53939] mt-0.5" /><div className="flex-1"><div className="flex items-center gap-2"><b className="text-sm">{a.title || t('home')}</b>{a.is_default && <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full font-bold">{t('default')}</span>}</div><p className="text-xs text-neutral-600 mt-1">{a.street}</p>{a.landmark && <p className="text-xs text-neutral-500">{a.landmark}</p>}<p className="text-xs text-neutral-500">{a.city}</p><div className="flex gap-2 mt-3"><button onClick={() => { setModal(null); openAddressEditor(a); }} className="text-xs font-bold text-[#e53939]">{t('edit')}</button>{!a.is_default && <button onClick={() => setDefaultAddress(a.id)} className="text-xs font-bold text-neutral-600">{t('setDefault')}</button>}<button onClick={() => deleteAddress(a.id)} className="text-xs font-bold text-red-600 flex items-center gap-1"><Trash2 className="w-3 h-3" />{t('delete')}</button></div></div></div></div>)}<button onClick={() => { setModal(null); openAddressEditor(null); }} className="w-full py-3 rounded-xl border border-dashed border-neutral-300 text-sm font-bold flex items-center justify-center gap-2"><Plus className="w-4 h-4" />{t('addNewAddress')}</button></div></Modal>}
      {modal?.type === 'payments' && <Modal title={t('paymentMethods')} onClose={() => setModal(null)}><div className="space-y-3"><div className="p-4 border border-neutral-200 rounded-2xl"><b className="text-sm">{t('onlinePayment')}</b><p className="text-xs text-neutral-500 mt-1">Paytm · UPI · Cards · NetBanking</p></div><div className="p-4 border border-neutral-200 rounded-2xl"><b className="text-sm">{t('cashOnDelivery')}</b><p className="text-xs text-neutral-500 mt-1">{t('paymentAvailableAtCheckout')}</p></div><div className="p-4 border border-neutral-200 rounded-2xl"><b className="text-sm">{t('payAtHotel')}</b><p className="text-xs text-neutral-500 mt-1">{t('paymentAvailableAtCheckout')}</p></div></div></Modal>}
      {modal?.type === 'notifications' && <Modal title={t('notifications')} onClose={() => setModal(null)}><div className="space-y-1">{[['orderUpdates', t('orderUpdates')], ['deliveryUpdates', t('deliveryUpdates')], ['offers', t('offerNotifications')]].map(([key,label]) => <label key={key} className="flex items-center justify-between py-3 border-b border-neutral-100"><span className="text-sm font-semibold">{label}</span><input type="checkbox" checked={!!notifications[key]} onChange={(e) => updateNotifications(key,e.target.checked)} className="w-5 h-5 accent-[#e53939]" /></label>)}</div></Modal>}
      {modal?.type === 'language' && <Modal title={t('language')} onClose={() => setModal(null)}><div className="grid gap-2">{[['en','English'],['hi','हिन्दी'],['gu','ગુજરાતી']].map(([code,label]) => <button key={code} onClick={() => { setLanguage(code); setModal(null); }} className={`p-3 rounded-xl border text-left font-bold ${language === code ? 'border-[#e53939] bg-red-50 text-[#e53939]' : 'border-neutral-200'}`}>{label}</button>)}</div></Modal>}
      {modal?.type === 'appearance' && (
        <Modal title={t('appearance')} onClose={() => setModal(null)}>
          <p className="text-xs text-neutral-500 mb-3">{t('appearanceHint')}</p>
          <div role="radiogroup" aria-label={t('appearance')} className="grid gap-2.5 sm:gap-3">
            <ThemeOption
              selected={theme === 'light'}
              onSelect={() => setTheme('light')}
              label={t('themeLight')}
              hint={t('themeLightHint')}
              preview={<ThemePreview variant="light" />}
              Icon={Sun}
            />
            <ThemeOption
              selected={theme === 'dark'}
              onSelect={() => setTheme('dark')}
              label={t('themeDark')}
              hint={t('themeDarkHint')}
              preview={<ThemePreview variant="dark" />}
              Icon={Moon}
            />
            <ThemeOption
              selected={theme === 'system'}
              onSelect={() => setTheme('system')}
              label={t('themeSystem')}
              hint={`${t('themeSystemHint')} (${t(systemTheme === 'dark' ? 'themeDark' : 'themeLight')})`}
              badge={systemTheme === 'dark' ? t('themeSystemDarkNow') : t('themeSystemLightNow')}
              Icon={Monitor}
            />
          </div>
          <p className="mt-4 text-xs text-neutral-500">
            {t('themeActiveNow')}: <b className="text-neutral-800">{t(resolvedTheme === 'dark' ? 'themeDark' : 'themeLight')}</b>
          </p>
        </Modal>
      )}
      {modal?.type === 'favorites' && <Modal title={t('favoriteFoods')} onClose={() => setModal(null)}>{favoriteItems.length === 0 ? <p className="text-sm text-neutral-500 text-center py-8">{t('noFavorites')}</p> : <div className="space-y-2">{favoriteItems.map((item) => <div key={item.id} className="flex items-center gap-3 p-3 border border-neutral-200 rounded-2xl"><img src={resolveFoodImage(item)} alt={item.name_en || 'Food'} className="w-14 h-14 rounded-xl object-cover" />
<div className="flex-1"><b className="text-sm">{item.name_en || item.name}</b><p className="text-xs text-neutral-500">₹{item.price}</p></div><button onClick={() => toggleFavorite(item.id)} className="p-2 rounded-xl bg-red-50 text-[#e53939]"><Heart className="w-4 h-4 fill-current" /></button></div>)}</div>}</Modal>}
      {modal?.type === 'delivery' && <Modal title={t('deliveryPreferences')} onClose={() => setModal(null)}><div className="space-y-4"><div><p className="text-xs font-bold text-neutral-700 mb-2">{t('preferredDeliveryType')}</p><div className="grid grid-cols-3 gap-2">{[['eco',t('ecoSaver')],['standard',t('standard')],['express',t('express')]].map(([value,label]) => <button key={value} onClick={() => updateDelivery('preferredType',value)} className={`p-2 rounded-xl border text-xs font-bold ${deliveryPrefs.preferredType === value ? 'border-[#e53939] bg-red-50 text-[#e53939]' : 'border-neutral-200'}`}>{label}</button>)}</div></div><label className="block"><span className="text-xs font-bold text-neutral-700">{t('deliveryInstructions')}</span><textarea value={deliveryPrefs.instructions} onChange={(e) => updateDelivery('instructions',e.target.value)} className="mt-1 w-full border border-neutral-200 rounded-xl p-3 text-sm" rows={3} /></label></div></Modal>}
      {modal?.type === 'help' && <Modal title={t('helpSupport')} onClose={() => setModal(null)}><p className="text-sm text-neutral-600 mb-4">{t('helpSupportBody')}</p><a href="tel:+919054862428" className="w-full py-3 rounded-xl bg-[#e53939] text-white font-bold flex items-center justify-center gap-2"><Phone className="w-4 h-4" />{t('contactHotel')}</a></Modal>}
      {modal?.type === 'terms' && <Modal title={t('termsConditions')} onClose={() => setModal(null)}><div className="space-y-3 text-sm text-neutral-600"><p>{t('termsIntro')}</p><p>{t('termsOrdering')}</p><p>{t('termsPayment')}</p><p>{t('termsChanges')}</p></div></Modal>}
      {modal?.type === 'privacy' && <Modal title={t('privacyPolicy')} onClose={() => setModal(null)}><div className="space-y-3 text-sm text-neutral-600"><p>{t('privacyIntro')}</p><p>{t('privacyData')}</p><p>{t('privacySecurity')}</p><p>{t('privacyContact')}</p></div></Modal>}
      {modal?.type === 'orders' && <Modal title={t('myOrders')} onClose={() => setModal(null)}><div>{ordersLoading ? <p className="text-sm text-neutral-500">{t('loading')}</p> : orders.length === 0 ? <p className="text-sm text-neutral-500">{t('noOrders')}</p> : orders.slice(0,8).map((o) => <div key={o.id} className="p-3 border-b border-neutral-100"><b className="text-sm">#{o.order_number || o.id}</b><p className="text-xs text-neutral-500">{o.status} · ₹{Number(o.grand_total ?? o.total_amount ?? o.total ?? 0).toFixed(2)}</p></div>)}</div></Modal>}
    </div>
  );
}
