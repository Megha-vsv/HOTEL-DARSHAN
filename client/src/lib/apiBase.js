/**
 * The backend's URL prefix, normalised from VITE_API_URL.
 *
 * Vite replaces `import.meta.env.VITE_API_URL` at build time, so every module
 * that reads it gets the value that was present when the bundle was built.
 * This file exists so that value is interpreted exactly once, the same way in
 * every module, and so it cannot produce a doubled "/api/api":
 *
 *   empty        the page and the backend share a host (the Vite dev server,
 *                or Express serving the built frontend). The path stays
 *                relative and resolves against the page origin.
 *   supplied      stripped of trailing slashes and given an "/api" suffix if
 *                it does not already end with one, so
 *                "https://backend.example" and
 *                "https://backend.example/api" both become
 *                "https://backend.example/api".
 *
 * `apiOrigin` is the same decision expressed as a host, used by the socket,
 * which connects to a WebSocket host rather than to a path prefix.
 */

const raw = String(import.meta.env.VITE_API_URL || '').trim();

export const apiOrigin = raw
  ? raw.replace(/\/+$/, '').replace(/\/api$/i, '')
  : window.location.origin;
export const apiBase = raw
  ? raw.replace(/\/+$/, '').replace(/\/api$/i, '') + '/api'
  : '/api';