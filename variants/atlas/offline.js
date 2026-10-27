// Gravel Atlas offline support: service worker registration, a connection indicator,
// and a plain SVG drawing of the routes for when the Leaflet map can't load.
(() => {
  const CITIES = [{ name: "Portland", at: [45.515, -122.679] }, { name: "Seattle", at: [47.606, -122.332] }];
  const NS = "http://www.w3.org/2000/svg";

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then((reg) => {
        // Hand over everything this first visit already loaded so it's available offline next time.
        const urls = performance.getEntriesByType("resource")
          .filter((e) => !["img", "fetch", "xmlhttprequest", "beacon"].includes(e.initiatorType))
          .map((e) => e.name);
        if (reg.active) reg.active.postMessage({ type: "cache-urls", urls: [location.href, ...urls] });
      }).catch(() => {});
    });
  }

  function init({ routes, map, el, onSelect }) {
    const state = { shown: routes.map((r) => r.id), selected: null, hover: null };
    let tileErrors = 0;

    const status = document.createElement("div");
    status.className = "net-status"; status.id = "net-status";
    status.setAttribute("role", "status"); status.hidden = true;
    el.parentNode.append(status);

    function setStatus() {
      const online = navigator.onLine;
      let msg = "", reload = false;
      if (!map) {
        msg = online ? "Map couldn't load. Showing route outlines." : "Offline. Showing route outlines from saved data.";
        reload = online;
      } else if (!online) {
        msg = "Offline. The map shows only areas you've already viewed.";
      } else if (tileErrors >= 3) {
        msg = "Map tiles aren't loading. Routes are still drawn.";
      }
      status.hidden = !msg;
      status.classList.toggle("offline", !online);
      status.innerHTML = msg ? `<span class="dot" aria-hidden="true"></span>${msg}${reload ? ' <button type="button">Reload map</button>' : ""}` : "";
      const b = status.querySelector("button");
      if (b) b.onclick = () => location.reload();
    }
    addEventListener("online", setStatus);
    addEventListener("offline", setStatus);

    if (map) {
      map.eachLayer((l) => {
        if (!(l instanceof L.TileLayer)) return;
        l.on("tileerror", () => { tileErrors++; setStatus(); });
        l.on("tileload", () => { if (tileErrors) { tileErrors = 0; setStatus(); } });
      });
      setStatus();
      return { update() {} };
    }

    // No Leaflet: project each route's path onto an SVG so the shapes are still there.
    const css = getComputedStyle(document.documentElement);
    const color = (v, d) => css.getPropertyValue(v).trim() || d;
    const lat0 = (Math.min(...routes.flatMap((r) => r.path.map((p) => p[0]))) + Math.max(...routes.flatMap((r) => r.path.map((p) => p[0])))) / 2;
    const kx = Math.cos(lat0 * Math.PI / 180);
    const bounds = (pts) => pts.reduce((b, [la, lo]) => [Math.min(b[0], la), Math.min(b[1], lo), Math.max(b[2], la), Math.max(b[3], lo)], [90, 180, -90, -180]);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("role", "img");
    el.innerHTML = ""; el.classList.add("svg"); el.append(svg);

    function draw() {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      const sel = routes.find((r) => r.id === state.selected);
      let [s, wst, n, e] = bounds(sel ? sel.path : routes.flatMap((r) => r.path));
      const padLat = Math.max((n - s) * .15, .02), padLon = Math.max((e - wst) * .15, .02);
      s -= padLat; n += padLat; wst -= padLon; e += padLon;
      const pad = { t: 52, r: 28, l: 28, b: 28 };
      const drawer = document.getElementById("drawer");
      if (sel && drawer && matchMedia("(min-width: 1100px)").matches) {
        // Laptop: the drawer is docked on the left of the map.
        pad.l = Math.min(drawer.offsetLeft + drawer.offsetWidth + 24, w * .6);
      } else if (sel && drawer) {
        // Keep the route clear of the details drawer (measured without its slide-in transform).
        const fixed = getComputedStyle(drawer).position === "fixed";
        const box = el.getBoundingClientRect();
        const drawerTop = (fixed ? innerHeight : box.bottom) - parseFloat(getComputedStyle(drawer).bottom || 0) - drawer.offsetHeight;
        pad.b = Math.min(Math.max(28, box.bottom - drawerTop + 16), h * .6);
      }
      const scale = Math.min((w - pad.l - pad.r) / ((e - wst) * kx), (h - pad.t - pad.b) / (n - s));
      const cx = (wst + e) / 2, cy = (s + n) / 2;
      const ox = pad.l + (w - pad.l - pad.r) / 2, oy = pad.t + (h - pad.t - pad.b) / 2;
      const X = (lo) => (ox + (lo - cx) * kx * scale).toFixed(1);
      const Y = (la) => (oy - (la - cy) * scale).toFixed(1);
      const pts = (path) => path.map(([la, lo]) => `${X(lo)},${Y(la)}`).join(" ");

      // Lat/lon grid with labels at least ~76px apart, for a sense of place.
      const step = [.05, .1, .25, .5, 1, 2, 5].find((d) => d * kx * scale >= 76) || 5;
      const dp = step >= 1 ? 0 : step === .5 || step === .1 ? 1 : 2;
      const viewLat = (oy - 0) / scale + cy, viewLatS = cy - (h - oy) / scale;
      const viewLonW = cx - ox / (kx * scale), viewLonE = cx + (w - ox) / (kx * scale);
      let grid = "";
      for (let la = Math.ceil(viewLatS / step) * step; la <= viewLat; la += step) {
        grid += `<line x1="0" x2="${w}" y1="${Y(la)}" y2="${Y(la)}"/><text x="6" y="${+Y(la) - 4}">${la.toFixed(dp)}°N</text>`;
      }
      for (let lo = Math.ceil(viewLonW / step) * step; lo <= viewLonE; lo += step) {
        grid += `<line y1="0" y2="${h}" x1="${X(lo)}" x2="${X(lo)}"/><text x="${+X(lo) + 4}" y="${h - 6}">${Math.abs(lo).toFixed(dp)}°W</text>`;
      }

      const cities = CITIES.map((c) => `<g class="city"><circle cx="${X(c.at[1])}" cy="${Y(c.at[0])}" r="3.5"/><text x="${+X(c.at[1]) + 7}" y="${+Y(c.at[0]) + 4}">${c.name}</text></g>`).join("");

      const base = color("--route", "#5b4636"), rust = color("--rust", "#c8431b"), ink = color("--ink", "#18201b"), paper = color("--paper", "#f4f1ea");
      const shown = routes.filter((r) => state.shown.includes(r.id));
      const isOn = (r) => r.id === state.selected || r.id === state.hover;
      const ordered = [...shown.filter((r) => !isOn(r)), ...shown.filter(isOn)];
      const lines = ordered.map((r) => {
        const on = isOn(r), p = pts(r.path), [sx, sy] = [X(r.path[0][1]), Y(r.path[0][0])];
        const dim = state.selected && !on ? .5 : .95;
        return `<g class="rt" data-id="${r.id}"><title>${r.name}</title>
          <polyline points="${p}" fill="none" stroke="#fff" stroke-width="${on ? 11 : 9}" stroke-linejoin="round" opacity=".95"/>
          <polyline points="${p}" fill="none" stroke="${on ? rust : base}" stroke-width="${on ? 6 : 5}" stroke-linejoin="round" opacity="${dim}"/>
          ${r.id === state.selected ? `<polyline class="ants" points="${p}" fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="0.1 12" stroke-linecap="round"/>` : ""}
          <circle cx="${sx}" cy="${sy}" r="6" fill="${paper}" stroke="${on ? rust : ink}" stroke-width="3"/>
        </g>`;
      }).join("");
      const label = sel && shown.includes(sel)
        ? `<text class="sel-label" x="${+X(sel.path[0][1]) + 12}" y="${+Y(sel.path[0][0]) + 4}">${sel.name}</text>` : "";

      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("aria-label", sel ? `Route outline of ${sel.name}. Map tiles unavailable.` : `Outlines of ${shown.length} routes. Map tiles unavailable.`);
      svg.innerHTML = `<g class="grid">${grid}</g>${cities}${lines}${label}`;
    }

    svg.addEventListener("click", (ev) => {
      const g = ev.target.closest(".rt");
      if (g) onSelect(g.dataset.id);
    });
    if (window.ResizeObserver) new ResizeObserver(draw).observe(el);
    else addEventListener("resize", draw);
    setStatus();

    return {
      update(next) {
        const changed = Object.keys(next).some((k) => String(next[k]) !== String(state[k]));
        Object.assign(state, next);
        if (changed) draw();
      }
    };
  }

  window.AtlasOffline = { init };
})();
