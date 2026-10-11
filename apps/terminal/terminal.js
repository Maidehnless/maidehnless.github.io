import { CONFIG, BANNER } from "./config.js";
import { view } from "./view.js";

// This module owns terminal content, commands and boot state; the manager owns its window.
export function mount(context) {
  context.root.classList.add("terminal-app");
  context.root.innerHTML = view;
  const $ = (id) => context.root.querySelector("#" + id);
  const screen = $("screen"),
    output = $("output"),
    input = $("command");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let sessionId = 0,
    ready = false,
    follow = true,
    busy = false;
  const history = [];
  let historyIndex = 0,
    draft = "";
  const announce = context.announce;
  const reveal = () => {
    if (follow) screen.scrollTop = screen.scrollHeight;
  };
  screen.addEventListener(
    "scroll",
    () => {
      follow =
        screen.scrollHeight - screen.clientHeight - screen.scrollTop < 40;
    },
    { passive: true, signal: context.signal },
  );
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cancelled = (id) => id !== sessionId || context.signal.aborted;
  function row(text = "", cls = "line", parent = output) {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    parent.append(el);
    reveal();
    return el;
  }
  function blank(parent = output) {
    row("", "spacer", parent);
  }
  function echo(text, parent = output) {
    const el = row("", "prompt-line", parent),
      prefix = document.createElement("span"),
      command = document.createElement("span");
    prefix.className = "prefix";
    prefix.textContent = "samurai@maiDOS:~$";
    command.textContent = text;
    el.append(prefix, command);
    return command;
  }
  async function type(el, text, id, speed = 12) {
    if (cancelled(id)) return;
    if (reduced) {
      el.textContent = text;
      reveal();
      return;
    }
    el.classList.add("typing");
    await new Promise((resolve) => {
      let start;
      function frame(time) {
        if (cancelled(id)) {
          resolve();
          return;
        }
        start ??= time;
        const count = Math.min(
          text.length,
          Math.floor((time - start) / speed) + 1,
        );
        el.textContent = text.slice(0, count);
        reveal();
        if (count < text.length) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    el.classList.remove("typing");
  }
  function link(item) {
    const a = document.createElement("a");
    a.href = item.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = "Open " + item.name + " in a new tab";
    const code = document.createElement("span");
    code.className = "code";
    code.textContent = item.code;
    const name = document.createElement("span");
    name.textContent = item.name;
    a.append(code, name);
    return a;
  }
  async function directory(parent = output, animated = false, id = sessionId) {
    const wrap = document.createElement("div");
    wrap.className = "banner-wrap";
    const banner = document.createElement("pre");
    banner.className = "banner";
    banner.setAttribute("role", "img");
    banner.setAttribute("aria-label", "maiDOS ASCII logo");
    wrap.append(banner);
    parent.append(wrap);
    if (animated) {
      const lines = BANNER.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (cancelled(id)) return;
        banner.textContent += lines[i] + (i < lines.length - 1 ? "\n" : "");
        reveal();
        await wait(14);
      }
    } else banner.textContent = BANNER;
    if (cancelled(id)) return;
    row("Social directory", "line accent", parent);
    const nav = document.createElement("nav");
    nav.className = "directory";
    nav.setAttribute("aria-label", "Social profiles");
    parent.append(nav);
    for (const item of CONFIG.links) {
      if (cancelled(id)) return;
      nav.append(link(item));
      reveal();
      if (animated) await wait(18);
    }
    const local = document.createElement("nav");
    local.className = "local-commands";
    local.setAttribute("aria-label", "Terminal commands");
    for (const [code, label] of [
      ["help", "Show links"],
      ["clear", "Clear terminal"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      const c = document.createElement("span");
      c.className = "code";
      c.textContent = code;
      const text = document.createElement("span");
      text.textContent = label;
      button.append(c, text);
      button.addEventListener("click", () => {
        run(code);
        focusInput();
      });
      local.append(button);
    }
    parent.append(local);
    reveal();
  }
  function focusInput() {
    if (
      ready &&
      context.isVisible() &&
      !matchMedia("(pointer: coarse)").matches
    )
      input.focus({ preventScroll: true });
  }
  // Cinematic local simulation: no requests, downloads or security checks occur.
  // Explicit timers control the work sequence even when reduced motion is enabled.
  async function boot(id) {
    // This is a fictional connection animation. No network requests are made.
    // Keep the original speed multiplier to preserve the short boot sequence.
    const pause = (ms) => wait(Math.round(ms * 0.33));
    await pause(160);
    if (cancelled(id)) return;

    row("maiDOS // UNREGISTERED NET INTERFACE", "line dim");
    await type(
      echo(""),
      "jack-in NC-CITINET::MAIDOS/ARCHIVE --ghost --no-trace",
      id,
      5,
    );
    if (cancelled(id)) return;
    blank();

    const random = (min, max) =>
      Math.floor(min + Math.random() * (max - min + 1));
    const localPort = random(49152, 65535);
    const latency = random(44, 96);

    async function stage(pending, complete, min = 450, max = 850) {
      if (cancelled(id)) return false;
      const line = row(pending, "line dim connecting");
      const started = performance.now();
      await pause(random(min, max));
      if (cancelled(id)) return false;
      line.className = "line dim";
      line.textContent =
        complete +
        " (" +
        ((performance.now() - started) / 1000).toFixed(2) +
        "s)";
      reveal();
      return true;
    }

    function progress(parent, name) {
      const group = row("", "transfer", parent);
      group.dataset.resource = name;
      group.dataset.state = "pending";
      const bar = row("", "transfer-bar accent", group);
      const stats = row("", "transfer-stats dim", group);
      group.setAttribute("role", "progressbar");
      group.setAttribute("aria-label", name);
      group.setAttribute("aria-valuemin", "0");
      group.setAttribute("aria-valuemax", "100");

      function update(percent, message) {
        const filled = Math.floor(percent / 5);
        bar.textContent =
          "[" +
          "=".repeat(filled) +
          (percent < 100 ? ">" : "") +
          " ".repeat(Math.max(0, 20 - filled - (percent < 100 ? 1 : 0))) +
          "] " +
          String(percent).padStart(3) +
          "%";
        stats.textContent = message;
        group.setAttribute("aria-valuenow", String(percent));
        reveal();
      }
      return { group, update };
    }

    async function download(name, kib, milliseconds) {
      if (cancelled(id)) return false;
      row("[extract] Siphoning " + name + " into ghost cache ...", "line");
      const { group, update } = progress(output, name);
      group.dataset.state = "running";

      const total = kib * 1024;
      const steps = 14;
      const weights = Array.from({ length: steps }, () => random(5, 16));
      const sum = weights.reduce((a, b) => a + b, 0);
      const stallAt = random(5, 9);
      let transferred = 0;
      const started = performance.now();

      update(
        0,
        "0.0 / " + kib.toFixed(1) + " KiB | awaiting encrypted shard stream",
      );
      await pause(random(400, 650));
      if (cancelled(id)) return false;

      for (let n = 0; n < steps; n++) {
        if (n === stallAt) {
          update(
            Math.floor((transferred / total) * 100),
            (transferred / 1024).toFixed(1) +
              " / " +
              kib.toFixed(1) +
              " KiB | ICE throttling detected; rerouting stream ...",
          );
          await pause(random(450, 750));
          if (cancelled(id)) return false;
        }

        await pause(
          Math.round(((milliseconds / steps) * random(80, 120)) / 100),
        );
        if (cancelled(id)) return false;
        transferred =
          n === steps - 1
            ? total
            : Math.min(
                total - 1,
                transferred + Math.floor((total * weights[n]) / sum),
              );

        const elapsed = Math.max(0.001, (performance.now() - started) / 1000);
        const rate = transferred / 1024 / elapsed;
        const eta = rate ? Math.max(0, (total - transferred) / 1024 / rate) : 0;
        update(
          Math.floor((transferred / total) * 100),
          (transferred / 1024).toFixed(1) +
            " / " +
            kib.toFixed(1) +
            " KiB | " +
            rate.toFixed(1) +
            " KiB/s | ETA " +
            eta.toFixed(1) +
            "s",
        );
      }

      group.dataset.state = "complete";
      update(
        100,
        kib.toFixed(1) +
          " / " +
          kib.toFixed(1) +
          " KiB | decrypted; cached in " +
          ((performance.now() - started) / 1000).toFixed(1) +
          "s",
      );
      await pause(240);
      return !cancelled(id);
    }

    // A scripted, fictional datafort intrusion. Nothing below accesses a real host.
    if (
      !(await stage(
        "[citinet] Triangulating Night City access point",
        "[citinet] NC-77 access point acquired; uplink stable",
        700,
        900,
      ))
    )
      return;

    if (
      !(await stage(
        "[relay] Opening unregistered channel on port " + localPort,
        "[relay] Ghost relay active; origin signature obscured",
        550,
        750,
      ))
    )
      return;

    if (
      !(await stage(
        "[datafort] Probing restricted MAIDOS/ARCHIVE node",
        "[datafort] Maintenance interface found; entry vector exposed",
        600,
        850,
      ))
    )
      return;

    if (
      !(await stage(
        "[ice] Scanning perimeter for intrusion countermeasures",
        "[ice] Patrol ICE identified; surveillance cycle mapped",
        600,
        850,
      ))
    )
      return;

    if (
      !(await stage(
        "[gate] Code Gate locked; presenting forged access token",
        "[gate] ACCESS GRANTED; restricted partition unlocked",
        600,
        850,
      ))
    )
      return;

    row(
      "[alert] UNAUTHORIZED ACCESS FLAGGED // NETWATCH TRACE REQUESTED",
      "line",
    );
    if (
      !(await stage(
        "[netwatch] Intercepting security audit beacon",
        "[netwatch] Audit redirected; source attribution failed",
        650,
        900,
      ))
    )
      return;

    if (
      !(await stage(
        "[daemon] Local watchdog has detected an unknown session",
        "[daemon] Watchdog desynchronized; alarm state suppressed",
        500,
        750,
      ))
    )
      return;

    if (
      !(await stage(
        "[crypto] Negotiating sealed ghost-channel session",
        "[crypto] Encrypted tunnel established; cipher accepted",
        500,
        750,
      ))
    )
      return;

    if (
      !(await stage(
        "[vault] Requesting restricted archive manifest",
        "[vault] Archive index exposed; shard extraction authorised by forged token",
        650,
        950,
      ))
    )
      return;

    blank();

    // Preserve the original file identifiers and one-at-a-time loading bars.
    if (!(await download("session.manifest", 12, 1500))) return;
    if (!(await download("terminal.profile", 48, 2600))) return;
    if (!(await download("socials.index", 8, 1300))) return;

    blank();
    const files = ["session.manifest", "terminal.profile", "socials.index"];
    const verify = row(
      "[integrity] Checking acquired data shards [0/3]",
      "line dim",
    );
    for (let n = 0; n < files.length; n++) {
      await pause(random(300, 550));
      if (cancelled(id)) return;
      verify.textContent =
        "[integrity] [" + (n + 1) + "/3] " + files[n] + " ... digest matched";
      reveal();
    }
    verify.textContent = "[integrity] [3/3] All acquired shards verified";

    row("[session] Constructing covert maiDOS environment ...", "line");
    const install = progress(output, "ghost session preparation");
    install.group.dataset.state = "running";
    const tasks = [
      "Allocating ghost session buffer",
      "Injecting terminal profile",
      "Mounting Data Pool link index",
      "Detaching security audit hooks",
    ];
    install.update(0, "0 / 4 tasks completed");
    for (let n = 0; n < tasks.length; n++) {
      install.update(n * 25, tasks[n] + " ...");
      await pause(random(400, 650));
      if (cancelled(id)) return;
      install.update((n + 1) * 25, n + 1 + " / 4 tasks completed");
    }
    install.group.dataset.state = "complete";

    blank();
    const check = row(
      "[trace] Monitoring NetWatch pursuit signatures [0/3]",
      "line dim",
    );
    const samples = [];
    for (let n = 1; n <= 3; n++) {
      await pause(random(350, 600));
      if (cancelled(id)) return;
      samples.push(latency + random(-8, 12));
      check.textContent =
        "[trace] Sweep " +
        n +
        "/3 evaded | relay jitter " +
        samples[n - 1] +
        " ms";
      reveal();
    }
    check.textContent =
      "[trace] 3/3 sweeps evaded | pursuit NONE | mean jitter " +
      Math.round(samples.reduce((a, b) => a + b, 0) / 3) +
      " ms";

    await pause(450);
    if (cancelled(id)) return;
    row(
      "[root] UNAUTHORIZED SESSION ESTABLISHED // WELCOME TO maiDOS",
      "line accent",
    );
    blank();
    await directory(output, true, id);
    if (cancelled(id)) return;

    // Leave the real site state and interaction flow unchanged.
    context.session.connectionEstablished = true;
    ready = true;
    busy = false;
    input.disabled = false;
    $("command-form").hidden = false;
    output.setAttribute("aria-busy", "false");
    announce("maiDOS ready. Eight social links available.");
    reveal();
    focusInput();
  }
  async function openTerminal() {
    const id = ++sessionId;
    ready = false;
    busy = true;
    follow = true;
    output.replaceChildren();
    output.setAttribute("aria-busy", "true");
    $("command-form").hidden = true;
    input.disabled = true;
    input.value = "";
    history.length = 0;
    historyIndex = 0;
    draft = "";
    try {
      if (context.session.connectionEstablished) {
        await directory(output, false, id);
        if (cancelled(id)) return;
        ready = true;
        busy = false;
        input.disabled = false;
        $("command-form").hidden = false;
        output.setAttribute("aria-busy", "false");
        reveal();
        focusInput();
        announce("Terminal ready. Existing connection resumed.");
        return;
      }
      await boot(id);
    } catch {
      if (cancelled(id)) return;
      busy = false;
      ready = true;
      input.disabled = false;
      $("command-form").hidden = false;
      output.setAttribute("aria-busy", "false");
      row("Startup interrupted. Type help to display the links.", "line dim");
      reveal();
    }
  }
  function run(raw) {
    const text = raw.trim().slice(0, 300);
    if (!ready || !text) return;
    const command = text.toLowerCase();
    const item = CONFIG.links.find(
      (x) => x.code === command || x.aliases.includes(command),
    );
    if (item) window.open(item.url, "_blank", "noopener,noreferrer");
    history.push(text);
    if (history.length > 100) history.shift();
    historyIndex = history.length;
    draft = "";
    follow = true;
    if (command === "clear" || command === "cls") {
      output.replaceChildren();
      announce("Terminal cleared. Type help for links.");
      reveal();
      return;
    }
    const block = row("", "response");
    echo(text, block);
    if (["help", "?", "links", "ls"].includes(command)) {
      directory(block);
      announce("Social directory displayed.");
    } else if (item) {
      row("Opening " + item.name + "…", "line dim", block);
      const a = document.createElement("a");
      a.href = item.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "manual-link";
      a.textContent = "Open " + item.name;
      block.append(a);
      announce("Opening " + item.name + " in a new tab.");
    } else {
      row(
        "Command not found: " + text + ". Type help for available commands.",
        "line dim",
        block,
      );
      blank(block);
    }
    while (output.children.length > 60) output.firstElementChild.remove();
    reveal();
  }
  $("command-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    run(text);
  });
  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (["ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      if (historyIndex === history.length) draft = input.value;
      historyIndex = Math.max(
        0,
        Math.min(history.length, historyIndex + (e.key === "ArrowUp" ? -1 : 1)),
      );
      input.value = history[historyIndex] ?? draft;
      input.setSelectionRange(input.value.length, input.value.length);
    } else if (e.key === "Tab" && input.value.trim()) {
      const prefix = input.value.trim().toLowerCase();
      const matches = [
        "help",
        "links",
        "clear",
        ...CONFIG.links.map((x) => x.code),
        ...CONFIG.links.flatMap((x) => x.aliases),
      ].filter((x) => x.startsWith(prefix));
      if (matches.length === 1) {
        e.preventDefault();
        input.value = matches[0];
      }
    }
  });

  return {
    onOpen() {
      void openTerminal();
    },
    onFocus() {
      focusInput();
    },
    onResize() {
      if (ready && document.activeElement === input) {
        follow = true;
        reveal();
      }
    },
    destroy() {
      sessionId++;
      ready = false;
      busy = false;
    },
  };
}
