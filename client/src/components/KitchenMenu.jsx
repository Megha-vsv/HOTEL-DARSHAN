import React, { useEffect, useState } from 'react';
import {
  Search,
  Save,
  X,
  Plus,
  Trash2,
  Edit2,
  ToggleLeft,
  ToggleRight,
  Package,
  Tag,
  Star,
  Utensils,
  Loader2,
} from 'lucide-react';
import { resolveFoodImage } from '../data/foodImages';
import { useAuth } from '../context/AuthContext';
import { apiBase as API_BASE } from '../lib/apiBase';

// Same central image resolution used by Menu, Cart, Orders, Admin and Kitchen,
// so one food item always renders the same existing image everywhere.

const EMPTY_ITEM = {
  name_en: '', name_hi: '', name_gu: '',
  price: '', discount_price: '',
  category_id: '',
};

export default function KitchenMenu() {
  const { user, token } = useAuth();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [addValues, setAddValues] = useState({ ...EMPTY_ITEM });
  const [saving, setSaving] = useState(false);

  const isChef = user?.role === 'chef';
  const isAdmin = user?.role === 'admin';
  // Existing permissions (server-enforced): admin + chef can add/edit/price/stock/availability.
  const canManage = isChef || isAdmin;
  // Only admin may delete (DELETE is admin-only on the backend).
  const canDelete = isAdmin;

  const authHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const loadMenu = async () => {
    try {
      setError('');
      const [itemsRes, catRes] = await Promise.all([
        fetch(`${API_BASE}/menu/items`, { headers: authHeaders }),
        fetch(`${API_BASE}/menu/categories`, { headers: authHeaders }),
      ]);
      const itemsData = itemsRes.ok ? await itemsRes.json() : [];
      const catData = catRes.ok ? await catRes.json() : [];
      setItems(Array.isArray(itemsData) ? itemsData : []);
      setCategories(Array.isArray(catData) ? catData : []);
    } catch (e) {
      setError(e.message || 'Unable to load menu');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateItem = (id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  // Availability toggle (PATCH /items/:id/availability) — server broadcasts the change
  const toggleAvailability = async (item) => {
    const next = item.is_available ? 0 : 1;
    const prev = { ...item };
    updateItem(item.id, { is_available: next });
    try {
      const res = await fetch(`${API_BASE}/menu/items/${item.id}/availability`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ is_available: next === 1 }),
      });
      if (!res.ok) throw new Error('Failed to update availability');
    } catch (e) {
      updateItem(item.id, prev);
      setError(e.message);
    }
  };

  // Stock quantity (PATCH /items/:id/stock)
  const saveStock = async (item, qty) => {
    const q = parseInt(qty);
    if (Number.isNaN(q) || q < 0) return;
    const prev = { ...item };
    updateItem(item.id, { available_qty: q, is_available: q > 0 ? 1 : 0 });
    try {
      const res = await fetch(`${API_BASE}/menu/items/${item.id}/stock`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ available_qty: q }),
      });
      if (!res.ok) throw new Error('Failed to update stock');
    } catch (e) {
      updateItem(item.id, prev);
      setError(e.message);
    }
  };

  // Full item edit incl. price/name (PUT /items/:id). Image is preserved (rule: don't change images).
  const saveEdit = async (item) => {
    const payload = {
      category_id: editValues.category_id ?? item.category_id,
      name_en: editValues.name_en || item.name_en,
      name_hi: editValues.name_hi || editValues.name_en || item.name_hi,
      name_gu: editValues.name_gu || editValues.name_en || item.name_gu,
      desc_en: editValues.desc_en ?? item.desc_en,
      desc_hi: editValues.desc_hi ?? item.desc_hi,
      desc_gu: editValues.desc_gu ?? item.desc_gu,
      ingredients_en: editValues.ingredients_en ?? item.ingredients_en,
      ingredients_hi: editValues.ingredients_hi ?? item.ingredients_hi,
      ingredients_gu: editValues.ingredients_gu ?? item.ingredients_gu,
      price: Number(editValues.price ?? item.price) || 0,
      discount_price: editValues.discount_price ? Number(editValues.discount_price) : null,
      is_veg: editValues.is_veg === undefined ? item.is_veg : editValues.is_veg,
      prep_time_mins: editValues.prep_time_mins ?? item.prep_time_mins,
      image_url: item.image_url, // never change the image
      is_available: editValues.is_available === undefined ? item.is_available : editValues.is_available,
      available_qty: Number(editValues.available_qty ?? item.available_qty) || 0,
      is_popular: editValues.is_popular === undefined ? item.is_popular : editValues.is_popular,
      is_special: editValues.is_special === undefined ? item.is_special : editValues.is_special,
      customizations: editValues.customizations_json ? JSON.parse(editValues.customizations_json) : item.customizations,
    };
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/menu/items/${item.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update item');
      const updated = await res.json();
      updateItem(item.id, updated);
      setEditId(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Add new food (POST /items)
  const addFood = async () => {
    if (!addValues.name_en || !addValues.price || !addValues.category_id) {
      setError('Name, price and category are required');
      return;
    }
    const payload = {
      category_id: Number(addValues.category_id),
      name_en: addValues.name_en.trim(),
      name_hi: addValues.name_hi.trim() || addValues.name_en.trim(),
      name_gu: addValues.name_gu.trim() || addValues.name_en.trim(),
      price: Number(addValues.price) || 0,
      image_url: '', // preserve existing backend default; do not generate images
      is_available: 1,
      available_qty: 50,
    };
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/menu/items`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to add food');
      const created = await res.json();
      setItems((prev) => [created, ...prev]);
      setShowAdd(false);
      setAddValues({ ...EMPTY_ITEM });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Delete (admin only; server enforces this too)
  const deleteItem = async (item) => {
    if (!window.confirm(`Remove ${item.name_en} from the menu?`)) return;
    try {
      const res = await fetch(`${API_BASE}/menu/items/${item.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!res.ok) throw new Error('Failed to delete item');
      setItems((prev) => prev.filter((it) => it.id !== item.id));
    } catch (e) {
      setError(e.message);
    }
  };

  const visibleItems = (Array.isArray(items) ? items : []).filter((it) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      String(it?.name_en || '').toLowerCase().includes(q) ||
      String(it?.name_hi || '').toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 text-neutral-500">
          <Loader2 size={18} className="animate-spin" />
          Loading menu…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-neutral-50 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dishes..."
              className="w-full rounded-xl border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#e53939]"
            />
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowAdd(!showAdd)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#e53939] px-4 py-2 text-xs font-black text-white hover:bg-[#c62828]"
            >
              <Plus size={14} />
              Add Food
            </button>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
            {error}
          </div>
        )}

        {/* Add Food form */}
        {showAdd && canManage && (
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-[10px] font-black uppercase tracking-wider text-neutral-600">
              New Dish
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <input
                value={addValues.name_en}
                onChange={(e) => setAddValues({ ...addValues, name_en: e.target.value })}
                placeholder="Dish name (English)"
                className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-[#e53939]"
              />
              <input
                value={addValues.name_hi}
                onChange={(e) => setAddValues({ ...addValues, name_hi: e.target.value })}
                placeholder="Dish name (Hindi)"
                className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-[#e53939]"
              />
              <input
                value={addValues.name_gu}
                onChange={(e) => setAddValues({ ...addValues, name_gu: e.target.value })}
                placeholder="Dish name (Gujarati)"
                className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-[#e53939]"
              />
              <select
                value={addValues.category_id}
                onChange={(e) => setAddValues({ ...addValues, category_id: e.target.value })}
                className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-[#e53939]"
              >
                <option value="">Select category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_en}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="0.01"
                value={addValues.price}
                onChange={(e) => setAddValues({ ...addValues, price: e.target.value })}
                placeholder="Price (₹)"
                className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-[#e53939]"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={addValues.discount_price}
                onChange={(e) => setAddValues({ ...addValues, discount_price: e.target.value })}
                placeholder="Discounted price (₹)"
                className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-[#e53939]"
              />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={addFood}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                Save Food
              </button>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setAddValues({ ...EMPTY_ITEM }); }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-xs font-black text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Menu grid */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleItems.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-500">
              No dishes found.
            </div>
          ) : (
            visibleItems.map((item) => {
              const isEditing = editId === item.id;
              const img = resolveFoodImage(item);
              return (
                <div
                  key={item.id}
                  className="flex gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm"
                >
                  <img
                    src={img}
                    alt={item.name_en}
                    className="h-16 w-16 shrink-0 rounded-xl object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {isEditing ? (
                          <input
                            value={editValues.name_en ?? item.name_en}
                            onChange={(e) => setEditValues({ ...editValues, name_en: e.target.value })}
                            className="w-full rounded-md border border-neutral-300 px-1 py-0.5 text-sm font-black text-neutral-900 outline-none focus:border-[#e53939]"
                          />
                        ) : (
                          <p className="text-sm font-black text-neutral-900 truncate">
                            {item.name_en}
                          </p>
                        )}
                        <p className="text-[10px] text-neutral-500">#{item.id}</p>
                      </div>

                      <div className="flex items-center gap-1">
                        {(item.is_special || item.is_popular) && (
                          <span
                            className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-black text-amber-700"
                            title={item.is_special ? 'Special' : 'Popular'}
                          >
                            <Star size={10} />
                          </span>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditing) { setEditId(null); setEditValues({}); }
                              else { setEditId(item.id); setEditValues({}); }
                            }}
                            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                            title={isEditing ? 'Cancel edit' : 'Edit'}
                          >
                            {isEditing ? <X size={14} /> : <Edit2 size={14} />}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Price + availability + stock */}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-black text-neutral-900">
                        ₹{Number(item.price || 0).toFixed(2)}
                        {item.discount_price ? (
                          <span className="text-neutral-500"> ( ₹{Number(item.discount_price).toFixed(2)} )</span>
                        ) : null}
                      </span>
                      <span
                        className={
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ' +
                          (item.is_available
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-neutral-100 text-neutral-600')
                        }
                      >
                        {item.is_available ? 'Available' : 'Unavailable'}
                      </span>

                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          value={editValues.available_qty ?? item.available_qty}
                          onChange={(e) =>
                            setEditValues({ ...editValues, available_qty: e.target.value })
                          }
                          className="w-14 rounded-md border border-neutral-300 px-1 py-0.5 text-neutral-900 outline-none focus:border-[#e53939]"
                          placeholder="stock"
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1 text-neutral-500">
                          <Package size={11} />
                          {item.available_qty ?? 0}
                        </span>
                      )}

                      {editValues.is_available === undefined && (
                        <button
                          type="button"
                          onClick={() => toggleAvailability(item)}
                          className="rounded-md p-0.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                          title="Toggle availability"
                        >
                          {item.is_available ? (
                            <ToggleRight size={16} className="text-emerald-600" />
                          ) : (
                            <ToggleLeft size={16} className="text-neutral-400" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline row actions */}
                  {isEditing && canManage && (
                    <div className="flex flex-col gap-1.5 border-l border-neutral-100 pl-2 pt-1">
                      {['price', 'discount_price', 'available_qty', 'name_en'].includes('price') && (
                        <>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editValues.price ?? item.price}
                            onChange={(e) =>
                              setEditValues({ ...editValues, price: e.target.value })
                            }
                            className="w-20 rounded-md border border-neutral-300 px-1 py-0.5 text-xs outline-none focus:border-[#e53939]"
                            placeholder="Price"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editValues.discount_price ?? (item.discount_price ?? '')}
                            onChange={(e) =>
                              setEditValues({ ...editValues, discount_price: e.target.value })
                            }
                            className="w-20 rounded-md border border-neutral-300 px-1 py-0.5 text-xs outline-none focus:border-[#e53939]"
                            placeholder="Disc. price"
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Fixed Save / Save Stock / Delete per editing item */}
      {editId && canManage && (
        <ItemActionBar
          item={items.find((it) => it.id === editId)}
          saving={saving}
          onSave={() => saveEdit(items.find((it) => it.id === editId))}
          onCancel={() => { setEditId(null); setEditValues({}); }}
          showDelete={canDelete}
          onDelete={() => deleteItem(items.find((it) => it.id === editId))}
        />
      )}
    </div>
  );
}

// Floating action bar that appears while an item is being edited
function ItemActionBar({ item, saving, onSave, onCancel, showDelete, onDelete }) {
  if (!item) return null;
  return (
    <div className="fixed inset-x-0 bottom-6 mx-auto w-max rounded-xl border border-neutral-200 bg-white px-4 py-2 shadow-xl">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save Changes
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-black text-neutral-700 hover:bg-neutral-50"
        >
          <X size={12} />
          Cancel
        </button>
        {showDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-black text-red-700 hover:bg-red-50"
          >
            <Trash2 size={12} />
            Delete
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 text-[10px] text-neutral-400">
        Saving #{item.id} · {item.name_en}
      </p>
    </div>
  );
}
