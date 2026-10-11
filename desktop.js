import { AppManager } from "./core/app-manager.js";
import { appRegistry } from "./apps/registry.js";
import { asset } from "./assets/manifest.js";

const $ = (id) => document.getElementById(id);
const announce = (text) => {
  $("announcer").textContent = text;
};
$("session").style.setProperty(
  "--desktop-wallpaper",
  `url("${asset("wallpaper")}")`,
);
document.querySelector(".avatar").src = asset("samurai");

export const apps = new AppManager({
  workspace: $("window-layer"),
  icons: $("desktop-icons"),
  tasks: $("task-apps"),
  asset,
  announce,
});
for (const definition of appRegistry) apps.register(definition);

function updateClock() {
  const now = new Date();
  $("clock-time").textContent = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  $("clock-date").textContent = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);
  $("clock-time").dateTime = now.toISOString();
  $("clock-date").dateTime = now.toISOString();
}
updateClock();
setInterval(updateClock, 1000);
$("login-button").addEventListener("click", async () => {
  if ($("login-button").disabled || !$("session").hidden) return;
  $("login-button").disabled = true;
  $("login-screen").classList.add("departing");
  await new Promise((resolve) => setTimeout(resolve, 220));
  $("login-screen").hidden = true;
  $("login-screen").inert = true;
  $("session").hidden = false;
  updateClock();
  await apps.open("terminal");
});
