import { useEffect, useRef, useState } from "preact/hooks";

import { resumeQueue, subscribeQueue } from "../app/analysisService";
import { onDataChanged } from "../storage/db";
import { currentUser, hasAuthCallback, onAuthEvent, refreshSyncStatus, syncAvailable, syncNow } from "../storage/sync";
import { AccountView, useSyncStatus } from "./AccountView";
import { AnalysisView } from "./AnalysisView";
import { FreeBoardView } from "./FreeBoardView";
import { GamesView } from "./GamesView";
import { CommandPalette, PAGES, ShortcutHelp } from "./CommandPalette";
import { HomeView } from "./HomeView";
import { CoachAvatar, COACH_NAME } from "./Coach";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  IconAccount,
  IconBoard,
  IconClose,
  IconFreeBoard,
  IconGames,
  IconHome,
  IconInsights,
  IconMore,
  IconMoves,
  IconOpenings,
  IconPlayers,
  IconProfile,
  IconSearch,
  IconSettings,
  IconTraining,
} from "./icons";
import { InsightsView } from "./InsightsView";
import { MovesView } from "./MovesView";
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
    title: "Statistiken",
    items: [
      { view: "profile", label: "Profil", hint: "Fähigkeiten, Stärken, Stil", icon: IconProfile },
      { view: "moves", label: "Zugbilanz", hint: "Brillant bis Patzer gezählt", icon: IconMoves },
      { view: "insights", label: "Einblicke", hint: "Ergebnisse, Fehler, Gewohnheiten", icon: IconInsights },
      { view: "players", label: "Spieler", hint: "Gegner und Freunde", icon: IconPlayers },
    ],
  },
];

const SETTINGS_ITEM: NavItem = { view: "settings", label: "Einstellungen", hint: "Namen, Analyse, Aussehen", icon: IconSettings };
const ACCOUNT_ITEM: NavItem = { view: "account", label: "Konto", hint: "Anmelden, auf allen Geräten", icon: IconAccount };
const ALL_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), ACCOUNT_ITEM, SETTINGS_ITEM];
const TAB_VIEWS: Route["view"][] = ["home", "games", "training", "profile"];
const MORE_ITEMS = ALL_ITEMS.filter((n) => !TAB_VIEWS.includes(n.view));

// Local changes reach the cloud this long after the last edit (batch imports
// and analysis write many records in a row).
const PUSH_DELAY_MS = 20_000;

function useBackgroundSync(): void {
  useEffect(() => {
    if (!syncAvailable()) return;
    const run = () => void syncNow().catch(() => undefined);
    let alive = true;
    let unsubscribe: (() => void) | null = null;
    // Opened from an account e-mail: start the client at once so it can read
    // the link, then show the account page (the client clears the URL).
    const fromMail = hasAuthCallback();
    const first = window.setTimeout(
      () => {
        void onAuthEvent((event) => {
          if (event === "SIGNED_IN") run();
          if (event === "PASSWORD_RECOVERY") navigate({ view: "account" }, true);
        }).then((off) => (alive ? (unsubscribe = off) : off()));
        if (fromMail) void currentUser().finally(() => navigate({ view: "account" }, true));
        void refreshSyncStatus();
        run();
      },
      // Let the first screen render before the sync client loads.
      fromMail ? 0 : 1200,
    );
    let pushTimer = 0;
    const offData = onDataChanged(() => {
      window.clearTimeout(pushTimer);
      pushTimer = window.setTimeout(run, PUSH_DELAY_MS);
    });
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    const timer = window.setInterval(run, 2 * 60 * 1000);
    return () => {
      alive = false;
      unsubscribe?.();
      offData();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", run);
      window.clearInterval(timer);
      window.clearTimeout(first);
      window.clearTimeout(pushTimer);
    };
  }, []);
}

/** Sidebar entry: who is signed in and whether the last sync worked. */
function AccountChip({ active, onClick }: { active: boolean; onClick: () => void }) {
  const s = useSyncStatus();
  if (s.phase === "off") return null;
  const signedIn = Boolean(s.email) && s.phase !== "signed-out";
  return (
    <button class={`nav-item account-chip${active ? " active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>
      <span class={`account-avatar small${signedIn ? "" : " empty"}`}>
        {signedIn ? (s.email ?? "?").slice(0, 1).toUpperCase() : <IconAccount />}
        {signedIn && <span class={`sync-dot ${s.phase}`} />}
      </span>
      <span class="nav-label">
        {signedIn ? (
          <>
            <span class="account-chip-mail">{s.email}</span>
            <span class="account-chip-state">
              {s.phase === "running" ? "Gleicht ab …" : s.phase === "error" ? "Abgleich gestört" : "Online gesichert"}
            </span>
          </>
        ) : (
          <>
            Anmelden
            <span class="account-chip-state">Analysen auf allen Geräten</span>
          </>
        )}
      </span>
    </button>
  );
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
  // Continue analyses that were still running when the app was last closed.
  useEffect(() => {
    const t = window.setTimeout(() => void resumeQueue().catch(() => undefined), 2500);
    return () => window.clearTimeout(t);
  }, []);

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
        <AccountChip
          active={route.view === "account"}
          onClick={() => {
            setOverlay(null);
            go("account", lastGame);
          }}
        />
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
        <ErrorBoundary key={route.view}>
          {route.view === "home" && <HomeView />}
          {route.view === "games" && <GamesView openImport={Boolean(route.import)} />}
          {route.view === "analysis" && <AnalysisView gameId={route.gameId} ply={route.ply} />}
          {route.view === "board" && <FreeBoardView key={route.fen ?? ""} fen={route.fen} />}
          {route.view === "profile" && <ProfileView />}
          {route.view === "players" && <PlayersView key={route.playerId ?? route.tab ?? ""} playerId={route.playerId} tab={route.tab} />}
          {route.view === "insights" && <InsightsView />}
          {route.view === "openings" && <OpeningsView />}
          {route.view === "moves" && <MovesView />}
          {route.view === "training" && (
            // A new tab or deep link starts fresh (and leaves a running session).
            <TrainingView key={`${route.tab ?? ""}/${route.category ?? ""}`} tab={route.tab} category={route.category} />
          )}
          {route.view === "settings" && <SettingsView />}
          {route.view === "account" && <AccountView />}
        </ErrorBoundary>
      </main>
      <ErrorBoundary area="Das Menü">
        {overlay === "palette" && (
          <CommandPalette onClose={() => setOverlay(null)} onShortcuts={() => setOverlay("keys")} lastGame={lastGame} />
        )}
        {overlay === "keys" && <ShortcutHelp onClose={() => setOverlay(null)} />}
      </ErrorBoundary>
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
