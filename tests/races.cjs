const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const server = http.createServer((req, res) => {
  const name = new URL(req.url, "http://localhost").pathname;
  if (name === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<div id="workspace" style="width:1000px;height:700px"></div><nav id="icons"></nav><nav id="tasks"></nav>',
    );
    return;
  }
  const file = path.resolve(root, "." + name);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader("Content-Type", "text/javascript");
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
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
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async () => {
      const { AppManager } = await import("./core/app-manager.js");
      const m = new AppManager({
        workspace: document.querySelector("#workspace"),
        icons: document.querySelector("#icons"),
        tasks: document.querySelector("#tasks"),
        asset: () => "/assets/icons/terminal.png",
      });
      let a, resolveClose;
      m.register({
        id: "async-close",
        name: "Close",
        icon: "terminal",
        load: async () => ({
          mount(ctx) {
            a = ctx;
            return {
              beforeClose: () =>
                new Promise((resolve) => (resolveClose = resolve)),
            };
          },
        }),
      });
      await m.open("async-close");
      const pending = m.requestClose("async-close");
      a.setFullscreen(true, { locked: true });
      resolveClose(true);
      const closeResult = await pending;
      const closeRespectsNewLock =
        closeResult === false && m.instances.has("async-close");
      await a.close();
      let resolveOpen,
        first,
        oldFocus = 0,
        generation = 0;
      m.register({
        id: "reopen",
        name: "Reopen",
        icon: "terminal",
        load: async () => ({
          mount(ctx) {
            const n = ++generation;
            if (n === 1) first = ctx;
            return {
              onOpen() {
                if (n === 1)
                  return new Promise((resolve) => (resolveOpen = resolve));
              },
              onFocus() {
                if (n === 1) oldFocus++;
              },
            };
          },
        }),
      });
      const opening = m.open("reopen");
      while (!resolveOpen) await Promise.resolve();
      await first.close();
      await m.open("reopen");
      resolveOpen();
      const oldResult = await opening;
      const staleLifecycleStopped = oldFocus === 0 && oldResult === false;
      await m.requestClose("reopen");
      let resolveA, resolveB, fullA, fullB;
      m.register({
        id: "full-a",
        name: "A",
        icon: "terminal",
        fullscreen: { locked: true },
        load: () =>
          new Promise(
            (resolve) =>
              (resolveA = () =>
                resolve({
                  mount(ctx) {
                    fullA = ctx;
                    return {};
                  },
                })),
          ),
      });
      m.register({
        id: "full-b",
        name: "B",
        icon: "terminal",
        fullscreen: { locked: true },
        load: () =>
          new Promise(
            (resolve) =>
              (resolveB = () =>
                resolve({
                  mount(ctx) {
                    fullB = ctx;
                    return {};
                  },
                })),
          ),
      });
      const pa = m.open("full-a"),
        pb = m.open("full-b");
      resolveA();
      await pa;
      resolveB();
      await pb;
      await fullA.close();
      await m.open("full-b");
      const concurrentFullscreenEnforced =
        m.instances.get("full-b").mode === "fullscreen" &&
        m.instances.get("full-b").locked &&
        (await m.requestClose("full-b")) === false;
      await fullB.close();
      m.destroy();
      return {
        closeRespectsNewLock,
        staleLifecycleStopped,
        concurrentFullscreenEnforced,
      };
    });
    console.log(result);
    assert.deepEqual(result, {
      closeRespectsNewLock: true,
      staleLifecycleStopped: true,
      concurrentFullscreenEnforced: true,
    });
    console.log(
      "PASS: async close policy, stale lifecycle cancellation, simultaneous forced fullscreen apps.",
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
