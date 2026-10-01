# Running the client through a Cloudflare Quick Tunnel

This is about the tunnel only. It changes no application code, no routes, no
backend, and no UI. The Vite side of this is already correct — see the comments
in `client/vite.config.js` for why HMR needs no configuration and why nothing
here should be copied into it.

## The problem

Opened through a quick tunnel, the page HTML loads and then the module requests
fail:

```
GET /@vite/client
GET /src/App.jsx
GET /node_modules/.vite/deps/react.js
GET /node_modules/.vite/deps/react-dom_client.js
GET /node_modules/.vite/deps/socket__io-client.js
```

cloudflared logs, for each one:

```
ERR error="stream 412 canceled by remote with error code 0" connIndex=0
ERR Request failed error="stream 412 canceled by remote with error code 0"
```

## What it is

**Not a Vite problem, and not a bug in this app.** The message is emitted by
cloudflared when the Cloudflare edge resets the stream that was carrying the
request. Vite never gets to answer — there is no HTTP status to see in the
browser's network tab, just a cancelled request. The same error is reported
against nginx, Home Assistant, Nextcloud and other origins with nothing in
common, across many cloudflared versions and many networks. It is tracked
upstream and is still open:

- <https://github.com/cloudflare/cloudflared/issues/1300> — canonical thread
- <https://github.com/cloudflare/cloudflared/issues/1360> — related analysis

Cloudflare's own maintainer describes it as the request having gone away before
the response was returned. The connector keeps its own connection alive, the
edge rotates its half of the session, and requests landing on the stale
connection are dropped.

Confirmed locally: `http://localhost:5174/@vite/client` returned HTTP 200 on
every attempt while the tunnel was failing, and the tunnel's own metrics showed
`cloudflared_tunnel_request_errors` climbing with
`quic_client_received_frames{...,frame_type="ResetStream"}` rising alongside.

## Why a phone load is the worst case

A quick tunnel is forced to a **single** edge connection. `cloudflared` sets
`ha-connections=1` internally and ignores the flag, so there is nothing to fail
over to: when that one connection goes stale, *every* request fails rather than
a fraction of them. A first page load is ~15 parallel module requests, which is
the most concentrated burst the app ever makes — hence it is usually the phone
load that shows this and not desktop.

## What to do

**Restart cloudflared.** It is the only reliable fix. The wedge clears and the
tunnel works again for a while. Worth trying first, because it costs nothing.

Start it with HTTP/2 rather than the default QUIC:

```
cloudflared tunnel --url http://localhost:5174 --protocol http2
```

QUIC is what the edge resets, and HTTP/2 does not use it. This reliably avoids
the QUIC keepalive timeouts (`Failed to serve quic connection error="timeout"`)
and reduces the incidence of this error. It is a mitigation, not a guarantee —
the bug is in the edge↔connector session regardless of transport, so a stale
session can still occur.

**For anything beyond a quick test, use a named tunnel instead:**

```
cloudflared tunnel create
cloudflared tunnel route dns <name> <your-domain>
cloudflared tunnel run <name>
```

A named tunnel gets a stable hostname, several HA connections, and no forced
single connection. It is also the supported path if the app is used regularly on
a phone.

## Diagnosing

Check the tunnel's own counters — this is the fastest way to tell a tunnel
problem from a Vite problem:

```
# find the metrics port in the cloudflared startup output ("Starting metrics server on 127.0.0.1:NNNNN")
curl http://127.0.0.1:NNNNN/metrics | findstr request_errors
curl http://127.0.0.1:NNNNN/metrics | findstr ResetStream
```

`cloudflared_tunnel_request_errors` rising means requests are being dropped
before they reach the origin. That is this bug. If it is flat while the page is
broken, the problem is on the Vite side after all.

Browser-side, the signature distinguishes the three causes:

| What you see | Meaning |
| --- | --- |
| request cancelled, `net::ERR_*`, no status | transport abort — this document |
| `504` on a `/node_modules/.vite/deps/` URL | Vite re-optimized; a reload is pending |
| `403` with "Blocked request. This host ... is not allowed" | `allowedHosts` — already handled in `vite.config.js` |

Comparing the same URL on the LAN and through the tunnel settles it in one step:
if `http://<lan-ip>:5174/@vite/client` is reliable and the tunnel URL is not, it
is the tunnel.
