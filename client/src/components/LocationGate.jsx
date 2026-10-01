import React, { useEffect, useState } from 'react';
import { Navigation, Search, CheckCircle2, Loader2 } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { useAuth } from '../context/AuthContext';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { readStoredLocation, writeStoredLocation } from '../utils/deliveryLocation';
import { parseHotelCoords } from '../data/deliveryPricing';

export default function LocationGate({ onReady }) {
  const { user, updateUserProfile } = useAuth();
  const [coords, setCoords] = useState(() => readStoredLocation()?.coords || null);
  const [address, setAddress] = useState(() => readStoredLocation()?.address || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Where the restaurant actually is, as the server says.
  //
  // This used to be a constant in this file - [21.5330, 73.9990] - and that was
  // wrong by about 43 km. Those coordinates reverse-geocode to Kukarmunda Taluka
  // in Tapi district, not Dediapada, and the rest of the application had already
  // moved off them: the seeded `hotel_coords` setting, the delivery pricing and
  // the distance checks all use 21.6271369 / 73.5898076. So the map was showing
  // customers a restaurant that does not exist while the fee was priced from one
  // that does. It is read from the server now, which is also why an admin who
  // moves the restaurant does not have to edit a second place.
  const [hotel, setHotel] = useState(null);

  const reverseGeocode = async (lat, lng) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
      if (!res.ok) return '';
      const data = await res.json();
      return data.display_name || '';
    } catch { return ''; }
  };

  const locate = () => {
    setError('');
    if (!navigator.geolocation) return setError('Location is not supported by this browser.');
    setLoading(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      const next = { lat: position.coords.latitude, lng: position.coords.longitude };
      setCoords(next);
      const detected = await reverseGeocode(next.lat, next.lng);
      setAddress(detected || `Current location (${next.lat.toFixed(5)}, ${next.lng.toFixed(5)})`);
      setLoading(false);
    }, (err) => {
      setLoading(false);
      // A denied permission is not a dead end, so the wording points at what is
      // still available rather than at a button that no longer exists: the
      // Delivery address field stays editable either way, and checkout still
      // offers its own address editing.
      setError(err.code === 1 ? 'Location permission was denied. You can type your delivery address in the field below instead.' : 'Unable to detect your location. Please try again.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  };

  useEffect(() => { if (!coords) locate(); }, []);

  // The restaurant's coordinates, from the same public settings the cart prices
  // from. Failure is not fatal: the map still shows the customer's own position,
  // just without the hotel pin, which is better than a wrong pin.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const parsed = data ? parseHotelCoords(data.hotel_coords) : null;
        if (parsed) setHotel([parsed.lat, parsed.lng]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!coords) return;
    const el = document.getElementById('hotel-darshan-location-map');
    if (!el) return;
    el.innerHTML = '';
    const map = L.map(el, { zoomControl: false }).setView([coords.lat, coords.lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    L.marker([coords.lat, coords.lng]).addTo(map).bindPopup('Your delivery location').openPopup();
    if (hotel) L.marker(hotel).addTo(map).bindPopup('Hotel Darshan');
    return () => map.remove();
  }, [coords, hotel]);

  const confirm = async () => {
    if (!address.trim()) return setError('Please enter or detect a delivery address.');
    const location = { coords, address: address.trim(), updatedAt: new Date().toISOString() };
    // Publish through the shared helper so the cart and checkout re-price from
    // this location instead of keeping the distance they already had.
    writeStoredLocation(location);
    try {
      const old = user?.addresses || [];
      const nextAddress = { id: 'current_location', title: 'Current Location', street: address.trim(), landmark: '', city: '', latitude: coords?.lat, longitude: coords?.lng };
      await updateUserProfile({ addresses: [nextAddress, ...old.filter(a => a.id !== 'current_location')] });
    } catch (e) { /* local location remains usable if profile update fails */ }
    onReady(location);
  };

  return <div className="min-h-screen bg-[#fafafa] flex items-center justify-center p-4">
    <div className="max-w-lg w-full bg-white rounded-3xl shadow-xl border border-neutral-200 overflow-hidden">
      <div className="p-6 sm:p-7">
        <BrandLogo size="lg" className="mb-4" />
        <h2 className="text-2xl font-black text-neutral-900">Where should we deliver?</h2>
        <p className="text-sm text-neutral-500 mt-1">Allow location access for a faster, more accurate delivery experience.</p>

        {/*
          One button, and it spans the card.

          The "Enter Manually" button used to sit beside this one, sharing the row
          and taking its own width, so the location button was flex-1 around it.
          With the row to itself, flex-1 now fills it, which lines this button up
          with the full-width "Confirm Delivery Location" below instead of leaving
          it short of the card edge.

          Manual entry is deliberately not gone, it just is not a separate mode
          any more: the Delivery address field below is always editable, and
          checkout still offers its own address editing. What was removed is the
          second door into that, not the ability to type an address.
        */}
        <div className="mt-5 flex gap-2">
          <button onClick={locate} disabled={loading} className="flex-1 py-3 rounded-xl bg-[#e53935] text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60"><Navigation className="w-4 h-4"/>{loading ? 'Detecting...' : 'Use Current Location'}</button>
        </div>

        {coords && <div id="hotel-darshan-location-map" className="h-56 rounded-2xl overflow-hidden mt-5 border border-neutral-200" />}

        <div className="mt-4">
          <label className="text-xs font-bold text-neutral-600">Delivery address</label>
          <div className="relative mt-1"><Search className="absolute left-3 top-3.5 w-4 h-4 text-neutral-400"/><textarea value={address} onChange={e => setAddress(e.target.value)} rows={3} placeholder="Your complete delivery address" className="w-full pl-10 pr-3 py-3 rounded-xl border border-neutral-200 outline-none focus:border-[#e53935] resize-none"/></div>
        </div>

        {error && <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

        <button onClick={confirm} className="w-full mt-5 py-3.5 rounded-xl bg-neutral-900 text-white font-black flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4"/>Confirm Delivery Location</button>
        <p className="text-[11px] text-neutral-400 mt-3 text-center">You can change your delivery location later from checkout.</p>
      </div>
    </div>
  </div>;
}
