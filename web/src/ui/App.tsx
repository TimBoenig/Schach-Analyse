import { useEffect, useRef, useState } from "preact/hooks";

import { subscribeQueue } from "../app/analysisService";
import { syncAvailable, syncNow, supabase } from "../storage/sync";
import { AnalysisView } from "./AnalysisView";
import { FreeBoardView } from "./FreeBoardView";
import { GamesView } from "./GamesView";
import { CommandPalette, PAGES, ShortcutHelp } from "./CommandPalette";
import { HomeView } from "./HomeView";
import { IconBoard, IconFreeBoard, IconGames, IconHome, IconInsights, IconOpenings, IconPlayers, IconProfile, IconSearch, IconSettings, IconTraining } from "./icons";
import { InsightsView } from "./InsightsView";
import { OpeningsView } from "./OpeningsView";
import { isTyping, MOD } from "./keys";
import { PlayersView } from "./PlayersView";
import { ProfileView } from "./ProfileView";
import { SettingsView } from "./SettingsView";
import { TrainingView } from "./TrainingView";
import { useRoute, navigate, type Route } from "./router";

const NAV: { view: Route["view"]; label: string; short?: string; icon: () => preact.JSX.Element }[] = [
  { view: "home", label: "Start", icon: IconHome },
  { view: "games", label: "Partien", icon: IconGames },
  { view: "analysis", label: "Analyse", icon: IconBoard },
  { view: "board", label: "Brett", icon: IconFreeBoard },
  { view: "profile", label: "Profil", icon: IconProfile },
  { view: "players", label: "Spieler", icon: IconPlayers },
  { view: "insights", label: "Einblicke", icon: IconInsights },
  { view: "openings", label: "Eröffnungen", short: "Eröffnung", icon: IconOpenings },
  { view: "training", label: "Training", icon: IconTraining },
  { view: "settings", label: "Einstellungen", short: "Optionen", icon: IconSettings },
];

function useBackgroundSync(): void {
  useEffect(() => {
    if (!syncAvailable()) return;
    const run = () => void syncNow().catch(() => undefined);
    // Let the first screen render before the sync client loads.
    const first = window.setTimeout(run, 1200);
    let unsubscribe: (() => void) | null = null;
    let alive = true;
    void supabase()?.then((sb) => {
      if (!alive) return;
      const sub = sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN") run();
      });
      unsubscribe = () => sub.data.subscription.unsubscribe();
    });
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    const timer = window.setInterval(run, 2 * 60 * 1000);
    return () => {
      alive = false;
      unsubscribe?.();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", run);
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, []);
}

function go(view: Route["view"], lastGame: string | null): void {
  navigate(view === "analysis" ? { view: "analysis", gameId: lastGame ?? undefined } : ({ view } as Route));
}

export function App() {
  const route = useRoute();
  const [lastGame, setLastGame] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [overlay, setOverlay] = useState<"palette" | "keys" | null>(null);
  useBackgroundSync();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay((o) => (o === "palette" ? null : "palette"));
        return;
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".overlay, dialog[open]")) return;
      if (e.key === "?") {
        e.preventDefault();
        setOverlay("keys");
        return;
      }
      const page = PAGES.find((p) => p.key === e.key);
      if (page) {
        e.preventDefault();
        go(page.view, lastGameRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => subscribeQueue((q) => setAnalysing(Boolean(q.current) || q.queued.length > 0)), []);

  // A new page starts at the top, like a native app; moving within a game keeps the scroll.
  useEffect(() => window.scrollTo(0, 0), [route.view]);

  const lastGameRef = useRef<string | null>(null);
  useEffect(() => {
    if (route.view === "analysis" && route.gameId) {
      setLastGame(route.gameId);
      lastGameRef.current = route.gameId;
    }
  }, [route]);

  return (
    <div class="app">
      <nav class="nav">
        <div class="nav-brand">
          <img class="nav-logo" src={`${import.meta.env.BASE_URL}icons/logo.svg`} alt="" />
          <span class="nav-title">Schach-Analyse</span>
        </div>
        <button class="nav-search" onClick={() => setOverlay("palette")} aria-label="Befehle und Suche">
          <IconSearch />
          <span class="nav-search-text">Suchen</span>
          <kbd>{MOD} K</kbd>
        </button>
        {NAV.map((n) => (
          <button
            key={n.view}
            class={`nav-item${route.view === n.view ? " active" : ""}${n.short ? " has-short" : ""}${n.view === "analysis" || n.view === "board" ? " nav-wide-only" : ""}`}
            onClick={() => go(n.view, lastGame)}
            aria-current={route.view === n.view ? "page" : undefined}
          >
            {n.view === "games" && analysing && <span class="nav-status" title="Analyse läuft" />}
            <n.icon />
            <span class="nav-label">{n.label}</span>
            {n.short && <span class="nav-short">{n.short}</span>}
          </button>
        ))}
        <div class="nav-spacer" />
        <button class="nav-keys" onClick={() => setOverlay("keys")}>
          Tastenkürzel <kbd>?</kbd>
        </button>
      </nav>
      <main class="main">
        {route.view === "home" && <HomeView />}
        {route.view === "games" && <GamesView openImport={Boolean(route.import)} />}
        {route.view === "analysis" && <AnalysisView gameId={route.gameId} ply={route.ply} />}
        {route.view === "board" && <FreeBoardView key={route.fen ?? ""} fen={route.fen} />}
        {route.view === "profile" && <ProfileView />}
        {route.view === "players" && <PlayersView key={route.playerId ?? route.tab ?? ""} playerId={route.playerId} tab={route.tab} />}
        {route.view === "insights" && <InsightsView />}
        {route.view === "openings" && <OpeningsView />}
        {route.view === "training" && (
          // A new tab or deep link starts fresh (and leaves a running session).
          <TrainingView key={`${route.tab ?? ""}/${route.category ?? ""}`} tab={route.tab} category={route.category} />
        )}
        {route.view === "settings" && <SettingsView />}
      </main>
      {overlay === "palette" && (
        <CommandPalette onClose={() => setOverlay(null)} onShortcuts={() => setOverlay("keys")} lastGame={lastGame} />
      )}
      {overlay === "keys" && <ShortcutHelp onClose={() => setOverlay(null)} />}
    </div>
  );
}
