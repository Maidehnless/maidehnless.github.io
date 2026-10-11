// Add shared asset paths here. URLs stay correct on custom domains and GitHub Pages subpaths.
export const assets = Object.freeze({
  wallpaper: new URL("./images/background.png", import.meta.url).href,
  samurai: new URL("./images/samurai.png", import.meta.url).href,
  terminal: new URL("./icons/terminal.png", import.meta.url).href,
  favicon: new URL("./icons/favicon.svg", import.meta.url).href,
});
export function asset(name) {
  if (!(name in assets)) throw new Error(`Unknown asset: ${name}`);
  return assets[name];
}
