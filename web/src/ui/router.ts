import { useEffect, useRef, useState } from "preact/hooks";

export type TrainingTab = "heute" | "uebungen" | "fortschritt";

export type Route =
  | { view: "home" }
  | { view: "games"; import?: boolean }
  | { view: "insights" }
  | { view: "openings" }
  | { view: "analysis"; gameId?: string; ply?: number }
  | { view: "profile" }
  | { view: "training"; tab?: TrainingTab; category?: string }
  | { view: "settings" };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  switch (parts[0]) {
    case "analyse":
      return { view: "analysis", gameId: parts[1], ply: parts[2] !== undefined ? Number(parts[2]) : undefined };
    case "profil":
      return { view: "profile" };
    case "einblicke":
      return { view: "insights" };
    case "eroeffnungen":
      return { view: "openings" };
    case "partien":
      return { view: "games" };
    case "import":
      return { view: "games", import: true };
    case "training": {
      const tab = (["heute", "uebungen", "fortschritt"] as const).find((t) => t === parts[1]);
      return { view: "training", tab, category: tab === "uebungen" ? parts[2] : undefined };
    }
    case "einstellungen":
      return { view: "settings" };
    default:
      return { view: "home" };
  }
}

export function toHash(r: Route): string {
  switch (r.view) {
    case "analysis":
      return r.gameId ? `#/analyse/${r.gameId}${r.ply !== undefined ? `/${r.ply}` : ""}` : "#/analyse";
    case "profile":
      return "#/profil";
    case "insights":
      return "#/einblicke";
    case "openings":
      return "#/eroeffnungen";
    case "training":
      if (!r.tab || r.tab === "heute") return "#/training";
      return `#/training/${r.tab}${r.category ? `/${r.category}` : ""}`;
    case "settings":
      return "#/einstellungen";
    case "games":
      return r.import ? "#/import" : "#/partien";
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
  const current = useRef(route);
  useEffect(() => {
    const on = () => {
      const next = parseHash(location.hash);
      const prev = current.current;
      current.current = next;
      // Cross-fade between pages where the browser supports it; stepping
      // through moves inside one game stays instant.
      const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (doc.startViewTransition && !reduced && prev.view !== next.view) {
        doc.startViewTransition(() => {
          setRoute(next);
          // Preact renders on the next microtask; let it commit before the snapshot.
          return new Promise((r) => setTimeout(r, 0));
        });
      } else {
        setRoute(next);
      }
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
