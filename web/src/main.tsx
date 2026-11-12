import { render } from "preact";
import { registerSW } from "virtual:pwa-register";

import { initInstallPrompt } from "./app/install";
import { App } from "./ui/App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { initMotion } from "./ui/motion";
import { initAppearance } from "./ui/theme";
import "./ui/styles.css";
import "./ui/design.css";
import "./ui/arena.css";

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
  <ErrorBoundary area="Die App">
    <App />
  </ErrorBoundary>,
  document.getElementById("app")!,
);
