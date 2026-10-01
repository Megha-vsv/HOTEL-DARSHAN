import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { LocateFixed, Navigation } from 'lucide-react';

// How old a position may be before the screen stops calling it live.
//
// A rider sends every 15 seconds or 40 metres, so three missed sends means
// something is actually wrong - permission withdrawn, the phone locked, the
// socket gone. Drawing the pin anyway would be a claim the server cannot support,
// which is the one thing a tracking map must never do.
export const STALE_AFTER_SECONDS = 45;

/**
 * Is the position we are holding too old to present as live?
 *
 * Deliberately a function of the last update we were *given*, not of a timer
 * running since: a screen that has been open a long time but is still receiving
 * updates is not stale.
 */
export function isRiderFixStale(lastSeenAt, staleAfterSeconds = STALE_AFTER_SECONDS, now = Date.now()) {
  if (!lastSeenAt) return true;
  const at = typeof lastSeenAt === 'number' ? lastSeenAt : Date.parse(lastSeenAt);
  if (!Number.isFinite(at)) return true;
  return now - at > staleAfterSeconds * 1000;
}

/** A pin drawn as HTML, so nothing depends on a bundled marker image. */
function pinIcon(glyph, { background, ring, size = 30 } = {}) {
  return L.divIcon({
    className: 'hd-map-pin',
    html: `<span style="
      display:flex;align-items:center;justify-content:center;
      width:${size}px;height:${size}px;border-radius:9999px;
      background:${background};box-shadow:0 0 0 ${ring} rgba(255,255,255,.95),0 2px 6px rgba(0,0,0,.3);
      font-size:${Math.round(size * 0.55)}px;line-height:1;">${glyph}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
}

const HOTEL_ICON = () => pinIcon('🍽️', { background: '#e53935' });
const CUSTOMER_ICON = () => pinIcon('🏠', { background: '#1d4ed8' });
const RIDER_ICON = () => pinIcon('🛵', { background: '#059669', size: 34 });

/** Normalise anything that claims to be a point into a Leaflet-usable latlng. */
export function toLatLng(point) {
  if (!point) return null;
  const lat = Number(point.lat ?? point.latitude);
  const lng = Number(point.lng ?? point.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

/** Everything that has to be on screen, in a form that can be fitted to. */
function fitPoints(map, points) {
  const usable = points.filter(Boolean);
  if (usable.length === 0) return false;
  if (usable.length === 1) {
    map.setView(usable[0], 15);
    return true;
  }
  map.fitBounds(L.latLngBounds(usable), { padding: [42, 42], maxZoom: 16 });
  return true;
}

/**
 * The customer-facing delivery map.
 *
 * Three pins - the restaurant, the delivery address, the rider - and one rule
 * that matters more than the rest: the map is built once and afterwards only the
 * rider's pin moves. The map is not re-created, the tile layer is not re-added,
 * and the viewport is never moved on a rider update, because a customer who has
 * panned to look at their own street does not want the view yanked back every
 * fifteen seconds. Recentring is offered as a button instead.
 */
export default function DeliveryMap({
  hotel,
  customer,
  rider,
  riderName,
  riderVisible,
  lastSeenAt,
  riderLocationMessage,
  // The rider is looking at their own position, so the two things that differ from
  // the customer's view are: they may see it at any stage, and a stale fix is
  // "your position is out of date" rather than the customer's "we cannot see you".
  ownPosition = false,
  staleMessage = 'Rider location temporarily unavailable',
  staleAfterSeconds = STALE_AFTER_SECONDS,
  className = 'h-64 sm:h-80'
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({ hotel: null, customer: null, rider: null });
  const fittedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const hotelAt = useMemo(() => toLatLng(hotel), [hotel]);
  const customerAt = useMemo(() => toLatLng(customer), [customer]);
  const riderAt = useMemo(() => toLatLng(rider), [rider]);

  // The rider's pin is only the rider's to see once the server says the food has
  // been picked up. Before that the customer is told the rider is heading to the
  // restaurant in words, and the position is not drawn. The rider themself is
  // exempt: it is their own position and they are the one who needs it to navigate.
  const riderKnown = Boolean(ownPosition || riderVisible) && Boolean(riderAt);
  const stale = isRiderFixStale(lastSeenAt, staleAfterSeconds, now);
  // A position we know but cannot vouch for is not drawn at all. A faded or
  // annotated pin still reads as "here is your rider" to somebody glancing at a
  // phone, so the pin is removed and the words take its place.
  const showRider = riderKnown && !stale;

  // One tick a second, only while the map is on screen and holding a position
  // that could go stale. Without it a pin that stopped updating would sit there
  // looking live for as long as the tab stayed open.
  useEffect(() => {
    if (!lastSeenAt) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lastSeenAt]);

  // Build the map once. Dependencies are deliberately empty: hotel and customer
  // arrive in the same payload a moment after the first render, and rebuilding the
  // map to place a pin that was always going to be there would throw away the
  // customer's pan and zoom.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return undefined;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false
    });
    // Tiles from OpenStreetMap: no key to configure and nothing to leak.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);
    // No initial setView on purpose. Any centre chosen here would be a coordinate
    // invented by this file, and the whole point of the payload is that the map's
    // three points come from the server. The viewport is set by `fitPoints` the
    // moment real points arrive, and the "no coordinates" overlay covers the gap
    // in the meantime.

    mapRef.current = map;
    setReady(true);
    // Leaflet measures its container before the layout settles, which leaves a grey
    // box on first paint. This is that one re-measure and nothing more.
    const settle = setTimeout(() => map.invalidateSize(), 120);

    return () => {
      clearTimeout(settle);
      markersRef.current = { hotel: null, customer: null, rider: null };
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // The two fixed pins. Placed once each, when their point first becomes known.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (hotelAt && !markersRef.current.hotel) {
      const m = L.marker(hotelAt, { icon: HOTEL_ICON(), zIndexOffset: 200 })
        .addTo(map)
        .bindPopup('<b>Hotel Darshan</b><br/>Pickup point');
      markersRef.current.hotel = m;
    }
    if (customerAt && !markersRef.current.customer) {
      const m = L.marker(customerAt, { icon: CUSTOMER_ICON(), zIndexOffset: 200 })
        .addTo(map)
        .bindPopup('<b>Delivery address</b>');
      markersRef.current.customer = m;
    }
  }, [ready, hotelAt, customerAt]);

  // Fit the viewport the first time there are two things to fit. After this the
  // camera belongs to the customer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || fittedRef.current) return;
    const points = [hotelAt, customerAt].filter(Boolean);
    if (points.length < 2) return;
    fitPoints(map, points);
    fittedRef.current = true;
  }, [ready, hotelAt, customerAt]);

  /**
   * The rider pin, moved in place.
   *
   * `setLatLng` moves the marker; nothing else on the map is touched, which is
   * the whole point. Adding or removing it is conditional because a rider who has
   * not been picked up yet, or whose phone has gone quiet, must not leave a pin
   * behind that no longer means anything.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const existing = markersRef.current.rider;
    if (!showRider) {
      if (existing) {
        map.removeLayer(existing);
        markersRef.current.rider = null;
      }
      return;
    }

    if (!existing) {
      const m = L.marker(riderAt, { icon: RIDER_ICON(), zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup(`<b>${riderName || 'Your rider'}</b>`);
      markersRef.current.rider = m;
      // Leaflet slides the marker into place with a transform on the icon, so a
      // transition on that same property is what makes the movement a glide
      // rather than a jump between two places.
      const el = m.getElement();
      if (el) el.style.transition = 'transform 1.2s linear';
      return;
    }
    if (existing.getLatLng().lat !== riderAt[0] || existing.getLatLng().lng !== riderAt[1]) {
      existing.setLatLng(riderAt);
    }
  }, [ready, showRider, riderAt, riderName]);

  const centreOnRider = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    // Only chase the rider when there is a rider on the map to chase. Centring on
    // a position that has been withheld would point the camera at something the
    // screen has just said it cannot vouch for.
    if (showRider && riderAt) {
      map.setView(riderAt, Math.max(map.getZoom(), 15));
      return;
    }
    if (customerAt) map.setView(customerAt, Math.max(map.getZoom(), 14));
  }, [showRider, riderAt, customerAt]);

  const nothingToShow = !hotelAt && !customerAt;

  return (
    <div className="relative">
      <div ref={containerRef} className={`w-full rounded-2xl overflow-hidden bg-neutral-100 ${className}`} />

      {/* A pin that stopped updating is removed rather than greyed out: a faded
          dot is still a dot, and the customer cannot tell it from a live one. */}
      {riderKnown && stale && (
        <div className="absolute top-3 left-3 right-3">
          <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800">
            {staleMessage}
            {lastSeenAt ? ` · last updated ${describeAge(now - Date.parse(lastSeenAt))} ago` : ''}
          </p>
        </div>
      )}

      {!ownPosition && riderVisible && !riderAt && (
        <div className="absolute top-3 left-3 right-3">
          <p className="rounded-xl bg-white/95 border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-700">
            {riderLocationMessage || 'Waiting for the rider\u2019s position\u2026'}
          </p>
        </div>
      )}

      {nothingToShow && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="rounded-xl bg-white/95 border border-neutral-200 px-4 py-3 text-xs font-semibold text-neutral-600">
            A map cannot be shown for this address because it has no coordinates on file.
          </p>
        </div>
      )}

      {/* The camera is the customer's, so the only thing that moves it on purpose
          is this button. */}
      <button
        type="button"
        onClick={centreOnRider}
        className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-xl bg-white/95 border border-neutral-200 px-3 py-2 text-[11px] font-black text-neutral-800 shadow-sm cursor-pointer hover:bg-white"
      >
        {showRider ? <LocateFixed className="h-3.5 w-3.5" /> : <Navigation className="h-3.5 w-3.5" />}
        {showRider ? 'Center on rider' : 'Center on address'}
      </button>
    </div>
  );
}

/** "just now" / "18 seconds ago" / "3 minutes ago", without a date library. */
function describeAge(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
