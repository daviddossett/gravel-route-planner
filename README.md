# Gravel Atlas — Pacific Northwest

A map-first website for planning gravel rides in Oregon and Washington. It's a single static HTML page with no build step and nothing to install. Routes come from the sample data in [`data/routes.js`](data/routes.js).

Filter routes on a topo map by month, state, distance, climbing, gravel %, and drive time from Portland or Seattle. Hit **Surprise me** to spin the compass to a random match. Pick a route to fly the map to it and open a details drawer with an elevation profile, surface, water, pass, and season info. The drawer also shows a fun-type rating (Chill to Legendary), a post-ride reward, and a badge to earn, plus a button to copy a ride brief.

> **Sample data.** The 12 routes are realistic PNW gravel rides, but the geometry, mileage, climbing, drive times, and seasons are approximate. Don't navigate by them. Check closures, fire restrictions, and pass requirements with the land manager before you ride.

## Run locally

From the repo root:

```sh
python3 -m http.server 4173
```

Then open http://localhost:4173/variants/atlas/.

You can also open `variants/atlas/index.html` directly (`file://`). The map needs an internet connection for Leaflet and the OpenTopoMap tiles; without one, the route list still works. Google Fonts falls back to system fonts when you're offline.

## Layout

```
data/routes.js        sample route data (window.PNW_ROUTES)
variants/atlas/       map-first planner (Leaflet + OpenTopoMap)
```
