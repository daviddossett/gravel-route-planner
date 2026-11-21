// @ts-check
// Browser smoke tests for Gravel Atlas (variants/atlas). Run with `npm test`.
const { test, expect } = require("@playwright/test");

const PAGE = "/variants/atlas/index.html";

// Routes only run in some months (none in Dec–Feb), and the month filter defaults to
// today's month. Pin the date so the suite doesn't go red every winter.
const FIXED_DATE = new Date("2026-07-15T12:00:00");

// Map tiles and CDN assets depend on the network; their failures aren't app bugs.
function isNetworkNoise(msg) {
  const text = msg.text();
  const url = msg.location().url || "";
  return /Failed to load resource|net::ERR_/.test(text) || /tile\.opentopomap\.org/.test(url + text);
}

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !isNetworkNoise(msg)) errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}

// On phones the route list is an overlay behind the "Routes" button.
test("Saved and Ridden marks export to JSON and import back, and bad files change nothing", async ({ page }) => {
  await page.goto(`${PAGE}?demo`);
  await expect(page.locator("#list .route").first()).toBeAttached();
  await page.locator("#save").click();
  await page.locator("#ridden").click();
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem("atlas.saved"))[0]);
  await openList(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#export-marks").click()]);
  expect(download.suggestedFilename()).toBe("gravel-atlas-routes.json");
  const exported = JSON.parse(require("fs").readFileSync(await download.path(), "utf8"));
  expect(exported).toEqual({ version: 1, saved: [id], ridden: [id] });

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("#saved-toggle")).toBeHidden();
  await page.locator("#import-file").setInputFiles({ name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ version: 1, saved: [id, "nope", 7], ridden: [id] })) });
  await expect(page.locator("#saved-toggle")).toHaveText("Saved (1)");
  await expect(page.locator("#list .saved-tag")).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem("atlas.saved"))).toBe(JSON.stringify([id]));

  await page.locator("#import-file").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("not json") });
  await expect(page.locator("#toast")).toContainText("Nothing changed");
  await expect(page.locator("#saved-toggle")).toHaveText("Saved (1)");
});

async function openList(page) {
  const toggle = page.locator("#panel-toggle");
  if (await toggle.isVisible() && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: FIXED_DATE });
});

test("demo loads with routes, a visible drawer, and Esc closes it", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${PAGE}?demo`);

  await expect(page.locator("#list .route").first()).toBeAttached();

  const drawer = page.locator("#drawer");
  await expect(drawer).toHaveClass(/\bopen\b/);
  await expect(drawer.locator("h2")).not.toBeEmpty();

  // The drawer must be what's actually painted where it sits, not covered by the list or map.
  const covered = await drawer.evaluate((d) => {
    const r = d.getBoundingClientRect();
    const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
    const left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth);
    if (bottom - top < 20 || right - left < 20) return [`drawer is off screen (${JSON.stringify(r)})`];
    const x = (left + right) / 2;
    const describe = (el) => el ? el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
      (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "") : "nothing";
    return [0.25, 0.5, 0.75].flatMap((f) => {
      const y = top + (bottom - top) * f;
      const hit = document.elementFromPoint(x, y);
      return hit && d.contains(hit) ? [] : [`(${Math.round(x)}, ${Math.round(y)}) hits ${describe(hit)}`];
    });
  });
  expect(covered, "drawer should be the topmost element at its own position").toEqual([]);

  await page.keyboard.press("Escape");
  await expect(drawer).not.toHaveClass(/\bopen\b/);

  expect(errors, "page and console errors").toEqual([]);
});

test("route list still renders offline after the first visit", async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto(PAGE);
  await openList(page);
  await expect(page.locator("#list .route").first()).toBeVisible();

  // Wait until the service worker controls the page and has saved the route data.
  await expect.poll(() => page.evaluate(async () => {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return "no controlling service worker";
    return (await caches.match(new URL("../../data/routes.js", location.href).href)) ? "ready" : "routes.js not cached";
  }), { message: "service worker should control the page and cache the route data", timeout: 10_000 }).toBe("ready");

  await context.setOffline(true);
  try {
    // Prove the network is really gone, including for the service worker.
    const reachable = await page.evaluate(() => fetch("/README.md", { cache: "no-store" }).then(() => true, () => false));
    expect(reachable, "uncached files should fail to load while offline").toBe(false);

    await page.reload();
    await openList(page);
    await expect(page.locator("#list .route").first()).toBeVisible();
    await expect(page.locator("#net-status")).toContainText("Offline");
  } finally {
    await context.setOffline(false);
  }

  expect(errors, "page and console errors").toEqual([]);
});

test("empty state keeps the listbox free of non-option children and reset works", async ({ page }) => {
  await page.goto(PAGE);
  await openList(page);
  await expect(page.locator("#list .route").first()).toBeVisible();

  await page.locator("#dist").fill("25");
  await page.locator("#gain").fill("1500");
  await page.locator("#grav").fill("100");
  await expect(page.locator("#empty")).toBeVisible();
  expect(await page.locator("#list").getAttribute("role")).toBe("listbox");
  expect(await page.locator("#list > :not([role=option])").count()).toBe(0);

  await page.locator("#reset2").click();
  await expect(page.locator("#empty")).toBeHidden();
  await expect(page.locator("#list .route").first()).toBeVisible();
  await expect(page.locator("#count")).toHaveText(/^(\d+) of \1 routes$/);
});

test("Max fun type filter limits the list, round-trips through the URL and resets", async ({ page }) => {
  await page.goto(PAGE);
  await openList(page);
  await expect(page.locator("#list .route").first()).toBeVisible();
  await expect(page.locator("#fun")).toHaveValue("5");
  await expect(page.locator("#fun-out")).toHaveText("any");
  const total = await page.locator("#list .route").count();
  const labels = () => page.locator("#list .route .fun").allTextContents();

  await page.locator("#fun").fill("2");
  await expect(page.locator("#fun-out")).toHaveText("≤ Cruisy");
  const shown = await labels();
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.length).toBeLessThan(total);
  for (const l of shown) expect(["Chill", "Cruisy"]).toContain(l);
  expect(page.url()).toContain("fun=2");

  await page.goto(PAGE + "?fun=2");
  await openList(page);
  await expect(page.locator("#fun")).toHaveValue("2");
  expect(await labels()).toEqual(shown);

  await page.goto(PAGE + "?fun=bogus");
  await expect(page.locator("#fun")).toHaveValue("5");

  await page.goto(PAGE + "?fun=2");
  await openList(page);
  await page.locator("#reset").click();
  await expect(page.locator("#fun")).toHaveValue("5");
  expect(page.url()).not.toContain("fun=");
});

test("sort control reorders the route list", async ({ page }) => {
  await page.goto(PAGE);
  await openList(page);
  await expect(page.locator("#list .route").first()).toBeVisible();
  const miles = async () => page.locator("#list .route .nums b:first-child").allTextContents().then((a) => a.map(Number));

  await page.locator("#sort").selectOption("miles");
  const byMiles = await miles();
  expect(byMiles.length).toBeGreaterThan(1);
  expect(byMiles).toEqual([...byMiles].sort((a, b) => a - b));

  await page.locator("#sort").selectOption("drive");
  expect(await miles()).not.toEqual(byMiles);

  await page.locator("#sort").selectOption("gravel");
  const gravel = await page.evaluate(() => [...document.querySelectorAll("#list .route")].map((r) => r.dataset.id));
  const pct = await page.evaluate((ids) => ids.map((id) => window.PNW_ROUTES.find((r) => r.id === id).gravel), gravel);
  expect(pct).toEqual([...pct].sort((a, b) => b - a));
});

test("on phones the route list is a toggleable overlay over a full-height map", async ({ page }) => {
  test.skip(!(page.viewportSize() && page.viewportSize().width <= 760), "phone layout only");
  await page.goto(PAGE);
  const toggle = page.locator("#panel-toggle");
  await expect(page.locator("#list")).toBeHidden();
  const mapBox = await page.locator("#map").boundingBox();
  expect(mapBox.height).toBeGreaterThan(page.viewportSize().height - 2);

  // The toggle must be a real touch target painted above the map tiles (stand in a tile-sized block for them) and the open list.
  const onTop = () => toggle.evaluate((el) => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { w: r.width, h: r.height, onTop: !!hit && el.contains(hit) };
  });
  await expect(toggle).toHaveAttribute("aria-controls", "panel");
  await page.locator("#map .leaflet-tile-pane").evaluate((pane) => {
    pane.append(Object.assign(document.createElement("div"), { style: "position:absolute;left:-2000px;top:-2000px;width:4000px;height:4000px;background:#fff;pointer-events:auto" }));
  });
  const closed = await onTop();
  expect(closed.onTop, "Routes toggle should not be covered by the map").toBe(true);
  expect(Math.min(closed.w, closed.h)).toBeGreaterThanOrEqual(44);

  await toggle.click();
  await expect(page.locator("#list .route").first()).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect((await onTop()).onTop, "toggle should stay visible over the open list").toBe(true);
  await expect(page.locator("#theme")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator("#list")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await page.locator("#list .route").first().click();
  await expect(page.locator("#list")).toBeHidden();
  await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
});

test("theme picker switches themes and remembers the choice", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_DATE);
  await page.goto(`${PAGE}?demo`);
  await openList(page);
  await page.locator("#theme").selectOption("midnight");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await page.reload();
  await expect(page.locator("#theme")).toHaveValue("midnight");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
});

test("IDE themes apply and set dark mode flag", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_DATE);
  await page.goto(`${PAGE}?demo`);
  await openList(page);
  for (const [theme, dark] of [["dracula", "1"], ["solarizedlight", "0"], ["tokyonight", "1"]]) {
    await page.locator("#theme").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-dark", dark);
  }
});

test("saving a route keeps it across reloads and the Saved filter narrows the list", async ({ page }) => {
  await page.goto(`${PAGE}?demo`);
  const rows = page.locator("#list .route");
  await expect(rows.first()).toBeAttached();
  const total = await rows.count();
  await expect(page.locator("#saved-toggle")).toBeHidden();

  const save = page.locator("#save");
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await save.click();
  await expect(save).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#list .saved-tag")).toHaveCount(1);

  await page.reload();
  const toggle = page.locator("#saved-toggle");
  await expect(toggle).toHaveText("Saved (1)");
  await page.keyboard.press("Escape"); // close the route drawer
  await openList(page);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(1);

  await page.locator("#reset").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await rows.count()).toBeGreaterThan(total - 1);
});

test("printing shows only the route drawer, not the map or list", async ({ page }) => {
  await page.goto(`${PAGE}?demo`);
  await expect(page.locator("#drawer.open")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#drawer h2")).toBeVisible();
  await expect(page.locator("#pack")).toBeVisible();
  await expect(page.locator("#map")).toBeHidden();
  await expect(page.locator("#list")).toBeHidden();
  await expect(page.locator("#drawer .close")).toBeHidden();
});

test("state and month filters narrow the list and the count", async ({ page }) => {
  await page.goto(PAGE);
  await openList(page);
  const rows = page.locator("#list .route");
  await expect(rows.first()).toBeVisible();

  await page.locator("#months button[aria-label=January]").click();
  await expect(page.locator("#month-out")).toHaveText("January");
  await expect(page.locator("#empty")).toBeVisible();

  // Clicking the active month again clears it.
  await page.locator("#months button[aria-label=January]").click();
  await expect(page.locator("#month-out")).toHaveText("Any month");
  await expect(rows.first()).toBeVisible();
  const total = await rows.count();

  await page.locator('#state button[data-v="WA"]').click();
  await expect(page.locator('#state button[data-v="WA"]')).toHaveAttribute("aria-pressed", "true");
  await expect(rows.first()).toBeVisible();
  await expect(rows.locator(".where", { hasText: ", OR" })).toHaveCount(0);
  const wa = await rows.count();
  expect(wa).toBeGreaterThan(0);
  expect(wa).toBeLessThan(total);
  await expect(page.locator("#count")).toHaveText(new RegExp(`^${wa} of \\d+ routes$`));
});

test("search box narrows the list, lands in the URL, restores from it and resets", async ({ page }) => {
  await page.goto(`${PAGE}?month=any`);
  await openList(page);
  const rows = page.locator("#list .route");
  await expect(rows.first()).toBeVisible();
  const total = await rows.count();
  const box = page.getByRole("searchbox", { name: "Search routes" });
  expect((await box.boundingBox()).height).toBeGreaterThanOrEqual(24);

  await box.fill("  IRON horse ");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(total);
  await expect(rows.first()).toContainText(/iron horse/i);
  await expect(page.locator("#count")).toHaveText(new RegExp(`^${n} of ${total} routes$`));
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("IRON horse");

  await box.fill("zzzz-no-such-route");
  await expect(page.locator("#empty")).toBeVisible();

  await page.reload();
  await openList(page);
  await expect(box).toHaveValue("zzzz-no-such-route");
  await page.locator("#reset2").click();
  await expect(box).toHaveValue("");
  await expect(rows).toHaveCount(total);
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
});

test("units toggle shows km and m in filters, list and drawer, and leaves the URL alone", async ({ page }) => {
  await page.goto(`${PAGE}?month=any`);
  await openList(page);
  const first = page.locator("#list .route").first();
  await expect(first.locator(".nums")).toContainText(/mi · .*ft/);
  await expect(page.locator("#dist-out")).toContainText("mi");
  await first.click();
  await expect(page.locator("#drawer .stats")).toContainText("miles");
  const url = page.url();

  await openList(page);
  await page.locator("#units").selectOption("metric");
  await expect(first.locator(".nums")).toContainText(/km · .*m\b/);
  await expect(first.locator(".nums")).not.toContainText(" mi ");
  await expect(page.locator("#dist-out")).toContainText("km");
  await expect(page.locator("#gain-out")).toContainText(/ m$/);
  await expect(page.locator("#drawer .stats")).toContainText("kilometers");
  await expect(page.locator("#drawer .stats")).not.toContainText("miles");
  await expect(page.locator("#drawer .profile svg")).toHaveAttribute("aria-label", /meters$/);
  expect(page.url()).toBe(url);
  expect(await page.locator("#dist").inputValue()).toBe("70");

  await page.reload();
  await expect(page.locator("#units")).toHaveValue("metric");
  await expect(page.locator("#dist-out")).toContainText("km");
});

test("drive origin changes the listed drive times and is remembered", async ({ page }) => {
  await page.goto(`${PAGE}?month=any`);
  await openList(page);
  const nums = page.locator("#list .route .nums");
  await expect(nums.first()).toContainText("from SEA");

  await page.locator('#origin button[data-v="pdx"]').click();
  await expect(nums.first()).toContainText("from PDX");
  await expect(nums.filter({ hasText: "from SEA" })).toHaveCount(0);

  await page.goto(`${PAGE}?month=any`);
  await expect(page.locator('#origin button[data-v="pdx"]')).toHaveAttribute("aria-pressed", "true");
  await expect(nums.first()).toContainText("from PDX");
});

test("route list is keyboard operable: arrows move focus, Enter opens the drawer, Esc returns focus", async ({ page }) => {
  await page.goto(PAGE);
  await openList(page);
  const rows = page.locator("#list .route");
  await expect(rows.first()).toBeVisible();
  const last = rows.last();
  const second = rows.nth(1);

  // Roving tabindex: exactly one row is in the tab order.
  await expect(page.locator('#list .route[tabindex="0"]')).toHaveCount(1);

  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("End");
  await expect(last).toBeFocused();
  await page.keyboard.press("Home");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(rows.first()).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();
  await page.keyboard.press("Enter");
  const drawer = page.locator("#drawer");
  await expect(drawer).toHaveClass(/\bopen\b/);
  await expect(second).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Escape");
  await expect(drawer).not.toHaveClass(/\bopen\b/);
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected", "false");
});

test("deep link opens the linked route with its filters, and the URL follows the selection", async ({ page }) => {
  await page.goto(`${PAGE}?route=klickitat&month=any&origin=pdx&state=WA`);
  const drawer = page.locator("#drawer");
  await expect(drawer).toHaveClass(/\bopen\b/);
  await expect(drawer.locator("h2")).toContainText("Klickitat Trail");
  await expect(page.locator('#list .route[aria-selected="true"]')).toHaveCount(1);
  await expect(page.locator('#state button[data-v="WA"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('#origin button[data-v="pdx"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#month-out")).toHaveText("Any month");

  expect(new URL(page.url()).searchParams.get("route")).toBe("klickitat");
  await page.keyboard.press("Escape");
  await expect(drawer).not.toHaveClass(/\bopen\b/);
  await expect.poll(() => new URL(page.url()).searchParams.has("route")).toBe(false);
  expect(new URL(page.url()).searchParams.get("state")).toBe("WA");
});

test("deep link to a route hidden by the default filters loosens them and says so", async ({ page }) => {
  // Klickitat is a WA route not ridden in January, so both month=1 and state=OR hide it.
  await page.goto(`${PAGE}?route=klickitat&month=1&state=OR`);
  await expect(page.locator("#toast")).toHaveText("Filters loosened to show the linked route");
  await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
  await expect(page.locator("#drawer h2")).toContainText("Klickitat Trail");
  await expect(page.locator('#state button[data-v="all"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#month-out")).toHaveText("Any month");
});

test("drawer shows a ride-time estimate that follows and remembers the chosen pace", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${PAGE}?demo`);
  const est = page.locator("#drawer #est");
  await expect(est).toContainText(/About \d+h.* riding at a steady pace, plus .* driving each way/);
  const steady = await est.textContent();

  await page.locator("#pace").getByRole("button", { name: "Fast" }).click();
  await expect(est).toContainText("fast pace");
  expect(await est.textContent()).not.toBe(steady);
  await expect(page.locator("#pace button[aria-pressed='true']")).toHaveText("Fast");

  await page.reload();
  await expect(page.locator("#pace button[aria-pressed='true']")).toHaveText("Fast");
  expect(errors).toEqual([]);
});

test("drawer suggests a start-by time from sunset and follows the pace", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${PAGE}?demo`);
  const sun = page.locator("#drawer #daylight");
  await expect(sun).toContainText(/Sunset is about [89]:\d\d PM today\. Start by \d{1,2}:\d\d [AP]M to finish with 30 minutes/);
  const steady = await sun.textContent();
  await page.locator("#pace").getByRole("button", { name: "Relaxed" }).click();
  expect(await sun.textContent()).not.toBe(steady);

  await page.clock.setSystemTime(new Date("2026-12-15T12:00:00"));
  await page.locator("#drawer .close").click();
  await openList(page);
  await page.locator("#list [role=option]").first().click();
  await expect(sun).toContainText(/Sunset is about 4:\d\d PM today/);
  expect(errors).toEqual([]);
});

test("drawer lists what to pack, scaled to the chosen pace", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${PAGE}?demo`);
  const pack = page.locator("#drawer #pack");
  await expect(page.locator("#drawer").getByRole("heading", { name: "Pack for it" })).toBeVisible();
  await expect(pack).toContainText(/\d+ L|water/i);
  await expect(pack).toContainText("Signal is spotty");

  await page.locator("#pace").getByRole("button", { name: "Relaxed" }).click();
  const relaxed = await pack.textContent();
  await page.locator("#pace").getByRole("button", { name: "Fast" }).click();
  expect(await pack.textContent()).not.toBe(relaxed);
  expect(errors).toEqual([]);
});

test("drawer links to driving directions for the route's start", async ({ page }) => {
  await page.goto(`${PAGE}?route=gales-creek`);
  const link = page.locator("#drawer #directions");
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toContain("https://www.google.com/maps/dir/?api=1");
  expect(href).toContain("destination=45.594,-123.199");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAccessibleName(/Gales Creek/);
});

test("drawer links to the weather forecast for the route's start", async ({ page }) => {
  await page.goto(`${PAGE}?route=gales-creek`);
  const link = page.locator("#drawer #forecast");
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toContain("https://forecast.weather.gov/MapClick.php");
  expect(href).toContain("lat=45.594");
  expect(href).toContain("lon=-123.199");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAccessibleName(/Gales Creek/);
});

test("drawer describes climbing per mile from the route's stats", async ({ page }) => {
  await page.goto(`${PAGE}?route=gales-creek`);
  // 4,300 ft over 42 mi is about 102 ft per mile
  await expect(page.locator("#drawer #climb-feel")).toHaveText("Climbing feel: Hilly, about 102 ft of climbing per mile.");
});

test("drawer links meet the 24px minimum target height", async ({ page }) => {
  await page.goto(`${PAGE}?route=gales-creek`);
  for (const id of ["#directions", "#forecast"]) {
    const box = await page.locator(`#drawer ${id}`).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(24);
  }
});

test("drawer checks the route against my tire width and remembers it", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${PAGE}?demo`);
  const fit = page.locator("#drawer #tire-fit");
  await expect(fit).toContainText("Pick yours to check the fit");

  await page.locator("#my-tire").selectOption("50");
  await expect(fit).toContainText("good fit");
  await page.locator("#my-tire").selectOption("32");
  await expect(fit).toContainText("too narrow");

  await page.reload();
  await expect(page.locator("#my-tire")).toHaveValue("32");
  await expect(fit).toContainText("too narrow");
  expect(errors).toEqual([]);
});

test("drawer downloads an offline ride brief with the pack list", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${PAGE}?demo`);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download-brief").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/-ride-brief\.txt$/);
  const text = require("fs").readFileSync(await download.path(), "utf8");
  expect(text).toContain("Pack for it:");
  expect(text).toContain("Signal is spotty");
  expect(text).toContain("Water:");
  await expect(page.locator("#toast")).toContainText("saved");
  expect(errors).toEqual([]);
});

test("drawer downloads an approximate GPX of the route path", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${PAGE}?demo`);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download-gpx").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.gpx$/);
  const text = require("fs").readFileSync(await download.path(), "utf8");
  expect(text).toContain("<trkpt lat=");
  expect(text).toContain("Approximate path only");
  expect(errors).toEqual([]);
});

test("drawer compares the route with another and keeps the lower value marked", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${PAGE}?demo`);
  const out = page.locator("#drawer #compare-out");
  await expect(out).toBeEmpty();
  await expect(page.locator("#compare-with option[value]:not([value=''])").first()).toBeAttached();
  const other = await page.locator("#compare-with option").nth(1).getAttribute("value");
  await page.locator("#compare-with").selectOption(other);
  await expect(out.locator("tbody tr")).toHaveCount(7);
  await expect(out.locator("tbody th").first()).toHaveText("Distance");
  await page.locator("#compare-with").selectOption("");
  await expect(out).toBeEmpty();
  expect(errors).toEqual([]);
});

test("drawer copies a ride plan for a friend using the chosen start time", async ({ page, context }) => {
  const errors = watchErrors(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${PAGE}?demo`);
  await page.locator("#plan-start").fill("08:00");
  await page.locator("#copy-plan").click();
  await expect(page.locator("#toast")).toContainText("Ride plan copied");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("around 8:00 AM");
  expect(text).toContain("Expect me back by about");
  expect(text).toContain("google.com/maps/dir");
  expect(text).toContain("haven't heard from me");
  expect(errors).toEqual([]);
});

test("distance and climbing sliders narrow the list, update the count and land in the URL", async ({ page }) => {
  await page.goto(`${PAGE}?month=any`);
  await openList(page);
  const rows = page.locator("#list .route");
  await expect(rows.first()).toBeVisible();
  const total = await rows.count();

  await page.locator("#dist").fill("40");
  await expect(page.locator("#dist-out")).toContainText("40");
  await expect(rows).not.toHaveCount(total);
  const n = await rows.count();
  expect(n).toBeLessThan(total);
  await expect(page.locator("#count")).toHaveText(new RegExp(`^${n} of ${total} routes$`));
  await expect.poll(() => new URL(page.url()).searchParams.get("dist")).toBe("40");

  await page.locator("#gain").fill("3000");
  await expect.poll(() => new URL(page.url()).searchParams.get("gain")).toBe("3000");
  await expect.poll(() => rows.count()).toBeLessThanOrEqual(n);

  await page.locator("#dist").fill("70");
  await page.locator("#gain").fill("6000");
  await expect(rows).toHaveCount(total);
  await expect.poll(() => new URL(page.url()).searchParams.has("dist")).toBe(false);
});

test("Copy link puts a shareable URL with the route and filters on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${PAGE}?route=klickitat&month=any&origin=pdx&state=WA`);
  await page.locator("#copy-link").click();
  await expect(page.locator("#toast")).toContainText("Link copied");

  const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(link.pathname).toBe(PAGE);
  expect(link.searchParams.get("route")).toBe("klickitat");
  expect(link.searchParams.get("state")).toBe("WA");
  expect(link.searchParams.get("origin")).toBe("pdx");
  expect(link.searchParams.get("month")).toBe("any");

  // The copied link reopens the same view in a fresh visit.
  await page.goto(link.pathname + link.search);
  await expect(page.locator("#drawer h2")).toContainText("Klickitat Trail");
  await expect(page.locator('#state button[data-v="WA"]')).toHaveAttribute("aria-pressed", "true");
});

test("Share button appears only with navigator.share and shares the route link", async ({ page }) => {
  await page.goto(`${PAGE}?route=klickitat&month=any&state=WA`);
  await expect(page.locator("#drawer h2")).toContainText("Klickitat Trail");
  await expect(page.locator("#share")).toHaveCount(0);

  await page.addInitScript(() => { window.__shared = []; navigator.share = (data) => { window.__shared.push(data); return Promise.resolve(); }; });
  await page.goto(`${PAGE}?route=klickitat&month=any&state=WA`);
  const btn = page.locator("#share");
  await expect(btn).toBeVisible();
  expect((await btn.boundingBox()).height).toBeGreaterThanOrEqual(24);
  await btn.focus();
  await page.keyboard.press("Enter");
  const shared = await page.evaluate(() => window.__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0].title).toContain("Klickitat Trail");
  expect(new URL(shared[0].url).searchParams.get("route")).toBe("klickitat");
});

test("Share is silent on cancel and falls back to copying the link on other errors", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => { navigator.share = () => Promise.reject(new DOMException("cancelled", "AbortError")); });
  await page.goto(`${PAGE}?route=klickitat&month=any&state=WA`);
  await page.locator("#share").click();
  await page.waitForTimeout(300);
  await expect(page.locator("#toast")).not.toHaveClass(/show/);

  await page.evaluate(() => { navigator.share = () => Promise.reject(new Error("nope")); });
  await page.locator("#share").click();
  await expect(page.locator("#toast")).toContainText("Link copied");
});

test("Spin picks a different matching route, opens it and announces it", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${PAGE}?route=klickitat&month=any&state=WA`);
  await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
  const start = new URL(page.url()).searchParams.get("route");

  // Spin jumps via setTimeout, which the pinned clock holds back until it runs again.
  await page.clock.resume();
  await openList(page);
  await page.locator("#spin").click();
  await expect(page.locator("#toast")).toContainText("The compass says:");
  await expect.poll(() => new URL(page.url()).searchParams.get("route")).not.toBe(start);
  // Spin only draws from the routes that match the current filters.
  const picked = page.locator('#list .route[aria-selected="true"]');
  await expect(picked).toHaveCount(1);
  await expect(page.locator("#drawer h2")).toContainText(
    (await page.locator("#toast").innerText()).replace("The compass says: ", "").trim(),
  );
  await expect(page.locator("#drawer .area")).toContainText(", WA");
  expect(errors).toEqual([]);
});

test("Spin with nothing matching says so and keeps the current selection", async ({ page }) => {
  await page.goto(`${PAGE}?month=any`);
  await openList(page);
  await page.locator("#dist").fill("25");
  await page.locator("#gain").fill("1500");
  await page.locator("#grav").fill("100");
  await expect(page.locator("#empty")).toBeVisible();

  await page.locator("#spin").click();
  await expect(page.locator("#toast")).toContainText("Nothing to spin to");
  await expect(page.locator("#drawer")).not.toHaveClass(/\bopen\b/);
});

test("marking a route as ridden tags it, persists, and Not ridden yet hides it", async ({ page }) => {
  await page.goto(`${PAGE}?demo`);
  const rows = page.locator("#list .route");
  await expect(rows.first()).toBeAttached();
  const total = await rows.count();
  await expect(page.locator("#ridden-toggle")).toBeHidden();

  const ridden = page.locator("#ridden");
  await expect(ridden).toHaveAttribute("aria-pressed", "false");
  await ridden.click();
  await expect(ridden).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#list .saved-tag", { hasText: "Ridden" })).toHaveCount(1);

  await page.reload();
  const toggle = page.locator("#ridden-toggle");
  await page.keyboard.press("Escape"); // close the route drawer
  await openList(page);
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(total - 1);

  await page.locator("#reset").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await rows.count()).toBeGreaterThan(total - 1);
});

test("empty state offers one-step loosening with counts and applies it", async ({ page }) => {
  await page.goto(PAGE);
  await openList(page);
  await page.locator("#dist").fill("25");
  await page.locator("#grav").fill("90");
  await expect(page.locator("#empty")).toBeVisible();
  const hint = page.locator("#empty-hints button").first();
  await expect(hint).toHaveText(/\(\d+ routes?\)/);
  await hint.click();
  await expect(page.locator("#empty")).toBeHidden();
  await expect(page.locator("#list .route").first()).toBeVisible();
  await expect(page.locator("#list .route[tabindex='0']")).toBeFocused();
});

test("link-preview image URLs are absolute", async ({ page }) => {
  await page.goto(PAGE);
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[property="og:url"]']) {
    await expect(page.locator(sel)).toHaveAttribute("content", /^https:\/\//);
  }
});

test("sort order lands in the URL and is restored from a link", async ({ page }) => {
  await page.goto(`${PAGE}?month=any`);
  await openList(page);
  await page.locator("#sort").selectOption("miles");
  await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("miles");
  await page.locator("#sort").selectOption("drive");
  await expect.poll(() => new URL(page.url()).searchParams.has("sort")).toBe(false);

  await page.goto(`${PAGE}?month=any&sort=gain`);
  await expect(page.locator("#sort")).toHaveValue("gain");
  await page.goto(`${PAGE}?month=any&sort=bogus`);
  await expect(page.locator("#sort")).toHaveValue("drive");
});

test("Fits my tires filters the list by the saved tire size and clears with it", async ({ page }) => {
  await page.goto(`${PAGE}?demo&month=any`);
  const rows = page.locator("#list .route");
  await expect(rows.first()).toBeAttached();
  const total = await rows.count();
  const toggle = page.locator("#tire-toggle");
  await expect(toggle).toBeHidden();

  await page.locator("#my-tire").selectOption("42");
  await page.keyboard.press("Escape"); // close the route drawer
  await openList(page);
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const fitting = await page.evaluate(() => window.PNW_ROUTES.filter((r) => r.tire <= 42).length);
  await expect(page.locator("#count")).toContainText(`${fitting} of`);
  const shown = await rows.count();
  expect(shown).toBeLessThan(total);
  expect(shown).toBeLessThanOrEqual(fitting);

  await rows.first().focus();
  await page.keyboard.press("Enter");
  await page.locator("#my-tire").selectOption("50");
  await page.keyboard.press("Escape");
  await openList(page);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const fitting50 = await page.evaluate(() => window.PNW_ROUTES.filter((r) => r.tire <= 50).length);
  await expect(page.locator("#count")).toContainText(`${fitting50} of`);

  await toggle.click();
  await expect(rows).toHaveCount(total);
  await toggle.click();
  await page.locator("#reset").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await rows.first().focus();
  await page.keyboard.press("Enter");
  await page.locator("#my-tire").selectOption("0");
  await expect(toggle).toBeHidden();
  await expect(rows).toHaveCount(total);
});

test("Fit map to results zooms to the filtered routes and Reset re-fits all", async ({ page }) => {
  await page.goto(`${PAGE}?demo&month=any`);
  await openList(page);
  await expect(page.locator("#list .route").first()).toBeVisible();
  const btn = page.getByRole("button", { name: "Fit map to results" });
  await expect(btn).toBeVisible();
  expect((await btn.boundingBox()).height).toBeGreaterThanOrEqual(24);

  const span = () => page.locator("#map .start-pin").evaluateAll((pins) => {
    const xs = pins.map((p) => p.getBoundingClientRect()).map((r) => r.left);
    return xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  });
  await page.locator('#state button[data-v="WA"]').click();
  const closeList = async () => {
    const toggle = page.locator("#panel-toggle");
    if (await toggle.isVisible() && (await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
  };
  await closeList();
  await page.locator(".leaflet-control-zoom-out").click();
  await page.locator(".leaflet-control-zoom-out").click();
  await page.waitForTimeout(600);
  const before = await span();
  await btn.click();
  await expect.poll(span).toBeGreaterThan(before);
  const box = await page.locator("#map").boundingBox();
  const inView = await page.locator("#map .start-pin").evaluateAll((pins, b) => pins.every((p) => {
    const r = p.getBoundingClientRect();
    return r.left >= b.x && r.right <= b.x + b.width && r.top >= b.y && r.bottom <= b.y + b.height;
  }), box);
  expect(inView).toBe(true);

  await openList(page);
  await page.locator("#reset").click();
  await closeList();
  const total = await page.locator("#list .route").count();
  await expect.poll(() => page.locator("#map .start-pin").count()).toBe(total);
});

test("elevation profile shows a hover and keyboard readout and Esc hides it without closing the drawer", async ({ page }) => {
  await page.goto(`${PAGE}?month=any&demo`);
  await openList(page);
  await page.locator("#list .route").first().click();
  const drawer = page.locator("#drawer");
  await expect(drawer).toHaveClass(/\bopen\b/);
  const svg = drawer.locator(".profile svg");
  const readout = drawer.locator("#profile-readout");
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect(readout).toHaveText(/^Mile \d+ · [\d,]+ ft/);
  await expect(svg.locator(".guide")).toHaveAttribute("visibility", "visible");

  await page.mouse.move(0, 0);
  await expect(readout).toHaveText("");
  await svg.focus();
  await page.keyboard.press("ArrowRight");
  await expect(readout).toHaveText(/^Mile 0 · [\d,]+ ft/);
  const first = await readout.textContent();
  await page.keyboard.press("ArrowRight");
  await expect(readout).not.toHaveText(first);
  await expect(svg).toHaveAttribute("aria-valuetext", /^Mile \d+ · /);

  await page.keyboard.press("Escape");
  await expect(readout).toHaveText("");
  await expect(drawer).toHaveClass(/\bopen\b/);
});

test("Has water on route hides routes with no water, round-trips through the URL and resets", async ({ page }) => {
  await page.goto(PAGE + "?month=any");
  await openList(page);
  const toggle = page.locator("#water-toggle");
  const rows = page.locator("#list .route");
  await expect(rows.first()).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const total = await rows.count();
  const noWater = await page.evaluate(() => window.PNW_ROUTES.filter((r) => r.water === "none").length);
  expect(noWater).toBeGreaterThan(0);
  expect(page.url()).not.toContain("water=");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(total - noWater);
  await expect(page.locator("#count")).toHaveText(`${total - noWater} of ${total} routes`);
  expect(page.url()).toContain("water=1");

  await page.goto(PAGE + "?month=any&water=1");
  await openList(page);
  await expect(page.locator("#water-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(total - noWater);

  await page.locator("#reset").click();
  await expect(page.locator("#water-toggle")).toHaveAttribute("aria-pressed", "false");
  expect(page.url()).not.toContain("water=");
});

test("No pass needed shows only pass-free routes, round-trips through the URL and resets", async ({ page }) => {
  await page.goto(PAGE + "?month=any");
  await openList(page);
  const toggle = page.locator("#nopass-toggle");
  const rows = page.locator("#list .route");
  await expect(rows.first()).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const total = await rows.count();
  const free = await page.evaluate(() => window.PNW_ROUTES.filter((r) => !r.pass).length);
  expect(free).toBeGreaterThan(0);
  expect(free).toBeLessThan(total);
  expect(page.url()).not.toContain("nopass=");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(free);
  await expect(page.locator("#count")).toHaveText(`${free} of ${total} routes`);
  expect(page.url()).toContain("nopass=1");

  await page.goto(PAGE + "?month=any&nopass=1");
  await openList(page);
  await expect(page.locator("#nopass-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(free);

  await page.locator("#reset").click();
  await expect(page.locator("#nopass-toggle")).toHaveAttribute("aria-pressed", "false");
  expect(page.url()).not.toContain("nopass=");
});
