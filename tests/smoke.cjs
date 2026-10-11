// Run: npm install; npx playwright install chromium; npm test
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
const server = http.createServer((req, res) => {
  const file = path.resolve(
    root,
    "." +
      decodeURIComponent(
        new URL(req.url, "http://localhost").pathname.replace(
          /\/$/,
          "/index.html",
        ),
      ),
  );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: [
            "--no-sandbox",
            "--no-zygote",
            "--single-process",
            "--disable-dev-shm-usage",
          ],
        }
      : {}),
  });
  try {
    const errors = [],
      missing = [];
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) missing.push(r.url());
    });
    await page.goto(url);
    assert.equal(await page.locator(".desktop-app").count(), 1);
    assert.equal(await page.locator(".app-window").count(), 0);
    await page.click("#login-button");
    await page.waitForSelector('[data-app-window="terminal"]');
    const start = Date.now();
    assert.equal(await page.locator(".command-form").isVisible(), false);
    await page.waitForSelector('.transfer[data-state="running"]');
    assert.equal(
      await page.locator('.transfer[data-state="running"]').count(),
      1,
    );
    await page.waitForSelector(".command-form:not([hidden])", {
      timeout: 15000,
    });
    const elapsed = (Date.now() - start) / 1000;
    assert.ok(elapsed >= 6 && elapsed <= 10, `boot duration ${elapsed}s`);
    assert.equal(await page.locator(".directory a").count(), 8);
    assert.equal(
      await page.locator('.transfer[data-state="complete"]').count(),
      4,
    );
    assert.match(
      await page.locator(".screen").innerText(),
      /NC-77 access point acquired/,
    );
    const win = page.locator('[data-app-window="terminal"]');
    const title = win.locator(".titlebar");
    const before = await win.boundingBox();
    const bar = await title.boundingBox();
    await page.mouse.move(bar.x + 180, bar.y + 16);
    await page.mouse.down();
    await page.mouse.move(bar.x + 280, bar.y + 66, { steps: 10 });
    await page.mouse.up();
    const after = await win.boundingBox();
    assert.ok(
      after.x - before.x > 80 && after.y - before.y > 30,
      "titlebar dragging",
    );
    await win.locator('[data-control="maximize"]').click();
    assert.equal(await win.getAttribute("data-mode"), "maximized");
    await win.locator('[data-control="maximize"]').click();
    assert.equal(await win.getAttribute("data-mode"), "windowed");
    await win.locator('[data-control="minimize"]').click();
    assert.equal(await win.isVisible(), false);
    await page.click('[data-app-task="terminal"]');
    assert.equal(await win.isVisible(), true);
    await win.locator('[data-control="close"]').click();
    const reopen = Date.now();
    await page.click('[data-app-icon="terminal"]');
    await page.waitForSelector(".command-form:not([hidden])");
    assert.ok(Date.now() - reopen < 1000);
    assert.equal(await page.locator(".transfer").count(), 0);
    await page.fill(".command-form input", "clear");
    await page.press(".command-form input", "Enter");
    assert.equal(await page.locator(".directory a").count(), 0);
    await page.fill(".command-form input", "help");
    await page.press(".command-form input", "Enter");
    assert.equal(await page.locator(".directory a").count(), 8);
    await page.evaluate(async () => {
      window.manager = (await import("./desktop.js")).apps;
      manager.register({
        id: "probe",
        name: "Probe",
        icon: "terminal",
        size: { width: 400, height: 300 },
        load: async () => ({
          mount(ctx) {
            window.probe = ctx;
            ctx.root.innerHTML = '<button id="app-finish">Finish</button>';
            ctx.root.querySelector("button").onclick = () => ctx.close();
            return {
              destroy() {
                window.probeDestroyed = true;
              },
            };
          },
        }),
      });
      await manager.open("probe");
    });
    assert.equal(await page.locator('[data-app-icon="probe"]').count(), 1);
    assert.equal(await page.locator('[data-app-task="probe"]').count(), 1);
    assert.equal(
      await page
        .locator('[data-app-window="probe"]')
        .getAttribute("data-focused"),
      "true",
    );
    await page.click('[data-app-task="terminal"]');
    assert.equal(await win.getAttribute("data-focused"), "true");
    await page.click('[data-app-task="probe"]');
    await page.evaluate(() => probe.setFullscreen(true, { locked: true }));
    const probe = page.locator('[data-app-window="probe"]');
    assert.equal(await probe.getAttribute("data-mode"), "fullscreen");
    assert.equal(await probe.locator(".window-controls").isVisible(), false);
    assert.equal(
      await page.evaluate(() => manager.requestClose("probe")),
      false,
    );
    assert.equal(await page.evaluate(() => manager.minimize("probe")), false);
    await page.click('[data-app-task="terminal"]');
    assert.equal(await probe.getAttribute("data-focused"), "true");
    await page.click("#app-finish");
    assert.equal(await probe.count(), 0);
    assert.equal(await page.evaluate(() => window.probeDestroyed), true);
    // App-owned close policy and close veto are separate from fullscreen.
    await page.evaluate(async () => {
      manager.register({
        id: "guard",
        name: "Guard",
        icon: "terminal",
        closePolicy: "app",
        load: async () => ({
          mount(ctx) {
            window.guard = ctx;
            return {};
          },
        }),
      });
      await manager.open("guard");
    });
    assert.equal(
      await page.evaluate(() => manager.requestClose("guard")),
      false,
    );
    await page.evaluate(() => guard.close());
    await page.evaluate(async () => {
      manager.register({
        id: "veto",
        name: "Veto",
        icon: "terminal",
        load: async () => ({
          mount(ctx) {
            window.veto = ctx;
            return {
              beforeClose() {
                return false;
              },
            };
          },
        }),
      });
      await manager.open("veto");
    });
    assert.equal(
      await page.evaluate(() => manager.requestClose("veto")),
      false,
    );
    await page.evaluate(() => veto.close());
    // Closing an app while its module loads must not resurrect its window.
    await page.evaluate(() => {
      manager.register({
        id: "slow",
        name: "Slow",
        icon: "terminal",
        load: () =>
          new Promise(
            (resolve) =>
              (window.finishLoad = () =>
                resolve({
                  mount() {
                    window.slowMounted = true;
                    return {};
                  },
                })),
          ),
      });
      manager.open("slow");
    });
    await page.evaluate(() => manager.requestClose("slow"));
    await page.evaluate(() => finishLoad());
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-app-window="slow"]').count(), 0);
    assert.equal(await page.evaluate(() => !!window.slowMounted), false);
    // Failed module gets a usable error window and can be closed.
    await page.evaluate(async () => {
      manager.register({
        id: "broken",
        name: "Broken",
        icon: "terminal",
        load: async () => {
          throw Error("test load failure");
        },
      });
      await manager.open("broken");
    });
    assert.match(
      await page.locator('[data-app-window="broken"]').innerText(),
      /could not be loaded/i,
    );
    await page.click('[data-app-window="broken"] [data-control="close"]');
    // Exercise the shipped starter app, including its own fullscreen/return buttons.
    await page.evaluate(async () => {
      manager.register({
        id: "example",
        name: "Example",
        icon: "terminal",
        styles: new URL("./apps/example/example.css", location.href).href,
        load: () => import("./apps/example/example.js"),
      });
      await manager.open("example");
    });
    await page.click("[data-fullscreen]");
    assert.equal(
      await page
        .locator('[data-app-window="example"]')
        .getAttribute("data-mode"),
      "fullscreen",
    );
    await page.click("[data-windowed]");
    assert.equal(
      await page
        .locator('[data-app-window="example"]')
        .getAttribute("data-mode"),
      "windowed",
    );
    await page.click("[data-close]");
    await page.evaluate(() => manager.open("terminal"));
    // Pointer resizing and keyboard movement share the same desktop bounds.
    const sizedBefore = await win.boundingBox();
    const grip = await win.locator(".resize-handle").boundingBox();
    await page.mouse.move(grip.x + 8, grip.y + 8);
    await page.mouse.down();
    await page.mouse.move(grip.x - 90, grip.y - 70, { steps: 8 });
    await page.mouse.up();
    const sizedAfter = await win.boundingBox();
    assert.ok(
      sizedAfter.width < sizedBefore.width - 80 &&
        sizedAfter.height < sizedBefore.height - 50,
    );
    await title.focus();
    const movedBefore = await win.boundingBox();
    await page.keyboard.press("ArrowLeft");
    const movedAfter = await win.boundingBox();
    assert.equal(Math.round(movedBefore.x - movedAfter.x), 10);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => manager.open("terminal"));
    const mobile = await win.boundingBox();
    assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 391);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.reload();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.click("#login-button");
    await page.waitForSelector('[data-app-window="terminal"]');
    await page.waitForTimeout(600);
    assert.equal(await page.locator(".command-form").isVisible(), false);
    await page.click('[data-app-window="terminal"] [data-control="close"]');
    await page.click('[data-app-icon="terminal"]');
    await page.waitForSelector('.transfer[data-state="running"]');
    await page.waitForSelector(".command-form:not([hidden])", {
      timeout: 15000,
    });
    assert.equal(await page.locator(".directory a").count(), 8);
    assert.deepEqual(errors, []);
    assert.deepEqual(missing, []);
    console.log(
      `PASS: initial boot ${elapsed.toFixed(2)}s; terminal reopen; drag/maximize/minimize; app registration and focus; fullscreen/app-owned close; loading cancellation and failure; mobile; reduced-motion retry; no page errors or missing assets.`,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
