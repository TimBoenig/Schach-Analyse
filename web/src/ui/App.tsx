import { useEffect, useState } from "preact/hooks";

import { backgroundAnalyze, resumeQueue, subscribeQueue } from "../app/analysisService";
import { repairOpeningNames } from "../app/openingNames";
import { onDataChanged } from "../storage/db";
import { currentUser, hasAuthCallback, onAuthEvent, refreshSyncStatus, syncAvailable, syncNow } from "../storage/sync";
import { AccountView, useSyncStatus } from "./AccountView";
import { AnalysisView } from "./AnalysisView";
import { FreeBoardView } from "./FreeBoardView";
import { GamesView } from "./GamesView";
import { CommandPalette, PAGES, ShortcutHelp } from "./CommandPalette";
import { HomeView } from "./HomeView";
import { ErrorBoundary } from "./ErrorBoundary";
import { IconAccount, IconSearch } from "./icons";
import { AREAS, type Area, areaOf, MAIN_AREAS, ShellContext } from "./Layout";
import { InsightsView } from "./InsightsView";
import { LegalView } from "./LegalView";
import { MovesView } from "./MovesView";
import { OpeningsView } from "./OpeningsView";
import { isTyping, MOD } from "./keys";
import { PlayersView } from "./PlayersView";
import { ProfileView } from "./ProfileView";
import { SettingsView } from "./SettingsView";
import { TrainingView } from "./TrainingView";
import { useRoute, navigate, type Route } from "./router";
import { BRAND } from "../brand";

const TAB_AREAS = MAIN_AREAS;
const SETTINGS_AREA = AREAS.find((a) => a.id === "settings")!;

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

function go(view: Route["view"]): void {
  navigate({ view } as Route);
}

export function App() {
  const route = useRoute();
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
        go(page.view);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => subscribeQueue((q) => setAnalysing(Boolean(q.current) || q.queued.length > 0)), []);
  // Continue analyses that were still running when the app was last closed.
  // Opening names are fixed first so the two never write the same game at once.
  useEffect(() => {
    const t = window.setTimeout(
      () =>
        void repairOpeningNames()
          .catch(() => 0)
          .then(() => resumeQueue())
          .then(() => backgroundAnalyze())
          .catch(() => undefined),
      2500,
    );
    return () => window.clearTimeout(t);
  }, []);

  // A new page starts at the top, like a native app; moving within a game keeps the scroll.
  useEffect(() => window.scrollTo(0, 0), [route.view]);


  const area = areaOf(route);
  const areaButton = (a: Area, kind: "nav-item" | "tab") => (
    <button
      key={a.id}
      class={`${kind}${area.id === a.id ? " active" : ""}`}
      onClick={() => {
        setOverlay(null);
        navigate(a.sub[0].route);
      }}
      aria-current={area.id === a.id ? "page" : undefined}
      title={kind === "nav-item" ? a.hint : undefined}
    >
      {a.id === "games" && analysing && <span class="nav-status" title="Analyse läuft" />}
      <a.icon />
      <span class="nav-label">{a.label}</span>
    </button>
  );
  // Sub-pages stay listed under every area, so nothing hides behind a click.
  const subList = (a: Area) =>
    a.sub.length > 1 && (
      <div class="nav-sub" role="group" aria-label={a.label}>
        {a.sub.map((s) => {
          const on = s.match(route);
          return (
            <button
              key={s.label}
              class={`nav-subitem${on ? " active" : ""}`}
              aria-current={on ? "page" : undefined}
              onClick={() => {
                setOverlay(null);
                navigate(s.route);
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>
    );

  return (
    <ShellContext.Provider value={{ route, openPalette: () => setOverlay("palette") }}>
    <div class="app">
      <nav class="nav" aria-label="Hauptnavigation">
        <div class="nav-brand" title={BRAND}>
          <img class="nav-logo" src={`${import.meta.env.BASE_URL}icons/logo.svg`} alt="" />
          <span class="nav-title">{BRAND}</span>
        </div>
        <button class="nav-search" onClick={() => setOverlay("palette")} aria-label="Befehle und Suche">
          <IconSearch />
          <span class="nav-search-text">Suchen</span>
          <kbd>{MOD} K</kbd>
        </button>
        <div class="nav-areas">
          {MAIN_AREAS.map((a) => (
            <div class={`nav-area${area.id === a.id ? " current" : ""}`} key={a.id}>
              {areaButton(a, "nav-item")}
              {subList(a)}
            </div>
          ))}
        </div>
        <div class="nav-spacer" />
        <AccountChip
          active={route.view === "account"}
          onClick={() => {
            setOverlay(null);
            go("account");
          }}
        />
        {areaButton(SETTINGS_AREA, "nav-item")}
        <button class="nav-keys" onClick={() => setOverlay("keys")}>
          Tastenkürzel <kbd>?</kbd>
        </button>
        <a class="nav-legal" href="#/rechtliches">
          Impressum
        </a>
      </nav>
      <nav class="tabbar" aria-label="Hauptnavigation">
        {TAB_AREAS.map((a) => areaButton(a, "tab"))}
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
          {route.view === "settings" && <SettingsView tab={route.tab} />}
          {route.view === "account" && <AccountView />}
          {route.view === "legal" && <LegalView tab={route.tab ?? "impressum"} />}
        </ErrorBoundary>
        {/* Phones and tablets have no side rail, so the legal links sit under every page. */}
        <footer class="page-legal faint small">
          <a href="#/rechtliches">Impressum</a> · <a href="#/rechtliches/datenschutz">Datenschutz</a>
        </footer>
      </main>
      <ErrorBoundary area="Das Menü">
        {overlay === "palette" && (
          <CommandPalette onClose={() => setOverlay(null)} onShortcuts={() => setOverlay("keys")} />
        )}
        {overlay === "keys" && <ShortcutHelp onClose={() => setOverlay(null)} />}
      </ErrorBoundary>
    </div>
    </ShellContext.Provider>
  );
}
