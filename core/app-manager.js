/** Shared desktop window lifecycle. Apps render only inside context.root. */
export class AppManager {
  constructor({ workspace, icons, tasks, asset, announce = () => {} }) {
    this.workspace = workspace;
    this.icons = icons;
    this.tasks = tasks;
    this.asset = asset;
    this.announce = announce;
    this.definitions = new Map();
    this.instances = new Map();
    this.sessions = new Map();
    this.styles = new Map();
    this.activeId = null;
    this.z = 0;
    this.abort = new AbortController();
    this.observer = new ResizeObserver(() => {
      for (const record of this.instances.values()) {
        this.fit(record);
        this.hook(record, "onResize");
      }
    });
    this.observer.observe(workspace);
    workspace.addEventListener(
      "keydown",
      (event) => {
        if (event.altKey && event.key === "F4" && this.activeId) {
          event.preventDefault();
          void this.requestClose(this.activeId);
        }
      },
      { signal: this.abort.signal },
    );
  }

  register(definition) {
    const { id, name, icon, load } = definition;
    if (!/^[a-z][a-z0-9-]*$/.test(id) || this.definitions.has(id)) {
      throw new Error(`Invalid or duplicate app id: ${id}`);
    }
    if (!name || typeof load !== "function")
      throw new Error("An app needs name and load.");
    const iconURL = this.asset(icon); // Fail early on a misspelled manifest key.
    const def = { ...definition, iconURL };
    const desktop = this.button("desktop-app", name, iconURL);
    desktop.dataset.appIcon = id;
    desktop.setAttribute("aria-label", `Open ${name}`);
    const task = this.button("task-app", name, iconURL);
    task.dataset.appTask = id;
    task.lastElementChild.className = "task-label";
    task.addEventListener(
      "click",
      () => {
        const record = this.instances.get(id);
        if (record && !record.minimized && this.activeId === id)
          this.minimize(id);
        else void this.open(id);
      },
      { signal: this.abort.signal },
    );
    desktop.addEventListener("click", () => void this.open(id), {
      signal: this.abort.signal,
    });
    this.icons.append(desktop);
    this.tasks.append(task);
    this.definitions.set(id, { ...def, desktop, task });
    this.sessions.set(id, {});
    this.updateTasks();
  }

  button(className, name, iconURL) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    const img = document.createElement("img");
    img.className = "app-icon";
    img.alt = "";
    img.src = iconURL;
    const label = document.createElement("span");
    label.textContent = name;
    button.append(img, label);
    return button;
  }

  async stylesheet(url) {
    if (!url) return;
    if (!this.styles.has(url)) {
      const promise = new Promise((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = url;
        link.onload = resolve;
        link.onerror = () => {
          link.remove();
          this.styles.delete(url);
          reject(new Error("Stylesheet unavailable"));
        };
        document.head.append(link);
      });
      this.styles.set(url, promise);
    }
    return this.styles.get(url);
  }

  locked() {
    return [...this.instances.values()].find(
      (r) => r.mode === "fullscreen" && r.locked && !r.minimized,
    );
  }

  async open(id) {
    const def = this.definitions.get(id);
    if (!def) throw new Error(`Unknown app: ${id}`);
    const locked = this.locked();
    if (locked && locked.id !== id) {
      this.focus(locked.id);
      return false;
    }
    if (this.instances.has(id)) {
      this.focus(id);
      return true;
    }
    const r = this.createWindow(def);
    this.instances.set(id, r);
    this.focus(id);
    try {
      const [module] = await Promise.all([
        def.load(),
        this.stylesheet(def.styles),
      ]);
      if (r.abort.signal.aborted) return false;
      if (typeof module.mount !== "function")
        throw new Error("App module must export mount(context).");
      r.content.replaceChildren();
      const lifecycle = (await module.mount(this.context(r))) || {};
      if (r.abort.signal.aborted) {
        lifecycle.destroy?.();
        return false;
      }
      r.lifecycle = lifecycle;
      r.loaded = true;
      r.content.removeAttribute("aria-busy");
      // Apply a forced mode after mounting so a loading failure remains dismissible.
      if (def.fullscreen) {
        const locked = def.fullscreen.locked !== false;
        if (!this.setFullscreen(id, true, { locked })) {
          // Another loading app acquired the desktop first. Retain this app's
          // required mode while minimized; restoring it must never lose its lock.
          r.previousMode = r.mode;
          r.mode = "fullscreen";
          r.locked = locked;
          r.minimized = true;
          r.win.hidden = true;
          this.fit(r);
          this.updateTasks();
        }
      } else if (def.mode === "maximized") this.maximize(id, true);
      this.updateControls(r);
      await this.hook(r, "onOpen");
      if (r.abort.signal.aborted || this.instances.get(id) !== r) return false;
      if (this.activeId === id) this.hook(r, "onFocus");
      return true;
    } catch (error) {
      if (r.abort.signal.aborted) return false;
      r.failed = true;
      r.mode = "windowed";
      r.locked = false;
      r.content.removeAttribute("aria-busy");
      r.content.replaceChildren();
      const message = document.createElement("p");
      message.textContent = `${def.name} could not be loaded.`;
      const detail = document.createElement("p");
      detail.textContent =
        "Check the app module and asset paths, then try again.";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Try again";
      retry.addEventListener("click", async () => {
        await this.closeRecord(r);
        await this.open(id);
      });
      r.content.append(message, detail, retry);
      r.content.classList.add("app-load-error");
      this.fit(r);
      this.updateControls(r);
      this.focus(id, false);
      this.announce(message.textContent);
      // Keep the actionable cause available to developers without breaking the desktop.
      console.warn(`[maiDOS:${id}]`, error);
      return false;
    }
  }

  createWindow(def) {
    const win = document.createElement("section");
    win.className = "app-window";
    win.dataset.appWindow = def.id;
    win.setAttribute("aria-label", def.name);
    win.setAttribute("role", "region");
    win.tabIndex = -1;
    const bar = document.createElement("header");
    bar.className = "titlebar";
    bar.tabIndex = 0;
    bar.setAttribute(
      "aria-label",
      `${def.name} window. Arrow keys move; Shift and arrow keys resize.`,
    );
    const title = document.createElement("div");
    title.className = "title";
    const image = document.createElement("img");
    image.className = "title-icon";
    image.src = def.iconURL;
    image.alt = "";
    const titleText = document.createElement("span");
    titleText.textContent = def.title || def.name;
    title.append(image, titleText);
    const controls = document.createElement("div");
    controls.className = "window-controls";
    for (const [action, label, symbol] of [
      ["minimize", "Minimize", "−"],
      ["maximize", "Maximize", "□"],
      ["close", "Close", "×"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.control = action;
      button.setAttribute("aria-label", `${label} ${def.name}`);
      button.textContent = symbol;
      if (action === "close") button.className = "close";
      controls.append(button);
    }
    bar.append(title, controls);
    const content = document.createElement("div");
    content.className = "app-content";
    content.setAttribute("aria-busy", "true");
    const loading = document.createElement("p");
    loading.className = "app-loading";
    loading.textContent = `Loading ${def.name}…`;
    content.append(loading);
    const handle = document.createElement("div");
    handle.className = "resize-handle";
    handle.setAttribute("aria-hidden", "true");
    win.append(bar, content, handle);
    this.workspace.append(win);
    const bounds = this.workspace.getBoundingClientRect();
    const width = Math.min(def.size?.width || 700, bounds.width - 24);
    const height = Math.min(def.size?.height || 500, bounds.height - 24);
    const offset = this.instances.size * 24;
    const r = {
      id: def.id,
      def,
      win,
      bar,
      controls,
      titleText,
      content,
      handle,
      rect: {
        x: (bounds.width - width) / 2 + offset,
        y: (bounds.height - height) / 2 + offset,
        width,
        height,
      },
      mode: "windowed",
      locked: false,
      minimized: false,
      loaded: false,
      failed: false,
      abort: new AbortController(),
      lifecycle: {},
      closing: false,
    };
    const options = { signal: r.abort.signal };
    controls
      .querySelector('[data-control="minimize"]')
      .addEventListener("click", () => this.minimize(r.id), options);
    controls
      .querySelector('[data-control="maximize"]')
      .addEventListener("click", () => this.maximize(r.id), options);
    controls
      .querySelector('[data-control="close"]')
      .addEventListener("click", () => void this.requestClose(r.id), options);
    win.addEventListener("pointerdown", () => this.focus(r.id, false), options);
    win.addEventListener(
      "focusin",
      () => {
        if (this.activeId !== r.id) this.focus(r.id, false);
      },
      options,
    );
    bar.addEventListener(
      "dblclick",
      (e) => {
        if (!e.target.closest("button")) this.maximize(r.id);
      },
      options,
    );
    bar.addEventListener(
      "pointerdown",
      (e) => this.startPointer(r, e, false),
      options,
    );
    handle.addEventListener(
      "pointerdown",
      (e) => this.startPointer(r, e, true),
      options,
    );
    bar.addEventListener(
      "keydown",
      (e) => {
        if (
          e.target !== bar ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            e.key,
          ) ||
          r.mode !== "windowed"
        )
          return;
        e.preventDefault();
        const dx =
          e.key === "ArrowLeft" ? -10 : e.key === "ArrowRight" ? 10 : 0;
        const dy = e.key === "ArrowUp" ? -10 : e.key === "ArrowDown" ? 10 : 0;
        if (e.shiftKey) {
          r.rect.width += dx;
          r.rect.height += dy;
        } else {
          r.rect.x += dx;
          r.rect.y += dy;
        }
        this.fit(r);
        this.hook(r, "onResize");
      },
      options,
    );
    this.fit(r);
    this.updateControls(r);
    return r;
  }

  context(r) {
    const alive =
      (fn) =>
      (...args) =>
        !r.abort.signal.aborted && fn(...args);
    return Object.freeze({
      root: r.content,
      signal: r.abort.signal,
      session: this.sessions.get(r.id),
      asset: this.asset,
      announce: alive(this.announce),
      isVisible: () =>
        !r.abort.signal.aborted && !r.minimized && this.activeId === r.id,
      setTitle: alive((title) => {
        r.titleText.textContent = String(title);
      }),
      focus: alive(() => this.focus(r.id)),
      minimize: alive(() => this.minimize(r.id)),
      maximize: alive((on) => this.maximize(r.id, on)),
      setFullscreen: alive((on, options) =>
        this.setFullscreen(r.id, on, options),
      ),
      // Calling close from inside the app is authoritative; shell requests are gated separately.
      close: alive(() => this.closeRecord(r)),
    });
  }

  hook(r, name, ...args) {
    try {
      const result = r.lifecycle[name]?.(...args);
      if (result?.catch)
        return result.catch((error) => {
          console.warn(`[maiDOS:${r.id}] ${name}`, error);
        });
      return result;
    } catch (error) {
      console.warn(`[maiDOS:${r.id}] ${name}`, error);
    }
  }

  focus(id, moveFocus = true) {
    const r = this.instances.get(id);
    if (!r) return false;
    const locked = this.locked();
    if (locked && locked !== r) return false;
    r.minimized = false;
    r.win.hidden = false;
    this.activeId = id;
    r.win.style.zIndex = String(++this.z);
    for (const item of this.instances.values()) {
      item.win.dataset.focused = String(item === r);
      item.win.inert = !!locked && locked !== item;
    }
    this.icons.inert = !!locked;
    this.updateTasks();
    if (moveFocus) {
      r.win.focus({ preventScroll: true });
      this.hook(r, "onFocus");
    }
    return true;
  }

  activateNext() {
    this.activeId = null;
    const next = [...this.instances.values()]
      .filter((r) => !r.minimized)
      .sort(
        (a, b) => Number(b.win.style.zIndex) - Number(a.win.style.zIndex),
      )[0];
    this.icons.inert = false;
    if (next) this.focus(next.id);
    else this.updateTasks();
  }

  minimize(id) {
    const r = this.instances.get(id);
    if (!r || (r.mode === "fullscreen" && r.locked)) return false;
    r.minimized = true;
    r.win.hidden = true;
    if (this.activeId === id) this.activateNext();
    this.updateTasks();
    r.def.task.focus();
    return true;
  }

  maximize(id, on) {
    const r = this.instances.get(id);
    if (!r || r.mode === "fullscreen") return false;
    r.mode = (on ?? r.mode !== "maximized") ? "maximized" : "windowed";
    this.fit(r);
    this.updateControls(r);
    this.hook(r, "onResize");
    return true;
  }

  setFullscreen(id, on = true, { locked = true } = {}) {
    const r = this.instances.get(id);
    if (!r) return false;
    const current = this.locked();
    if (on && current && current !== r) return false;
    if (on) {
      if (r.mode !== "fullscreen") r.previousMode = r.mode;
      r.mode = "fullscreen";
      r.locked = locked;
    } else {
      r.mode = r.previousMode || "windowed";
      r.locked = false;
    }
    this.focus(id);
    this.fit(r);
    this.updateControls(r);
    this.hook(r, "onResize");
    return true;
  }

  updateControls(r) {
    r.controls.hidden = r.mode === "fullscreen" && r.locked;
    const close = r.controls.querySelector('[data-control="close"]');
    close.hidden = r.loaded && !r.failed && r.def.closePolicy === "app";
    const max = r.controls.querySelector('[data-control="maximize"]');
    max.disabled = r.mode === "fullscreen";
    max.setAttribute("aria-pressed", String(r.mode === "maximized"));
    max.setAttribute(
      "aria-label",
      `${r.mode === "maximized" ? "Restore" : "Maximize"} ${r.def.name}`,
    );
    r.handle.hidden = r.mode !== "windowed";
  }

  updateTasks() {
    for (const [id, def] of this.definitions) {
      const r = this.instances.get(id);
      const state = !r
        ? "closed"
        : r.minimized
          ? "minimized"
          : id === this.activeId
            ? "active"
            : "running";
      def.task.dataset.state = state;
      def.task.setAttribute("aria-pressed", String(state === "active"));
      def.task.setAttribute(
        "aria-label",
        `${state === "active" ? "Minimize" : state === "closed" ? "Open" : "Restore"} ${def.name}`,
      );
    }
  }

  async requestClose(id) {
    const r = this.instances.get(id);
    if (!r || r.closing) return false;
    const canClose = () =>
      this.instances.get(id) === r &&
      (r.failed ||
        !(
          (r.mode === "fullscreen" && r.locked) ||
          (r.loaded && r.def.closePolicy === "app")
        ));
    if (!canClose()) return false;
    r.closing = true;
    try {
      if (!r.failed && (await r.lifecycle.beforeClose?.()) === false)
        return false;
      // An asynchronous prompt or module load may change policy while waiting.
      if (!canClose()) return false;
      return await this.closeRecord(r);
    } catch (error) {
      console.warn(`[maiDOS:${id}] beforeClose`, error);
      return false;
    } finally {
      r.closing = false;
    }
  }

  async closeRecord(r) {
    if (this.instances.get(r.id) !== r) return false;
    r.abort.abort();
    this.instances.delete(r.id);
    r.win.remove();
    this.hook(r, "destroy");
    const wasActive = this.activeId === r.id;
    if (wasActive) this.activateNext();
    else this.updateTasks();
    if (!this.activeId) r.def.task.focus();
    this.announce(`${r.def.name} closed.`);
    return true;
  }

  fit(r) {
    const bounds = this.workspace.getBoundingClientRect();
    const maxWidth = Math.max(1, bounds.width),
      maxHeight = Math.max(1, bounds.height);
    const rect = r.rect;
    rect.width = Math.min(
      maxWidth,
      Math.max(Math.min(r.def.minSize?.width || 280, maxWidth), rect.width),
    );
    rect.height = Math.min(
      maxHeight,
      Math.max(Math.min(r.def.minSize?.height || 180, maxHeight), rect.height),
    );
    rect.x = Math.max(0, Math.min(rect.x, maxWidth - rect.width));
    rect.y = Math.max(0, Math.min(rect.y, maxHeight - rect.height));
    const box =
      r.mode === "windowed"
        ? rect
        : { x: 0, y: 0, width: maxWidth, height: maxHeight };
    Object.assign(r.win.style, {
      left: box.x + "px",
      top: box.y + "px",
      width: box.width + "px",
      height: box.height + "px",
    });
    r.win.dataset.mode = r.mode;
  }

  startPointer(r, event, resize) {
    if (
      event.button !== 0 ||
      r.mode !== "windowed" ||
      event.target.closest("button")
    )
      return;
    if (this.locked() && this.locked() !== r) return;
    event.preventDefault();
    this.focus(r.id, false);
    const target = event.currentTarget,
      initial = { ...r.rect },
      x = event.clientX,
      y = event.clientY;
    target.setPointerCapture(event.pointerId);
    r.win.classList.add("moving");
    const move = (e) => {
      if (e.pointerId !== event.pointerId) return;
      if (resize) {
        r.rect.width = initial.width + e.clientX - x;
        r.rect.height = initial.height + e.clientY - y;
      } else {
        r.rect.x = initial.x + e.clientX - x;
        r.rect.y = initial.y + e.clientY - y;
      }
      this.fit(r);
      this.hook(r, "onResize");
    };
    const end = (e) => {
      if (e.pointerId !== event.pointerId) return;
      r.win.classList.remove("moving");
      target.removeEventListener("pointermove", move);
      target.removeEventListener("lostpointercapture", end);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      if (target.hasPointerCapture(event.pointerId))
        target.releasePointerCapture(event.pointerId);
    };
    const options = { signal: r.abort.signal };
    target.addEventListener("pointermove", move, options);
    target.addEventListener("pointerup", end, options);
    target.addEventListener("pointercancel", end, options);
    target.addEventListener("lostpointercapture", end, options);
  }

  destroy() {
    this.abort.abort();
    this.observer.disconnect();
    for (const r of [...this.instances.values()]) void this.closeRecord(r);
    this.icons.replaceChildren();
    this.tasks.replaceChildren();
    this.definitions.clear();
    this.sessions.clear();
  }
}
