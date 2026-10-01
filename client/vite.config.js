import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    // Listen on every interface, not just the loopback one.
    //
    // This exists for MSG91's hCaptcha, and for no other reason. hCaptcha refuses to
    // issue a token on `localhost` - it logs "Warning: localhost detected" and fails -
    // and this widget has captcha validation on. The result is that the customer OTP
    // flow cannot be exercised on `http://localhost:5174` at all: the widget is sent
    // a send request, its captcha errors, MSG91's sendOtp API is never called, and
    // nothing reaches the MSG91 logs.
    //
    // Binding to all interfaces lets the same dev server be opened over the machine's
    // LAN address, which hCaptcha accepts, so the real flow can be tested as built.
    // It changes nothing about the flow itself: the same widget, the same hCaptcha,
    // the same SMS, and the same verification. The API proxy below is unaffected, and
    // the server still binds only to the local network - this is a dev server.
    host: true,
    port: 5174,
    // Never fall forward to 5175.
    //
    // Vite's default is to try 5174 and, if something else already holds it,
    // quietly move to 5175. That is the wrong behaviour here: the dev server is
    // paired with the server's proxy target and a fixed port in every note about
    // testing the OTP flow on `http://localhost:5174`, so a silent bump to 5175
    // either breaks that or sends you to a page the API proxy is not serving.
    //
    // `strictPort` makes Vite exit with a clear "port is already in use" error
    // instead. The fix is then the obvious one — stop whatever is holding 5174 —
    // rather than debugging a page that is mysteriously missing its API calls.
    strictPort: true,
    // TEMPORARY - for the HTTPS tunnel, and safe to remove once that is done.
    //
    // The LAN address above gets hCaptcha to accept the host but leaves the page
    // without a secure context, and MSG91's SDK encrypts its send payload with
    // `crypto.subtle`, which browsers only expose over HTTPS. A tunnel gives a real
    // certificate, but it also means the request arrives carrying a hostname this
    // server has never seen, and Vite refuses unknown hosts with a 403.
    //
    // The suffix form is used rather than the exact hostname, because a quick tunnel
    // mints a new hostname every time it starts and the config should not have to be
    // edited for each one. This widens the dev server to any *.trycloudflare.com
    // host - it does not affect the built app, which Express serves directly, and it
    // has no effect on authentication: the widget still runs the same code against
    // the same backend through the same /api proxy.
    allowedHosts: ['.trycloudflare.com'],
    // Pre-bundle the dependencies this app actually imports, on cold start.
    //
    // Without this, Vite discovers dependencies by watching which ones the browser
    // happens to ask for. Over a tunnel the first page load is a burst of ~15
    // parallel requests, and the three `/node_modules/.vite/deps/*.js` ones are
    // not on disk yet - the optimizer has to bundle them while the browser is
    // already waiting. Naming them here means they are built before the first
    // request arrives, which removes that round trip from the critical path.
    //
    // This is the list the reported failures named, plus the router and the two
    // optional integrations the customer UI imports directly. It is the same set
    // the scanner finds anyway - listing them changes *when* they are built, not
    // *what* is built, and it does not affect the production bundle.
    optimizeDeps: {
      include: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/client',
        'react-router-dom',
        'socket.io-client',
        'leaflet',
        'canvas-confetti',
        'lucide-react',
      ],
      // Keep Vite's default, stated here so a future default change cannot take
      // it away silently.
      //
      // This one matters more over a tunnel than it does locally. When the scanner
      // discovers a dependency that was not in `include` above, Vite rebuilds the
      // dep chunks and asks the browser to reload the page - and that reload is
      // delivered *over the HMR WebSocket*, not as an HTTP response. If the socket
      // is not connected, the reload never arrives, the page keeps asking for dep
      // URLs carrying a hash that no longer exists, and those come back 504. That
      // turns a momentary blip into a page that stays broken until it is manually
      // reloaded. Holding the first result until the crawl is finished means the
      // graph is settled before anyone is told to fetch anything.
      holdUntilCrawlEnd: true,
    },
    // Transform the app's own modules up front rather than on first request.
    //
    // `/src/App.jsx` and its imports are each transformed by esbuild/Babel the
    // first time they are requested. On localhost that is a few milliseconds and
    // invisible; over a tunnel it is every file in the graph, one round trip at a
    // time, which widens the window in which a slow response can be dropped. Doing
    // the work at server start means the browser's requests are served from cache.
    warmup: {
      clientFiles: ['./src/**/*.{js,jsx}'],
    },
    // HMR is deliberately left unconfigured. Do not add a host, protocol, or
    // clientPort here.
    //
    // With none of them set, Vite's client falls back to `import.meta.url` - the
    // URL the browser actually used to fetch `/@vite/client`. So over a quick
    // tunnel it derives `wss`, the current random `*.trycloudflare.com` hostname,
    // and an implicit port 443, all per page load, and nothing needs editing when
    // the hostname changes. This was verified against a live tunnel: the HMR
    // WebSocket opens and receives `{"type":"connected"}`.
    //
    // Hardcoding any of the three to make a tunnel work is the single most common
    // way to break this instead: the values are correct for exactly one tunnel and
    // wrong for the next, and HMR then silently stops updating.
    //
    // The requests that fail as `stream canceled by remote with error code 0` are
    // not the WebSocket - they are plain HTTP GETs for the module scripts above.
    // That error comes from cloudflared, when the Cloudflare edge resets the QUIC
    // stream carrying the request, and it is tracked upstream as
    // cloudflare/cloudflared#1300. It is not something a Vite option can prevent;
    // the settings above only reduce how many requests there are and how long each
    // one takes. See TUNNEL.md for the tunnel-side workaround.
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
      },
    },
  },
})
