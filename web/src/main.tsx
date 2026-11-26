// Entry point. The page language must be known before any view module loads,
// because label tables are built with t() at import time; so this file only
// picks the language (and loads the English texts if needed) and then imports
// the app.
import { initLang, lang, pageLang, t } from "./i18n";
import { blockZoom } from "./app/noZoom";
import { parseHash } from "./ui/router";

// Bio links may drop the "#" part, so the landing page also answers at /hello (and the older /hallo).
// The app itself lives at "/" with hash routes; switch over without a reload.
if (/^\/(hello|hallo)\/?$/.test(location.pathname)) history.replaceState(null, "", `/${location.hash || "#/hello"}`);

blockZoom();

const viewOf = () => parseHash(location.hash).view;

// The video studio can have its own language; entering or leaving it reloads
// the page when the language differs, so no screen ever mixes the two.
window.addEventListener("hashchange", () => {
  if (pageLang(viewOf()) !== lang()) location.reload();
});

void initLang(pageLang(viewOf())).then(() => {
  document.title = t("EndGameKing – Schachpartien analysieren und trainieren");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("Schachpartien von chess.com und Lichess kostenlos analysieren, Fehlermuster erkennen und gezielt trainieren. Läuft auf deinem Gerät."));
  return import("./boot");
});
