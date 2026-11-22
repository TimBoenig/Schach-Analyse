import { useEffect, useState } from "preact/hooks";

import { backgroundAnalyze, resumeQueue, subscribeQueue } from "../app/analysisService";
import { repairOpeningNames } from "../app/openingNames";
import { repairGames } from "../app/repairGames";
import { getSetting, listGames, onDataChanged } from "../storage/db";
import { currentUser, hasAuthCallback, onAuthEvent, refreshSyncStatus, syncAvailable, syncNow } from "../storage/sync";
import { AccountView } from "./AccountView";
import { AnalysisView } from "./AnalysisView";
import { FreeBoardView } from "./FreeBoardView";
import { GamesView } from "./GamesView";
import { CommandPalette, PAGES, ShortcutHelp } from "./CommandPalette";
import { HomeView } from "./HomeView";
import { ErrorBoundary } from "./ErrorBoundary";
import { areaOf, ShellContext } from "./Layout";
import { InsightsView } from "./InsightsView";
import { LandingView } from "./LandingView";
import { LegalView } from "./LegalView";
import { MovesView } from "./MovesView";
import { OpeningsView } from "./OpeningsView";
import { isTyping } from "./keys";
import { PlayersView } from "./PlayersView";
import { ProfileView } from "./ProfileView";
import { SettingsView } from "./SettingsView";
import { Dock, Sidebar } from "./Shell";
import { StageHost } from "./stage/Host";
import { StudioRoute } from "./studio/StudioRoute";
import { startSeenSync } from "./stage/seenSync";
import { currentShow, markSeen, onSeenChange, openStage, takeAuto, wasSeen } from "./stage/store";
import { TrainingView } from "./TrainingView";
import { useRoute, navigate, type Route } from "./router";

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

function go(view: Route["view"]): void {
  navigate({ view } as Route);
}

export function App() {
  const route = useRoute();
  const [analysing, setAnalysing] = useState(false);
  const [overlay, setOverlay] = useState<"palette" | "keys" | null>(null);
  // A device that has never seen the app opens on the front door (the landing
  // page) at "/", so a new visitor sees the product before any setup. Decided
  // from localStorage at once, so the app never flashes first.
  const [frontDoor, setFrontDoor] = useState(() => route.view === "home" && !wasSeen("onboarding") && !wasSeen("landing"));
  useEffect(() => onSeenChange((seen) => seen.includes("landing") && setFrontDoor(false)), []);
  useBackgroundSync();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay((o) => (o === "palette" ? null : "palette"));
        return;
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".overlay, .stage, dialog[open]")) return;
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
  // Stored games are put right first (rating pool, double records, opening
  // names) so repair and analysis never write the same game at once.
  useEffect(() => {
    const t = window.setTimeout(
      () =>
        void repairGames()
          .catch(() => null)
          .then(() => repairOpeningNames())
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

  // What Lucena already explained follows the account to every device.
  useEffect(() => startSeenSync(), []);

  // Lucena's guided start (who she is, the first import, a walk through the
  // areas). Behind the front door it waits for its button; a device that
  // skipped the front door gets it once by itself; anyone who already has
  // games (from a backup or another tab) skips both.
  useEffect(() => {
    if (wasSeen("onboarding") || route.view === "studio") return;
    let alive = true;
    void Promise.all([getSetting<string[]>("usernames", []), listGames()])
      .then(([names, games]) => {
        if (!alive) return;
        const fresh = !names.length && !games.length;
        if (!fresh) {
          if (frontDoor) markSeen("landing");
          return;
        }
        if (!frontDoor && route.view !== "landing" && !currentShow() && takeAuto()) openStage({ kind: "onboarding" });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // The hidden video studio fills the whole window, like the landing page.
  if (route.view === "studio")
    return (
      <ErrorBoundary area="Das Videostudio">
        <StudioRoute />
      </ErrorBoundary>
    );

  // The social-media landing page stands alone, without sidebar or tab bar.
  if (route.view === "landing" || (frontDoor && route.view === "home"))
    return (
      <ErrorBoundary area="Die Startseite">
        <LandingView />
        <StageHost />
      </ErrorBoundary>
    );

  const area = areaOf(route);
  const open = (r: Route) => {
    setOverlay(null);
    navigate(r);
  };

  return (
    <ShellContext.Provider value={{ route, openPalette: () => setOverlay("palette") }}>
      <div class="app">
        <Sidebar route={route} area={area} analysing={analysing} onNavigate={open} onSearch={() => setOverlay("palette")} onKeys={() => setOverlay("keys")} />
        <Dock area={area} analysing={analysing} onNavigate={open} />
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
          {/* Where the sidebar shows no text, the legal links sit under every page. */}
          <footer class="page-legal faint small">
            <a href="#/rechtliches">Impressum</a> · <a href="#/rechtliches/datenschutz">Datenschutz</a>
          </footer>
        </main>
        <ErrorBoundary area="Das Menü">
          {overlay === "palette" && <CommandPalette onClose={() => setOverlay(null)} onShortcuts={() => setOverlay("keys")} />}
          {overlay === "keys" && <ShortcutHelp onClose={() => setOverlay(null)} />}
        </ErrorBoundary>
        <StageHost />
      </div>
    </ShellContext.Provider>
  );
}
