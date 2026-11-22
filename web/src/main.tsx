import { render } from "preact";
import { registerSW } from "virtual:pwa-register";

import { initInstallPrompt } from "./app/install";
import { App } from "./ui/App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { initMotion } from "./ui/motion";
import { initAppearance } from "./ui/theme";
import { initInfoTips } from "./ui/infoTips";
import { applyPhoneScale } from "./ui/phoneScale";
import "./ui/styles.css";
import "./ui/design.css";
import "./ui/arena.css";
import "./ui/mobile.css";
import "./ui/signal.css";
import "./ui/landing.css";
import "./ui/nova/index.css";

// Bio links may drop the "#" part, so the landing page also answers at /hello (and the older /hallo).
// The app itself lives at "/" with hash routes; switch over without a reload.
if (/^\/(hello|hallo)\/?$/.test(location.pathname)) history.replaceState(null, "", `/${location.hash || "#/hello"}`);

initAppearance();
applyPhoneScale();
initInfoTips();
// The AI coach was removed; drop its stored provider settings and API key.
try {
  localStorage.removeItem("schach.ai");
} catch {
  // Storage blocked (private mode): nothing was stored either.
}
initInstallPrompt();
initMotion();
registerSW({ immediate: true });
// Outer boundary: an error in the app shell itself shows a message with a
// reload button instead of an empty page.
render(
  <ErrorBoundary area="Die App">
    <App />
  </ErrorBoundary>,
  document.getElementById("app")!,
);
