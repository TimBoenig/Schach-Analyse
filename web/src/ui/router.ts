import { useEffect, useRef, useState } from "preact/hooks";

/** Path segment of the friends ranking; never handed out as a player id. */
export const RANKING_SLUG = "rangliste";

export type TrainingTab = "heute" | "uebungen" | "fortschritt";
export type SettingsTab = "analyse" | "daten";

export type Route =
  | { view: "home" }
  | { view: "games"; import?: boolean }
  | { view: "insights" }
  | { view: "openings" }
  | { view: "moves" }
  | { view: "analysis"; gameId?: string; ply?: number }
  | { view: "board"; fen?: string }
  | { view: "profile" }
  | { view: "players"; playerId?: string; tab?: "rangliste" }
  | { view: "training"; tab?: TrainingTab; category?: string }
  | { view: "settings"; tab?: SettingsTab }
  | { view: "account" };

export function parseHash(hash: string): Route {
  // Links from account e-mails come back as "#access_token=…" or "#error=…".
  if (/^#?(access_token|error)=/.test(hash)) return { view: "account" };
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  switch (parts[0]) {
    case "analyse":
      return { view: "analysis", gameId: parts[1], ply: parts[2] !== undefined ? Number(parts[2]) : undefined };
    case "brett":
      return parts[1] ? { view: "board", fen: decodeURIComponent(parts[1]) } : { view: "board" };
    case "profil":
      return { view: "profile" };
    case "einblicke":
      return { view: "insights" };
    case "spieler":
      if (parts[1] === RANKING_SLUG) return { view: "players", tab: "rangliste" };
      return parts[1] ? { view: "players", playerId: decodeURIComponent(parts[1]) } : { view: "players" };
    case "eroeffnungen":
      return { view: "openings" };
    case "zuege":
      return { view: "moves" };
    case "partien":
      return { view: "games" };
    case "import":
      return { view: "games", import: true };
    case "training": {
      const tab = (["heute", "uebungen", "fortschritt"] as const).find((t) => t === parts[1]);
      return { view: "training", tab, category: tab === "uebungen" ? parts[2] : undefined };
    }
    case "einstellungen": {
      const tab = (["analyse", "daten"] as const).find((t) => t === parts[1]);
      return tab ? { view: "settings", tab } : { view: "settings" };
    }
    case "konto":
      return { view: "account" };
    default:
      return { view: "home" };
  }
}

export function toHash(r: Route): string {
  switch (r.view) {
    case "analysis":
      return r.gameId ? `#/analyse/${r.gameId}${r.ply !== undefined ? `/${r.ply}` : ""}` : "#/analyse";
    case "board":
      return r.fen ? `#/brett/${encodeURIComponent(r.fen)}` : "#/brett";
    case "profile":
      return "#/profil";
    case "insights":
      return "#/einblicke";
    case "players":
      if (r.tab === "rangliste") return `#/spieler/${RANKING_SLUG}`;
      return r.playerId ? `#/spieler/${encodeURIComponent(r.playerId)}` : "#/spieler";
    case "openings":
      return "#/eroeffnungen";
    case "moves":
      return "#/zuege";
    case "training":
      if (!r.tab || r.tab === "heute") return "#/training";
      return `#/training/${r.tab}${r.category ? `/${r.category}` : ""}`;
    case "settings":
      return r.tab ? `#/einstellungen/${r.tab}` : "#/einstellungen";
    case "account":
      return "#/konto";
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
      const doc = document as Document & {
        startViewTransition?: (cb: () => Promise<void>) => { ready: Promise<void>; finished: Promise<void> };
      };
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (doc.startViewTransition && !reduced && prev.view !== next.view) {
        const t = doc.startViewTransition(() => {
          setRoute(next);
          // Preact renders on the next microtask; let it commit before the snapshot.
          return new Promise((r) => setTimeout(r, 0));
        });
        // Quick clicks skip the running transition; that rejection is expected, not an error.
        t?.ready?.catch(() => undefined);
        t?.finished?.catch(() => undefined);
      } else {
        setRoute(next);
      }
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
