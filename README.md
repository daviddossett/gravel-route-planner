# Gravel Atlas — Pacific Northwest

A map-first website for planning gravel rides in Oregon and Washington. It's a single static HTML page with no build step and nothing to install. Routes come from the sample data in [`data/routes.js`](data/routes.js).

Filter routes on a topo map by month, state, distance, climbing, gravel %, and drive time from Portland or Seattle. Hit **Surprise me** to spin the compass to a random match. Each route is labeled as a loop, out-and-back, or point-to-point. Pick a route to fly the map to it and open a details drawer with an elevation profile, surface, water, pass, and season info. The drawer also shows a fun-type rating (Chill to Legendary), a post-ride reward, and a badge to earn, plus buttons to copy a ride brief or a link.

The URL tracks the selected route and any filters you've changed, for example `?route=iron-horse&month=10&origin=sea`. Paste it in the club chat, and opening it brings back the same route and filters. If the linked route doesn't match the filters (say, it's out of season), Atlas loosens them so the route still shows. Link previews use [`variants/atlas/og-image.png`](variants/atlas/og-image.png).

> **Sample data.** The 12 routes are realistic PNW gravel rides, but the geometry, mileage, climbing, drive times, and seasons are approximate. Don't navigate by them. Check closures, fire restrictions, and pass requirements with the land manager before you ride.

## Run locally

From the repo root:

```sh
python3 -m http.server 4173
```

Then open http://localhost:4173/variants/atlas/.

You can also open `variants/atlas/index.html` directly (`file://`). Leaflet and the IBM Plex fonts are self-hosted in [`vendor/`](vendor/), so only the OpenTopoMap tiles need an internet connection; without one, the route list still works.

### Offline

When served over http(s), a service worker ([`variants/atlas/sw.js`](variants/atlas/sw.js)) saves the page, route data, and the scripts, styles, and fonts it loaded, so a page you opened at home reopens at the trailhead with no signal. It also keeps up to 400 map tiles you've already viewed for 7 days, matching OpenTopoMap's cache headers. Nothing is prefetched. If the map library can't load, [`offline.js`](variants/atlas/offline.js) draws the route outlines as a simple SVG that still highlights the selected route, and a banner on the map says you're offline. There's no service worker on `file://`.

## Check the route data

After editing `data/routes.js`, run the checker (plain Node, no install):

```sh
node scripts/check-routes.js
```

It reports **errors** (exit 1) for missing or malformed fields, an unknown `type`, months that aren't sorted 1–12, and a path that doesn't match its `type`. A `loop` must end where it starts, and an `out-and-back` or `point-to-point` must not. It reports **warnings** when the drawn line's length or the profile's total climbing is far off the stated `miles` or `gain`. The sample paths are rough sketches, so expect warnings. Add `--strict` to fail on warnings too.

Each route's `type` is `loop`, `out-and-back`, or `point-to-point`. Draw out-and-back paths one way only; `miles` is the round trip.

## Tests

The site has no dependencies. Playwright is a dev-only dependency for browser smoke tests:

```sh
npm install
npx playwright install chromium
npm test
```

`npm test` serves the repo with `python3 -m http.server 4190` and loads `variants/atlas/index.html?demo` in Chromium at 1440×800 (light) and 390×844 (dark, mobile). It fails on page or console errors (map-tile and network failures are ignored), an empty route list, a details drawer that's covered by something else, or Esc not closing the drawer. It also loads the page so the service worker installs, goes offline, reloads, and checks the route list still renders. The date is pinned to mid-July so the month filter always matches routes.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the route data check and the smoke tests on every pull request and on pushes to `main`.

## Deploys and PR previews

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) deploys to GitHub Pages on every push to `main`, and whenever a pull request from this repo is opened, updated, reopened, or closed. `main` is served at https://daviddossett.github.io/gravel-route-planner/, and each open pull request at `https://daviddossett.github.io/gravel-route-planner/pr-<number>/variants/atlas/`. The workflow posts that link as a comment on the pull request and keeps it current.

Every deploy rebuilds the whole site with [`scripts/build-pages.sh`](scripts/build-pages.sh), so a closed pull request's preview disappears on the next deploy. Pull requests from forks don't get previews. The workflow runs from `main`, so changes to it or to the scripts take effect only after they merge.

## Layout

```
data/routes.js               sample route data (window.PNW_ROUTES)
scripts/check-routes.js      route data checker
scripts/build-pages.sh       assembles the Pages site and PR previews
scripts/comment-previews.sh  posts preview links on pull requests
tests/                       Playwright smoke tests (dev only)
variants/atlas/              map-first planner (Leaflet + OpenTopoMap)
vendor/                      self-hosted Leaflet 1.9.4 and IBM Plex fonts, with licenses
```
