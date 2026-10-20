import { render } from "preact";
import { registerSW } from "virtual:pwa-register";

import { App } from "./ui/App";
import { initAppearance } from "./ui/theme";
import "./ui/styles.css";

initAppearance();
registerSW({ immediate: true });
render(<App />, document.getElementById("app")!);
