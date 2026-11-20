// The app itself, imported by main.tsx once the page language is set.
import { render } from "preact";
import { registerSW } from "virtual:pwa-register";

import { initInstallPrompt } from "./app/install";
import { App } from "./ui/App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { t } from "./i18n";
import { initMotion } from "./ui/motion";
import { initAppearance } from "./ui/theme";
import "./ui/styles.css";
import "./ui/design.css";
import "./ui/arena.css";
import "./ui/mobile.css";
import "./ui/signal.css";
import "./ui/landing.css";
import "./ui/nova/index.css";

initAppearance();
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
  <ErrorBoundary area={t("Die App")}>
    <App />
  </ErrorBoundary>,
  document.getElementById("app")!,
);
