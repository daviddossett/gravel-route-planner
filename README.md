# Gravel Route Planner — Pacific Northwest

Three variants of a small website for planning gravel rides in Oregon and Washington. Each one is a single static HTML page. There's no build step and nothing to install. All three read the same sample data in [`data/routes.js`](data/routes.js).

> **Sample data.** The 12 routes are realistic PNW gravel rides, but the geometry, mileage, climbing, drive times, and seasons are approximate. They're for comparing the designs, not for navigating. Check closures, fire restrictions, and pass requirements with the land manager before you ride.

## Run locally

From the repo root:

```sh
python3 -m http.server 4173
```

Then open:

| Variant | URL | What it's for |
|---|---|---|
| **Atlas** (map-first) | http://localhost:4173/variants/atlas/ | Filter routes on a topo map by month, state, distance, climbing, gravel %, and drive time from Portland or Seattle. Hit **Surprise me** to spin the compass to a random match. The selected route gets marching-ant trail dots, a fun-type rating (Chill to Legendary), a post-ride reward, and a badge sticker to earn. |
| **Field Guide** (curated list) | http://localhost:4173/variants/field-guide/ | An editorial guidebook. Pick a month and the rides that are in season come first, with profiles on a shared scale, surface mix, and a season strip. The illustrated landscape changes with the season you pick. Hover a profile to ride it with a tiny cyclist, and rubber-stamp rides onto your shortlist (saved in your browser). |
| **Trip Builder** (multi-day planner) | http://localhost:4173/variants/trip-builder/ | Stack rides into a multi-day trip. It works out the drives between trailheads, totals and saddle time, flags out-of-season days and long drives, and builds a pack list from the routes you picked. Adding a day kicks up gravel, rides earn merit badges, fuel is counted in burritos, and a dice button names the trip. Copy the plan as text. Saved in your browser. |

You can also open the HTML files directly (`file://`). Atlas needs an internet connection for map tiles (OpenTopoMap) and Leaflet. All three load Google Fonts and fall back to system fonts when offline.

## Layout

```
data/routes.js              shared sample route data (window.PNW_ROUTES)
variants/atlas/             map-first planner (Leaflet + OpenTopoMap)
variants/field-guide/       season-sorted guidebook with a shortlist
variants/trip-builder/      multi-day itinerary + readiness + pack list
```
