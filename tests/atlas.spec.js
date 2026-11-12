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
});

test("on phones the route list is a toggleable overlay over a full-height map", async ({ page }) => {
  test.skip(!(page.viewportSize() && page.viewportSize().width <= 760), "phone layout only");
  await page.goto(PAGE);
  const toggle = page.locator("#panel-toggle");
  await expect(page.locator("#list")).toBeHidden();
  const mapBox = await page.locator("#map").boundingBox();
  expect(mapBox.height).toBeGreaterThan(page.viewportSize().height - 2);

  await toggle.click();
  await expect(page.locator("#list .route").first()).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  await page.locator("#list .route").first().click();
  await expect(page.locator("#list")).toBeHidden();
  await expect(page.locator("#drawer")).toHaveClass(/\bopen\b/);
});

test("theme picker switches themes and remembers the choice", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_DATE);
  await page.goto(`${PAGE}?demo`);
  await page.locator("#theme").selectOption("midnight");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await page.reload();
  await expect(page.locator("#theme")).toHaveValue("midnight");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
});

test("IDE themes apply and set dark mode flag", async ({ page }) => {
  await page.clock.setFixedTime(FIXED_DATE);
  await page.goto(`${PAGE}?demo`);
  for (const [theme, dark] of [["dracula", "1"], ["solarizedlight", "0"], ["tokyonight", "1"]]) {
    await page.locator("#theme").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-dark", dark);
  }
});

test("saving a route keeps it across reloads and the Saved filter narrows the list", async ({ page }) => {
  await page.goto(`${PAGE}?demo`);
  const rows = page.locator("#list .route");
  await expect(rows.first()).toBeVisible();
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
  await page.keyboard.press("Escape"); // the phone sheet covers the list
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(rows).toHaveCount(1);

  await page.locator("#reset").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(await rows.count()).toBeGreaterThan(total - 1);
});

test("state and month filters narrow the list and the count", async ({ page }) => {
  await page.goto(PAGE);
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

test("drive origin changes the listed drive times and is remembered", async ({ page }) => {
  await page.goto(`${PAGE}?month=any`);
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
