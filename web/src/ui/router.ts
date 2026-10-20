import { useEffect, useState } from "preact/hooks";

export type Route =
  | { view: "games" }
  | { view: "analysis"; gameId?: string; ply?: number }
  | { view: "profile" }
  | { view: "training" }
  | { view: "settings" };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  switch (parts[0]) {
    case "analyse":
      return { view: "analysis", gameId: parts[1], ply: parts[2] !== undefined ? Number(parts[2]) : undefined };
    case "profil":
      return { view: "profile" };
    case "training":
      return { view: "training" };
    case "einstellungen":
      return { view: "settings" };
    default:
      return { view: "games" };
  }
}

export function toHash(r: Route): string {
  switch (r.view) {
    case "analysis":
      return r.gameId ? `#/analyse/${r.gameId}${r.ply !== undefined ? `/${r.ply}` : ""}` : "#/analyse";
    case "profile":
      return "#/profil";
    case "training":
      return "#/training";
    case "settings":
      return "#/einstellungen";
    default:
      return "#/";
  }
}

export function navigate(r: Route, replace = false): void {
  const h = toHash(r);
  if (replace) history.replaceState(null, "", h);
  else location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
