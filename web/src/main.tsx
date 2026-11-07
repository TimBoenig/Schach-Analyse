import { render } from "preact";
import { registerSW } from "virtual:pwa-register";

import { App } from "./ui/App";
import { initAppearance } from "./ui/theme";
import "./ui/styles.css";

initAppearance();
// The AI coach was removed; drop its stored provider settings and API key.
try {
  localStorage.removeItem("schach.ai");
} catch {
  // Storage blocked (private mode): nothing was stored either.
}
registerSW({ immediate: true });
render(<App />, document.getElementById("app")!);
