import express from 'express';
import { authMiddleware } from '../auth.js';

const router = express.Router();

// OpenStreetMap Nominatim. A User-Agent is mandatory for its usage policy, and a
// browser cannot set that header, so address lookups are done here instead of
// from the client.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'HotelDarshan/1.0 (delivery address lookup)';

// Nominatim allows at most one request per second, so results are cached and
// repeat lookups are collapsed onto the in-flight request.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();
const inFlight = new Map();

const clean = (value) => (typeof value === 'string' ? value.trim().slice(0, 120) : '');

/**
 * Free-text search is unreliable for a full street line, so the query is relaxed
 * step by step and the first match wins. This still resolves a customer to their
 * own town, which is what the delivery radius needs.
 */
function queryLadder({ street, landmark, city, state, pincode }) {
  const pick = (...parts) => parts.map(clean).filter(Boolean).join(', ');
  return [
    pick(street, landmark, city, state, pincode),
    pick(street, city, state, pincode),
    pick(street, city),
    pick(landmark, city, pincode),
    pick(city, pincode),
    pick(city, state)
  ].filter((q, i, all) => q && all.indexOf(q) === i);
}

async function lookup(query) {
  const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'en' }
  });
  if (!res.ok) return null;
  const data = await res.json();
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) return null;
  const lat = Number.parseFloat(hit.lat);
  const lng = Number.parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, label: hit.display_name || '' };
}

async function geocodeAddress(parts) {
  for (const query of queryLadder(parts)) {
    const cached = cache.get(query);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      if (cached.value) return { ...cached.value, query };
      continue;
    }
    if (inFlight.has(query)) {
      const value = await inFlight.get(query);
      if (value) return { ...value, query };
      continue;
    }
    const pending = lookup(query);
    inFlight.set(query, pending);
    let value = null;
    try {
      value = await pending;
    } catch {
      value = null;
    } finally {
      inFlight.delete(query);
    }
    cache.set(query, { at: Date.now(), value });
    if (value) return { ...value, query };
  }
  return null;
}

/**
 * GET /api/geocode?street=&landmark=&city=&state=&pincode=
 * Resolves a typed address to coordinates so it can be priced from where the
 * address actually is. Returns 404 when nothing matches, which lets the caller
 * fall back to the device location instead of guessing.
 */
router.get('/', authMiddleware, async (req, res) => {
  const parts = {
    street: req.query.street,
    landmark: req.query.landmark,
    city: req.query.city,
    state: req.query.state,
    pincode: req.query.pincode
  };

  if (!Object.values(parts).some((v) => clean(v))) {
    return res.status(400).json({ success: false, message: 'Provide at least a city or street to look up.' });
  }

  try {
    const hit = await geocodeAddress(parts);
    if (!hit) return res.status(404).json({ success: false, message: 'Address could not be matched.' });
    return res.json({ success: true, lat: hit.lat, lng: hit.lng, label: hit.label, matchedOn: hit.query });
  } catch {
    return res.status(502).json({ success: false, message: 'Address lookup is unavailable right now.' });
  }
});

export default router;
