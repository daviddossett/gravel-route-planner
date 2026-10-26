# Vendored assets

Self-hosted copies of third-party assets, so the page doesn't wait on other origins. Paths include versions and are stable, so they're safe to cache.

| Path | Source | License |
| --- | --- | --- |
| `leaflet-1.9.4/` | `leaflet.js`, `leaflet.css`, and `images/` from the `leaflet@1.9.4` npm package (`dist/`), unmodified | BSD-2-Clause, see [`leaflet-1.9.4/LICENSE`](leaflet-1.9.4/LICENSE) |
| `fonts/ibm-plex/` | IBM Plex Mono 400/500 and IBM Plex Sans Condensed 400/500/600/700, latin subset woff2, from Google Fonts | SIL OFL 1.1, see [`fonts/ibm-plex/OFL.txt`](fonts/ibm-plex/OFL.txt) |

The `@font-face` rules live inline in `variants/atlas/index.html`.
