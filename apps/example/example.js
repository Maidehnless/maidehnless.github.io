// Opt-in starter app. Register it in apps/registry.js to show its desktop/taskbar icons.
export function mount(context) {
  context.root.classList.add("example-app");
  context.root.innerHTML = `
    <h1>Example app</h1>
    <p>Shared window controls, movement and taskbar integration are automatic.</p>
    <p data-visits></p>
    <button data-fullscreen>Enter app-controlled fullscreen</button>
    <button data-windowed hidden>Return to window</button>
    <button data-close>Close app</button>`;
  const find = (selector) => context.root.querySelector(selector);
  const options = { signal: context.signal };
  find("[data-fullscreen]").addEventListener(
    "click",
    () => {
      context.setFullscreen(true, { locked: true });
      find("[data-windowed]").hidden = false;
      find("[data-fullscreen]").hidden = true;
    },
    options,
  );
  find("[data-windowed]").addEventListener(
    "click",
    () => {
      context.setFullscreen(false);
      find("[data-windowed]").hidden = true;
      find("[data-fullscreen]").hidden = false;
    },
    options,
  );
  find("[data-close]").addEventListener(
    "click",
    () => context.close(),
    options,
  );
  return {
    onOpen() {
      context.session.visits = (context.session.visits || 0) + 1;
      find("[data-visits]").textContent =
        `Opened ${context.session.visits} time(s) this session.`;
    },
    // beforeClose() { return false; } // Optionally reject a shell close request.
    destroy() {
      /* Clear timers, observers and non-signal resources here. */
    },
  };
}
