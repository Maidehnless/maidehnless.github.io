// Every entry automatically gets a desktop icon, taskbar button and shared window frame.
// To add an app, copy apps/example/ and register another entry here.
export const appRegistry = [
  {
    id: "terminal",
    name: "Terminal",
    title: "samurai@maiDOS: ~ — Terminal",
    icon: "terminal", // key in assets/manifest.js
    size: { width: 980, height: 850 },
    minSize: { width: 320, height: 240 },
    styles: new URL("./terminal/terminal.css", import.meta.url).href,
    load: () => import("./terminal/terminal.js"),
  },
  // {
  //   id: 'example', name: 'Example', icon: 'terminal',
  //   size: { width: 520, height: 360 },
  //   styles: new URL('./example/example.css', import.meta.url).href,
  //   load: () => import('./example/example.js'),
  // },
];
