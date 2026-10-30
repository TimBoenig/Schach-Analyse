import { useEffect, useRef, useState } from "preact/hooks";

import { subscribeQueue } from "../app/analysisService";
import { syncAvailable, syncNow, supabase } from "../storage/sync";
import { AnalysisView } from "./AnalysisView";
import { FreeBoardView } from "./FreeBoardView";
import { GamesView } from "./GamesView";
import { CommandPalette, PAGES, ShortcutHelp } from "./CommandPalette";
import { HomeView } from "./HomeView";
import { CoachAvatar, COACH_NAME } from "./Coach";
import {
  IconBoard,
  IconClose,
  IconFreeBoard,
  IconGames,
  IconHome,
  IconInsights,
  IconMore,
  IconOpenings,
  IconPlayers,
  IconProfile,
  IconSearch,
  IconSettings,
  IconTraining,
} from "./icons";
import { InsightsView } from "./InsightsView";
import { OpeningsView } from "./OpeningsView";
import { isTyping, MOD } from "./keys";
import { PlayersView } from "./PlayersView";
import { ProfileView } from "./ProfileView";
import { SettingsView } from "./SettingsView";
import { TrainingView } from "./TrainingView";
import { useRoute, navigate, type Route } from "./router";

type NavItem = { view: Route["view"]; label: string; hint: string; icon: () => preact.JSX.Element };

// Sidebar groups on wide screens; on phones and portrait tablets the first
// group (plus Profil) forms the tab bar and the rest opens from "Mehr".
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Spielen & Analysieren",
    items: [
      { view: "home", label: "Start", hint: "Dein Tag auf einen Blick", icon: IconHome },
      { view: "games", label: "Partien", hint: "Importieren und durchsehen", icon: IconGames },
      { view: "analysis", label: "Analyse", hint: "Zuletzt geöffnete Partie", icon: IconBoard },
      { view: "board", label: "Analysebrett", hint: "Stellungen frei ausprobieren", icon: IconFreeBoard },
    ],
  },
  {
    title: "Verbessern",
    items: [
      { view: "training", label: "Training", hint: "Tagesplan und Übungen", icon: IconTraining },
      { view: "openings", label: "Eröffnungen", hint: "Dein Repertoire", icon: IconOpenings },
    ],
  },
  {
    title: "Verstehen",
    items: [
      { view: "profile", label: "Profil", hint: "Stärken und Schwächen", icon: IconProfile },
      { view: "insights", label: "Einblicke", hint: "Muster und Trainerbericht", icon: IconInsights },
      { view: "players", label: "Spieler", hint: "Gegner und Freunde", icon: IconPlayers },
    ],
  },
];

const SETTINGS_ITEM: NavItem = { view: "settings", label: "Einstellungen", hint: "Namen, Sync, Aussehen", icon: IconSettings };
const ALL_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];
const TAB_VIEWS: Route["view"][] = ["home", "games", "training", "profile"];
const MORE_ITEMS = ALL_ITEMS.filter((n) => !TAB_VIEWS.includes(n.view));

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
  const [overlay, setOverlay] = useState<"palette" | "keys" | "more" | null>(null);
  useBackgroundSync();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay((o) => (o === "palette" ? null : "palette"));
        return;
      }
      if (e.key === "Escape") setOverlay((o) => (o === "more" ? null : o));
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

  const navButton = (n: NavItem, kind: "nav-item" | "tab" = "nav-item") => (
    <button
      key={n.view}
      class={`${kind}${route.view === n.view ? " active" : ""}`}
      onClick={() => {
        setOverlay(null);
        go(n.view, lastGame);
      }}
      aria-current={route.view === n.view ? "page" : undefined}
    >
      {n.view === "games" && analysing && <span class="nav-status" title="Analyse läuft" />}
      <n.icon />
      <span class="nav-label">{n.view === "board" && kind === "tab" ? "Brett" : n.label}</span>
    </button>
  );

  return (
    <div class="app">
      <nav class="nav" aria-label="Hauptnavigation">
        <div class="nav-brand">
          <img class="nav-logo" src={`${import.meta.env.BASE_URL}icons/logo.svg`} alt="" />
          <span class="nav-title">Schach-Analyse</span>
        </div>
        <button class="nav-search" onClick={() => setOverlay("palette")} aria-label="Befehle und Suche">
          <IconSearch />
          <span class="nav-search-text">Suchen</span>
          <kbd>{MOD} K</kbd>
        </button>
        {NAV_GROUPS.map((g) => (
          <div class="nav-group" key={g.title}>
            <div class="nav-group-title">{g.title}</div>
            {g.items.map((n) => navButton(n))}
          </div>
        ))}
        <div class="nav-spacer" />
        {navButton(SETTINGS_ITEM)}
        <button class="nav-keys" onClick={() => setOverlay("keys")}>
          Tastenkürzel <kbd>?</kbd>
        </button>
      </nav>
      <nav class="tabbar" aria-label="Hauptnavigation">
        {TAB_VIEWS.map((v) => navButton(ALL_ITEMS.find((n) => n.view === v)!, "tab"))}
        <button
          class={`tab${MORE_ITEMS.some((n) => n.view === route.view) || overlay === "more" ? " active" : ""}`}
          onClick={() => setOverlay((o) => (o === "more" ? null : "more"))}
          aria-expanded={overlay === "more"}
        >
          <IconMore />
          <span>Mehr</span>
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
      {overlay === "more" && (
        <div class="sheet-backdrop" onClick={() => setOverlay(null)}>
          <div class="sheet" role="dialog" aria-label="Weitere Bereiche" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-head">
              <CoachAvatar size={40} />
              <div>
                <strong>Wohin soll es gehen?</strong>
                <div class="small muted">{COACH_NAME} zeigt dir alle Bereiche.</div>
              </div>
              <span class="spacer" />
              <button class="btn icon ghost" onClick={() => setOverlay(null)} aria-label="Schließen">
                <IconClose />
              </button>
            </div>
            <div class="sheet-grid">
              {MORE_ITEMS.map((n) => (
                <button
                  key={n.view}
                  class={`sheet-item${route.view === n.view ? " active" : ""}`}
                  onClick={() => {
                    setOverlay(null);
                    go(n.view, lastGame);
                  }}
                >
                  <span class="sheet-icon">
                    <n.icon />
                  </span>
                  <span>
                    <strong>{n.label}</strong>
                    <span class="small muted">{n.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
