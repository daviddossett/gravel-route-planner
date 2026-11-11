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

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: FIXED_DATE });
});

test("demo loads with routes, a visible drawer, and Esc closes it", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${PAGE}?demo`);

  await expect(page.locator("#list .route").first()).toBeVisible();

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
    await expect(page.locator("#list .route").first()).toBeVisible();
    await expect(page.locator("#net-status")).toContainText("Offline");
  } finally {
    await context.setOffline(false);
  }

  expect(errors, "page and console errors").toEqual([]);
});

test("empty state keeps the listbox free of non-option children and reset works", async ({ page }) => {
  await page.goto(PAGE);
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
  await expect(page.locator("#list .route").first()).toBeVisible();
  const miles = async () => page.locator("#list .route .nums b:first-child").allTextContents().then((a) => a.map(Number));

  await page.locator("#sort").selectOption("miles");
  const byMiles = await miles();
  expect(byMiles.length).toBeGreaterThan(1);
  expect(byMiles).toEqual([...byMiles].sort((a, b) => a - b));

  await page.locator("#sort").selectOption("drive");
  expect(await miles()).not.toEqual(byMiles);
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
