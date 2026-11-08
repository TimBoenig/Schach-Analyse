import { render } from "preact";
import { registerSW } from "virtual:pwa-register";

import { App } from "./ui/App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { initAppearance } from "./ui/theme";
import "./ui/styles.css";
import "./ui/design.css";

initAppearance();
// The AI coach was removed; drop its stored provider settings and API key.
try {
  localStorage.removeItem("schach.ai");
} catch {
  // Storage blocked (private mode): nothing was stored either.
}
registerSW({ immediate: true });
// Outer boundary: an error in the app shell itself shows a message with a
// reload button instead of an empty page.
render(
  <ErrorBoundary area="Die App">
    <App />
  </ErrorBoundary>,
  document.getElementById("app")!,
);
